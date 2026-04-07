"""Develop command: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

# Tools available to develop agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "read_source_file",
    "write_source_file",
    "edit_source_file",
    "read_framework_file",
    "run_command",
})

BASH_DESCRIPTION: tuple[str, list[str]] = (
    "Run build, test, and lint commands to validate written code.",
    [
        "Run tests after writing code. Fix failures before moving to the next task.",
        "Check exit_code in the result — non-zero means failure.",
    ],
)

import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from .. import prompts
from ..skills import find_skill
from ..manifest import ManifestManager
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space,
    check_requirements_exist, truncate_task_label, append_state,
)
from .. import ui
from ..ui_dashboard import DevelopDashboard

from ..token_budget import TokenBudget
from ..error_tracker import ErrorTracker
from ..git_checkpoint import GitCheckpointManager

MAX_ESCALATIONS = 5


def run_develop(
    worker: ModelConfig,
    architect: ModelConfig | None = None,
    token_budget: TokenBudget | None = None,
) -> int:
    """Execute the develop command — dispatch tasks from manifest (REQ-D-4).

    Args:
        worker: Model configuration for the developer role.
        architect: Optional model for escalation consultations.
        token_budget: Optional TokenBudget shared across all agents (REQ-ARCH-13).

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    if not check_requirements_exist():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    # REQ-D-1: Check manifest exists
    mm = ManifestManager()
    if not mm.exists():
        ui.error("No task manifest found. Run 'voidrift plan <model>' first.")
        return 1

    mm.load()

    # Orphaned task recovery (TASK-FW-017): reset in-progress tasks from crashed sessions
    orphaned = [tid for tid, t in mm.tasks().items() if t.get("status") == "in-progress"]
    if orphaned:
        if sys.stdin.isatty():
            for tid in orphaned:
                task_info = mm.get_task(tid)
                title = task_info.get("title", "") if task_info else ""
                ui.warn(f"TASK-{tid} \"{title}\" is in-progress but no agent is running it.")
                ui.info("  [r] Reset to planned  [s] Skip  [x] Mark failed")
                try:
                    choice = input("  Choice [r]: ").strip().lower() or "r"
                except (EOFError, KeyboardInterrupt):
                    choice = "r"
                if choice == "x":
                    mm.set_status(tid, "failed")
                    ui.info(f"  → TASK-{tid} marked failed")
                elif choice == "s":
                    ui.info(f"  → TASK-{tid} skipped")
                else:
                    mm.set_status(tid, "planned")
                    ui.info(f"  → TASK-{tid} reset to planned")
        else:
            for tid in orphaned:
                mm.set_status(tid, "planned")
            ui.info(f"Auto-reset {len(orphaned)} orphaned task(s) to planned.")

    # REQ-D-2: Check for dispatchable work
    if not mm.has_work():
        ui.done("All tasks complete.")
        return 0

    # Lock file (REQ-D-3)
    lock = d / ".develop.lock"
    if lock.exists():
        try:
            parts = lock.read_text().strip().split("\n")
            pid = int(parts[0])
            os.kill(pid, 0)
            ui.error(f"Develop session already running (PID {pid}, started {parts[1] if len(parts) > 1 else 'unknown'})")
            return 1
        except (ProcessLookupError, ValueError, IndexError):
            lock.unlink()

    lock.write_text(f"{os.getpid()}\n{datetime.now().isoformat()}")

    from ..tools.filesystem import WriteContext as _WriteContext
    from ..agent import clear_abort
    _fs_ctx = _WriteContext(project_dir=d.parent, max_read_lines=worker.max_read_lines)
    _fs_ctx.reset_session_files()
    clear_abort()

    _interrupted = False
    _interrupt_count = 0

    def _handle_sigterm(signum: int, frame: object) -> None:
        nonlocal _interrupted, _interrupt_count
        _interrupt_count += 1
        _interrupted = True
        from ..agent import request_abort
        request_abort()
        if _interrupt_count >= 2:
            raise KeyboardInterrupt

    prev_sigterm = signal.signal(signal.SIGTERM, _handle_sigterm)
    prev_sigint = signal.signal(signal.SIGINT, _handle_sigterm)

    ui.header("VoidRift Develop")
    log, run_id = boot_run("develop")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    tools, handlers = build_local_tools(cmd="develop", project_dir=d.parent, ctx=_fs_ctx)
    dev_prompt_tpl = prompts.load_prompt("develop", "TASK")
    esc_prompt_tpl = prompts.load_prompt("develop", "ESCALATION")
    git_lock = threading.Lock()

    # Git snapshot — captured once, shared across all agents (REQ-D-18)
    from ..git_context import capture_git_snapshot
    _snap = capture_git_snapshot(str(Path.cwd()))
    git_context = _snap.to_prompt_block() if _snap else ""

    # Git checkpoint manager (REQ-D-20)
    from ..git_checkpoint import GitCheckpointManager
    checkpoints = GitCheckpointManager(str(Path.cwd())) if _snap else None

    result = 0
    _budget_exhausted = False
    diff_stats: list[tuple[int, list[dict]]] = []
    from ..error_tracker import ErrorTracker
    errors = ErrorTracker()
    try:
        result, diff_stats = _dispatch_loop(
            mm, worker, architect, tools, handlers, log,
            dev_prompt_tpl, esc_prompt_tpl, git_lock,
            lambda: _interrupted, token_budget=token_budget,
            git_context=git_context, errors=errors,
            checkpoints=checkpoints, ctx=_fs_ctx,
        )
    except KeyboardInterrupt:
        _interrupted = True
        ui.warn("Interrupted — stopping after current task.")
    except Exception as e:
        from ..token_budget import BudgetExhaustedError
        if isinstance(e, BudgetExhaustedError):
            _budget_exhausted = True
            ui.warn(f"Token budget exhausted: {e}")
        else:
            raise
    finally:
        signal.signal(signal.SIGTERM, prev_sigterm)
        signal.signal(signal.SIGINT, prev_sigint)
        lock.unlink(missing_ok=True)

    files_written = _fs_ctx.get_session_files()
    summary = "budget_exhausted" if _budget_exhausted else (
        "completed" if result == 0 else ("interrupted" if _interrupted else "failed")
    )
    if token_budget:
        ui.info(f"Token budget: {token_budget.summary()}")

    # Diff stats summary (TASK-FW-018)
    if diff_stats:
        total_added = total_removed = total_files = 0
        for tid, stats in diff_stats:
            added = sum(s["lines_added"] for s in stats)
            removed = sum(s["lines_removed"] for s in stats)
            total_added += added
            total_removed += removed
            total_files += len(stats)
            ui.info(f"  TASK-{tid}: +{added} -{removed} ({len(stats)} file{'s' if len(stats) != 1 else ''})")
        ui.info(f"  Total: +{total_added} -{total_removed} ({total_files} file{'s' if total_files != 1 else ''})")

    error_info = ""
    if errors.has_errors():
        error_info = f" Errors: {errors.summary_by_category()}"
    append_state("develop", worker.alias, summary + error_info, files_created=files_written or None)

    # Error summary (REQ-LOG-6)
    if errors.has_errors():
        ui._con.print(errors.render_summary_table())
        errors.write_jsonl(log)

    # Persist checkpoints (REQ-D-20)
    if checkpoints and checkpoints.checkpoints:
        checkpoints.save(d / "checkpoints.jsonl")

    return 1 if _budget_exhausted else result


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

    # Parse frontmatter for skills
    skills: list[str] = []
    if task_content.startswith("---"):
        import yaml
        end = task_content.index("---", 3)
        fm = yaml.safe_load(task_content[3:end]) or {}
        skills = fm.get("skills", [])

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

    agent = AgentLoop(
        model=worker,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        log_path=log,
        show_spinner=False,
        token_budget=token_budget,
        before_tool_call=_skill_guard,
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
                stream=False, log_path=log, show_spinner=False,
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
        stream=False, log_path=log,
    )

    try:
        response = agent.send(prompts.load_prompt("develop", "ESCALATION-USER"))
        with open(log, "a") as f:
            f.write(f"\n--- ARCHITECT GUIDANCE ---\n{response}\n")
        return response
    except (RuntimeError, OSError) as e:
        ui.error(f"Architect consultation failed: {e}")
        return None
