"""Develop pipeline — dispatch loop, task execution, architect escalation."""

from __future__ import annotations

import threading
import time
from pathlib import Path

from ..agent import AgentLoop
from ..config import get_max_tokens
from .. import prompts
from ..skills import find_skill, get_skill_allowed_tools, make_skill_tool_guard
from ..manifest import ManifestManager
from ..models import ModelConfig
from ..utils import truncate_task_label, voidrift_dir
from .. import ui
from ..ui_dashboard import DevelopDashboard
from ..token_budget import TokenBudget
from ..error_tracker import ErrorTracker
from ..git_checkpoint import GitCheckpointManager
from ..tools import set_snapshots, clear_snapshots, rollback_snapshots, compute_diff_stats

MAX_ESCALATIONS = 5

def _dispatch_loop(
    mm: ManifestManager,
    worker: ModelConfig,
    architect: ModelConfig | None,
    tools: list,
    handlers: dict,
    log: Path,
    dev_prompt_tpl: str,
    esc_prompt_tpl: str,
    git_lock: threading.Lock,
    is_interrupted: callable,
    token_budget: TokenBudget | None = None,
    git_context: str = "",
    errors: ErrorTracker | None = None,
    checkpoints: GitCheckpointManager | None = None,
    ctx=None,
) -> int:
    """Dispatch ready tasks until none remain (REQ-D-4, REQ-D-10)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..token_budget import BudgetExhaustedError

    max_w = worker.concurrency
    escalation_count = 0
    total_tasks = sum(mm.summary().values())
    all_diff_stats: list[tuple[int, list[dict]]] = []

    while True:
        if is_interrupted():
            ui.warn("Interrupted — stopping.")
            return 1, all_diff_stats

        mm.load()  # re-read manifest for latest state
        ready = mm.dispatchable()
        if not ready:
            if mm.has_work():
                blocked = [tid for tid, t in mm.tasks().items() if t.get("status") == "blocked"]
                if blocked:
                    ui.warn(f"{len(blocked)} task(s) blocked by failed dependencies.")
                return (1 if blocked else 0), all_diff_stats
            ui.done("All tasks complete.")
            return 0, all_diff_stats

        if max_w <= 1 or len(ready) == 1:
            # Sequential
            for tid in ready:
                if is_interrupted():
                    return 1, all_diff_stats
                rc, _stats = _run_task(
                    mm, tid, worker, architect, tools, handlers, log,
                    dev_prompt_tpl, esc_prompt_tpl, git_lock, total_tasks,
                    token_budget=token_budget, git_context=git_context,
                    errors=errors, checkpoints=checkpoints, ctx=ctx,
                )
                if _stats:
                    all_diff_stats.append((tid, _stats))
                if rc != 0:
                    escalation_count += 1
                    if escalation_count > MAX_ESCALATIONS:
                        mm.set_status(tid, "failed")
                        ui.warn(f"TASK-{tid} blocked (max escalations reached)")
        else:
            # Concurrent — dispatch all ready tasks up to concurrency limit (REQ-UI-11)
            batch = ready[:max_w] if max_w > 0 else ready
            ui.info(f"Dispatching {len(batch)} tasks concurrently")

            with DevelopDashboard() as dash:
                with ThreadPoolExecutor(max_workers=len(batch)) as pool:
                    futures = {}
                    for tid in batch:
                        if is_interrupted():
                            break
                        label = truncate_task_label(mm.read_task(tid).split("\n")[0] if mm.read_task(tid) else f"TASK-{tid}")
                        key = f"TASK-{tid}"
                        dash.add_task(key, f"TASK-{tid} {label}")
                        tracker = dash.tracker(key)

                        fut = pool.submit(
                            _run_task, mm, tid, worker, architect, tools, handlers,
                            log, dev_prompt_tpl, esc_prompt_tpl, git_lock, total_tasks,
                            tracker=tracker, token_budget=token_budget,
                            git_context=git_context, errors=errors,
                            checkpoints=checkpoints, ctx=ctx,
                        )
                        futures[fut] = (tid, key)

                    for fut in as_completed(futures):
                        tid, key = futures[fut]
                        try:
                            rc, _stats = fut.result()
                            if _stats:
                                all_diff_stats.append((tid, _stats))
                            dash.mark_done(key, failed=(rc != 0))
                        except Exception as e:
                            dash.mark_done(key, failed=True)
                            ui.error(f"TASK-{tid}: {e}")
                        if is_interrupted():
                            for f in futures:
                                f.cancel()
                            return 1, all_diff_stats


def _run_task(
    mm: ManifestManager,
    task_id: int,
    worker: ModelConfig,
    architect: ModelConfig | None,
    tools: list,
    handlers: dict,
    log: Path,
    dev_prompt_tpl: str,
    esc_prompt_tpl: str,
    git_lock: threading.Lock,
    total_tasks: int,
    tracker=None,
    token_budget=None,
    git_context: str = "",
    errors=None,
    checkpoints=None,
    ctx=None,
) -> int:
    """Execute a single task (REQ-D-4)."""
    from ..tools import set_snapshots, clear_snapshots, rollback_snapshots, compute_diff_stats

    task_content = mm.read_task(task_id)
    if not task_content:
        ui.error(f"TASK-{task_id}.md not found in active/")
        return 1, []

    task_info = mm.get_task(task_id)
    module = task_info.get("module", "") if task_info else ""

    # Parse frontmatter for skills and expected files
    skills: list[str] = []
    expected_files: list[str] = []
    if task_content.startswith("---"):
        import yaml
        end = task_content.index("---", 3)
        fm = yaml.safe_load(task_content[3:end]) or {}
        skills = fm.get("skills", [])
        for f in fm.get("files", []):
            # Strip annotations like "(create)" or "(modify)"
            path = f.split("(")[0].strip() if "(" in f else f.strip()
            if path:
                expected_files.append(path)

    # Pre-load skills into system prompt (REQ-CTX-2)
    skill_parts = []
    for skill_name in skills:
        content = find_skill(skill_name)
        if content:
            skill_parts.append(f"### Skill: {skill_name}\n\n{content}")
    skill_content = "\n\n".join(skill_parts)

    # Collect allowed_tools from task skills (REQ-SKL-9)
    from ..skills import get_skill_allowed_tools, make_skill_tool_guard
    _merged_allowed: list[str] | None = None
    _skill_names: list[str] = []
    _has_restriction = False
    for skill_name in skills:
        at = get_skill_allowed_tools(skill_name)
        if at is not None:
            _has_restriction = True
            _skill_names.append(skill_name)
            if _merged_allowed is None:
                _merged_allowed = list(at)
            else:
                _merged_allowed.extend(at)
    _skill_guard = None
    if _has_restriction:
        _skill_guard = make_skill_tool_guard(_merged_allowed, ", ".join(_skill_names))
    skill_content = "\n\n".join(skill_parts)

    # Build system prompt — task content IS the context
    system = dev_prompt_tpl.format(
        task_text=task_content,
        arch_context="",
        skill_content=skill_content,
    )
    if git_context:
        system += f"\n\n{git_context}"

    mm.set_status(task_id, "in-progress")
    if ctx is not None:
        ctx.reset_write_count()
    set_snapshots()

    # Git checkpoint before task (REQ-D-20)
    if checkpoints:
        with git_lock:
            checkpoints.create(turn=task_id, task_id=f"TASK-{task_id}")

    # Build before_tool_call hook — compose skill guard with done guard (REQ-D-5)
    def _done_guard(name: str, args: str) -> str | None:
        if name == "done" and ctx is not None and ctx.get_write_count() == 0:
            return "ERROR: No files written yet. You must call write_source_file() or edit_source_file() before calling done()."
        return None

    def _composed_hook(name: str, args: str) -> str | None:
        result = _done_guard(name, args)
        if result is not None:
            return result
        if _skill_guard is not None:
            return _skill_guard(name, args)
        return None

    # Follow-up hook — nudge model to write files if it exits with text only (REQ-D-5)
    _write_nudge_count = 0
    _MAX_WRITE_NUDGES = 2

    def _write_follow_up(state) -> list[dict] | None:
        nonlocal _write_nudge_count
        if ctx is not None and ctx.get_write_count() == 0 and _write_nudge_count < _MAX_WRITE_NUDGES:
            _write_nudge_count += 1
            return [{"role": "user", "content": "You have not written any files yet. Call write_source_file() to implement the task. Do not explain — write the code now."}]
        return None

    # Self-review hook — inject once after first write (REQ-D-22)
    _self_review_injected = False

    def _self_review_steering(state) -> list[dict] | None:
        nonlocal _self_review_injected
        if not _self_review_injected and ctx is not None and ctx.get_write_count() > 0:
            _self_review_injected = True
            return [{
                "role": "user",
                "content": (
                    "Re-read the acceptance criteria in the task. "
                    "For each AC, confirm the code you wrote satisfies it. "
                    "Score your confidence 0–100% that all ACs are satisfied. "
                    "If below 90%, identify the gaps and fix them now. "
                    "If 90% or above, call done()."
                ),
            }]
        return None

    agent = AgentLoop(
        model=worker,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(worker, "develop.task"),
        log_path=log,
        show_spinner=False,
        token_budget=token_budget,
        before_tool_call=_composed_hook,
        get_follow_up_messages=_write_follow_up,
        get_steering_messages=_self_review_steering,
    )

    start_time = time.time()
    if tracker:
        agent.on_progress = tracker

    label = truncate_task_label(task_content.split("\n")[0])

    try:
        if not tracker:
            with ui.spinner(ui.random_label(), f"TASK-{task_id}") as spin:
                agent.on_progress = spin.on_progress
                response = agent.send(prompts.load_prompt("develop", "TASK-USER"))
        else:
            response = agent.send(prompts.load_prompt("develop", "TASK-USER"))
        elapsed = time.time() - start_time
        with open(log, "a") as f:
            f.write(f"\n--- TASK-{task_id}: {label} ({elapsed:.1f}s) ---\n{response}\n")
    except (RuntimeError, OSError, ValueError) as e:
        elapsed = time.time() - start_time
        with open(log, "a") as f:
            f.write(f"ERROR on TASK-{task_id}: {e}\n")
        ui.error(f"TASK-{task_id} failed: {e}")
        if errors:
            cat = "context" if "context length" in str(e).lower() else "api"
            errors.record(cat, type(e).__name__, str(e)[:200], task=f"TASK-{task_id}", recoverable=False)
        rollback_snapshots(log_path=log)
        return 1, []

    # Verify writes occurred (REQ-D-5)
    if ctx is None or ctx.get_write_count() == 0:
        ui.warn(f"TASK-{task_id}: No files written — retrying...")
        if ctx is not None:
            ctx.reset_write_count()
        try:
            agent2 = AgentLoop(
                model=worker, system_prompt=system,
                tools=tools, tool_handlers=handlers,
                stream=False, max_tokens=get_max_tokens(worker, "develop.task"),
                log_path=log, show_spinner=False,
            )
            if tracker:
                agent2.on_progress = tracker
            response = agent2.send(prompts.load_prompt("develop", "TASK-RETRY"))
            with open(log, "a") as f:
                f.write(f"\n--- TASK-{task_id} RETRY ---\n{response}\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"TASK-{task_id} retry failed: {e}")

        if ctx is None or ctx.get_write_count() == 0:
            if architect:
                ui.warn(f"TASK-{task_id}: No writes after retry — consulting architect")
                guidance = _consult_architect(
                    architect, "Task produced no file output after two attempts.",
                    task_content, tools, handlers, log, esc_prompt_tpl,
                )
                if guidance:
                    # Append guidance to task file for next dispatch
                    task_path = mm.task_path(task_id)
                    if task_path.exists():
                        with open(task_path, "a") as f:
                            f.write(f"\n\n## Architect Fix Plan\n\n{guidance}\n")
                    mm.set_status(task_id, "planned")  # re-queue for next dispatch
                    rollback_snapshots(log_path=log)
                    return 0, []  # not a failure — task will be re-dispatched
            ui.warn(f"TASK-{task_id}: Still no writes after retry")
            rollback_snapshots(log_path=log)
            return 1, []

    # Git diff check (REQ-D-5)
    if ctx is not None and ctx.get_write_count() > 0:
        try:
            import subprocess
            with git_lock:
                git_result = subprocess.run(
                    ["git", "diff", "--quiet", "HEAD"],
                    capture_output=True, cwd=str(mm._project),
                )
            if git_result.returncode == 0:
                ui.warn(f"TASK-{task_id}: writes occurred but git shows no changes")
        except (FileNotFoundError, subprocess.SubprocessError):
            pass

    # File list verification (REQ-D-21)
    if expected_files and ctx is not None:
        written = {str(Path(p)) for p in (ctx.get_session_files() or [])}
        for ef in expected_files:
            if not any(ef in w or w.endswith(ef) for w in written):
                ui.warn(f"TASK-{task_id}: expected {ef} but it was not written")

    # Mark implemented (REQ-D-9)
    diff_stats = compute_diff_stats()
    mm.set_status(task_id, "implemented")
    clear_snapshots()
    if not tracker:
        ui.success(f"TASK-{task_id}: {label} ({elapsed:.1f}s)")

    return 0, diff_stats


def _consult_architect(
    architect: ModelConfig,
    question: str,
    task_content: str,
    tools: list,
    handlers: dict,
    log: Path,
    esc_prompt_tpl: str,
) -> str | None:
    """Consult the architect model for guidance (REQ-D-6, REQ-D-8, REQ-TM-7)."""
    d = voidrift_dir()
    reqs = (d / "REQUIREMENTS.md").read_text() if (d / "REQUIREMENTS.md").exists() else ""
    arch = (d / "ARCHITECTURE.md").read_text() if (d / "ARCHITECTURE.md").exists() else ""

    system = esc_prompt_tpl.format(
        question=question,
        task_text=task_content,
        requirements=reqs,
        architecture=arch,
    )

    agent = AgentLoop(
        model=architect,
        system_prompt=system,
        tools=[], tool_handlers={},
        stream=False, max_tokens=get_max_tokens(architect, "develop.escalation"),
        log_path=log,
    )

    try:
        response = agent.send(prompts.load_prompt("develop", "ESCALATION-USER"))
        with open(log, "a") as f:
            f.write(f"\n--- ARCHITECT GUIDANCE ---\n{response}\n")
        return response
    except (RuntimeError, OSError) as e:
        ui.error(f"Architect consultation failed: {e}")
        return None
