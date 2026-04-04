"""Develop command: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

import os
import signal
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

MAX_ESCALATIONS = 5


def run_develop(
    worker: ModelConfig,
    architect: ModelConfig | None = None,
) -> int:
    """Execute the develop command — dispatch tasks from manifest (REQ-D-4).

    Args:
        worker: Model configuration for the developer role.
        architect: Optional model for escalation consultations.

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

    from ..tools import reset_session_files, get_session_files
    from ..tools.filesystem import configure as _configure_fs
    reset_session_files()
    _configure_fs(max_read_lines=worker.max_read_lines)

    _interrupted = False
    _interrupt_count = 0

    def _handle_sigterm(signum: int, frame: object) -> None:
        nonlocal _interrupted, _interrupt_count
        _interrupt_count += 1
        _interrupted = True
        if _interrupt_count >= 2:
            raise KeyboardInterrupt

    prev_sigterm = signal.signal(signal.SIGTERM, _handle_sigterm)
    prev_sigint = signal.signal(signal.SIGINT, _handle_sigterm)

    ui.header("VoidRift Develop")
    log, run_id = boot_run("develop")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    tools, handlers = build_local_tools(cmd="develop")
    dev_prompt_tpl = prompts.load_prompt("develop", "TASK")
    esc_prompt_tpl = prompts.load_prompt("develop", "ESCALATION")
    git_lock = threading.Lock()

    result = 0
    try:
        result = _dispatch_loop(
            mm, worker, architect, tools, handlers, log,
            dev_prompt_tpl, esc_prompt_tpl, git_lock,
            lambda: _interrupted,
        )
    except KeyboardInterrupt:
        _interrupted = True
        ui.warn("Interrupted — stopping after current task.")
    finally:
        signal.signal(signal.SIGTERM, prev_sigterm)
        signal.signal(signal.SIGINT, prev_sigint)
        lock.unlink(missing_ok=True)

    files_written = get_session_files()
    summary = "completed" if result == 0 else ("interrupted" if _interrupted else "failed")
    append_state("develop", worker.alias, summary, files_created=files_written or None)

    return result


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
) -> int:
    """Dispatch ready tasks until none remain (REQ-D-4, REQ-D-10)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    max_w = worker.concurrency
    escalation_count = 0
    total_tasks = sum(mm.summary().values())

    while True:
        if is_interrupted():
            ui.warn("Interrupted — stopping.")
            return 1

        mm.load()  # re-read manifest for latest state
        ready = mm.dispatchable()
        if not ready:
            if mm.has_work():
                blocked = [tid for tid, t in mm.tasks().items() if t.get("status") == "blocked"]
                if blocked:
                    ui.warn(f"{len(blocked)} task(s) blocked by failed dependencies.")
                return 1 if blocked else 0
            ui.done("All tasks complete.")
            return 0

        if max_w <= 1 or len(ready) == 1:
            # Sequential
            for tid in ready:
                if is_interrupted():
                    return 1
                rc = _run_task(
                    mm, tid, worker, architect, tools, handlers, log,
                    dev_prompt_tpl, esc_prompt_tpl, git_lock, total_tasks,
                )
                if rc != 0:
                    escalation_count += 1
                    if escalation_count > MAX_ESCALATIONS:
                        mm.set_status(tid, "failed")
                        ui.warn(f"TASK-{tid} blocked (max escalations reached)")
        else:
            # Concurrent — dispatch all ready tasks up to concurrency limit
            batch = ready[:max_w] if max_w > 0 else ready
            ui.info(f"Dispatching {len(batch)} tasks concurrently")

            with ui.multi_spinner(f"{len(batch)} tasks") as ms:
                with ThreadPoolExecutor(max_workers=len(batch)) as pool:
                    futures = {}
                    for tid in batch:
                        if is_interrupted():
                            break
                        task_info = mm.get_task(tid)
                        module = task_info.get("module", "") if task_info else ""
                        label = truncate_task_label(mm.read_task(tid).split("\n")[0] if mm.read_task(tid) else f"TASK-{tid}")
                        desc = f"TASK-{tid} {label}"
                        tracker = ms.track(desc, group=module)
                        ms.set_group_total(module, len([t for t in mm.tasks().values() if t.get("module") == module]))

                        fut = pool.submit(
                            _run_task, mm, tid, worker, architect, tools, handlers,
                            log, dev_prompt_tpl, esc_prompt_tpl, git_lock, total_tasks,
                            tracker=tracker,
                        )
                        futures[fut] = (tid, desc, module)

                    for fut in as_completed(futures):
                        tid, desc, module = futures[fut]
                        try:
                            rc = fut.result()
                            elapsed = 0  # TODO: track per-task elapsed
                            if rc == 0:
                                ms.done(desc, desc, elapsed, group=module)
                            else:
                                ms.done(desc, f"FAILED: {desc}", elapsed, failed=True, group=module)
                        except Exception as e:
                            ms.done(desc, f"ERROR: {desc}", 0, failed=True, group=module)
                            ui.error(f"TASK-{tid}: {e}")
                        if is_interrupted():
                            for f in futures:
                                f.cancel()
                            return 1


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
) -> int:
    """Execute a single task (REQ-D-4)."""
    from ..tools import reset_write_count, get_write_count

    task_content = mm.read_task(task_id)
    if not task_content:
        ui.error(f"TASK-{task_id}.md not found in active/")
        return 1

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

    # Build system prompt — task content IS the context
    system = dev_prompt_tpl.format(
        task_text=task_content,
        arch_context="",
        skill_content=skill_content,
    )

    mm.set_status(task_id, "in-progress")
    reset_write_count()

    agent = AgentLoop(
        model=worker,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        log_path=log,
        show_spinner=False,
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
        return 1

    # Verify writes occurred (REQ-D-5)
    if get_write_count() == 0:
        ui.warn(f"TASK-{task_id}: No files written — retrying...")
        reset_write_count()
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

        if get_write_count() == 0:
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
                    return 0  # not a failure — task will be re-dispatched
            ui.warn(f"TASK-{task_id}: Still no writes after retry")
            return 1

    # Git diff check (REQ-D-5)
    if get_write_count() > 0:
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
    mm.set_status(task_id, "implemented")
    if not tracker:
        ui.success(f"TASK-{task_id}: {label} ({elapsed:.1f}s)")

    return 0


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
