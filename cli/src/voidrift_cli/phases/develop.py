"""Phase 3 — Develop: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

import os
import signal
import threading
import time
from datetime import datetime
from pathlib import Path

from rich.status import Status

from ..agent import AgentLoop, build_local_tools
from .. import prompts
from ..skills import find_skill
from ..task_store import TaskStore
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space,
    check_requirements_exist, check_task_files, count_tasks,
    truncate_task_label, append_state,
)
from .. import ui

MAX_ESCALATIONS = 5


def run_develop(
    worker: ModelConfig,
    architect: ModelConfig | None = None,
) -> int:
    """Execute the develop phase.

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

    task_file, is_multi = check_task_files()
    if not task_file:
        ui.error("No task files found. Run 'voidrift plan <model>' first.")
        return 1

    done_count, blocked, total = count_tasks(task_file)
    if done_count + blocked >= total and total > 0:
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
    reset_session_files()

    _interrupted = False

    def _handle_sigterm(signum: int, frame: object) -> None:
        nonlocal _interrupted
        _interrupted = True

    prev_sigterm = signal.signal(signal.SIGTERM, _handle_sigterm)
    prev_sigint = signal.signal(signal.SIGINT, _handle_sigterm)

    ui.phase("VoidRift Develop")
    log, run_id = boot_run("develop")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    tools, handlers = build_local_tools(phase="develop")

    task_store = TaskStore()
    task_store.load(task_file)
    modules = task_store.modules()

    dev_prompt_tpl = prompts.load_prompt("develop", "TASK")
    esc_prompt_tpl = prompts.load_prompt("develop", "ESCALATION")

    git_lock = threading.Lock()  # REQ-D-11: serialize git operations across workers

    result = 1
    try:
        if is_multi:
            from concurrent.futures import ThreadPoolExecutor, as_completed
            from ..config import get_concurrency

            max_w = get_concurrency(worker.model_type)
            if max_w == 0:
                max_w = len(modules)

            if max_w == 1:
                # Sequential — same as single module
                for module in modules:
                    if _interrupted:
                        ui.warn("Interrupted — stopping after current task.")
                        break
                    label = f"[{module}] "
                    result = _develop_module(worker, architect, module, label, tools, handlers, log, dev_prompt_tpl, esc_prompt_tpl, git_lock, task_store, lambda: _interrupted)
                    if result != 0:
                        break
            else:
                ui.info(f"Running {len(modules)} modules with {max_w} concurrent worker(s)")
                results = {}

                with ThreadPoolExecutor(max_workers=max_w) as pool:
                    futures = {}
                    for module in modules:
                        if _interrupted:
                            break
                        label = f"[{module}] "
                        fut = pool.submit(
                            _develop_module, worker, architect, module, label,
                            tools, handlers, log, dev_prompt_tpl, esc_prompt_tpl,
                            git_lock, task_store, lambda: _interrupted,
                        )
                        futures[fut] = module

                    for fut in as_completed(futures):
                        mod = futures[fut]
                        try:
                            results[mod] = fut.result()
                        except Exception as e:
                            ui.error(f"[{mod}] failed: {e}")
                            results[mod] = 1

                result = 1 if any(r != 0 for r in results.values()) else 0
        else:
            for module in modules:
                if _interrupted:
                    ui.warn("Interrupted — stopping after current task.")
                    break
                label = ""
                result = _develop_module(worker, architect, module, label, tools, handlers, log, dev_prompt_tpl, esc_prompt_tpl, git_lock, task_store, lambda: _interrupted)
    except KeyboardInterrupt:
        _interrupted = True
        ui.warn("Interrupted — stopping after current task.")
    finally:
        signal.signal(signal.SIGTERM, prev_sigterm)
        signal.signal(signal.SIGINT, prev_sigint)
        lock.unlink(missing_ok=True)

    # Record phase entry in STATE.md (REQ-PS-3)
    files_written = get_session_files()
    summary = "completed" if result == 0 else ("interrupted" if _interrupted else "failed")
    append_state("develop", worker.alias, summary, files_created=files_written or None)

    return result


def _develop_module(
    worker: ModelConfig,
    architect: ModelConfig | None,
    module: str,
    prefix: str,
    tools: list,
    handlers: dict,
    log: Path,
    dev_prompt_tpl: str,
    esc_prompt_tpl: str,
    git_lock: threading.Lock,
    task_store: TaskStore,
    is_interrupted: callable = lambda: False,
) -> int:
    """Execute tasks for a single module (REQ-D-4)."""
    escalation_count = 0
    blocked_tasks = 0
    d = voidrift_dir()
    mod_arg = "" if module == "_default" else module
    arch_guidance: dict[int, str] = {}  # task_num -> latest architect response

    while True:
        if is_interrupted():
            ui.warn(f"{prefix}Interrupted — exiting module.")
            return 1

        task = task_store.get_next(mod_arg)
        if not task:
            break

        status = task_store.status(mod_arg)
        task_num = status["done"] + status["blocked"] + 1
        total = status["done"] + status["blocked"] + status["remaining"]
        label = truncate_task_label(f"- [ ] {task.text}")

        ui.stage(f"{prefix}Task {task_num}/{total}: {label}")

        arch_context = ""
        if task_num in arch_guidance:
            arch_context = f"Architect guidance:\n{arch_guidance[task_num]}"

        # Pre-load task skills and inject into system prompt
        skill_parts = []
        for skill_name in task.skills:
            content = find_skill(skill_name)
            if content:
                skill_parts.append(f"### Skill: {skill_name}\n\n{content}")
        skill_content = "\n\n".join(skill_parts) if skill_parts else ""

        system = dev_prompt_tpl.format(
            task_text=task.text,
            arch_context=arch_context,
            skill_content=skill_content,
        )

        from ..tools import reset_write_count, get_write_count
        reset_write_count()

        agent = AgentLoop(
            model=worker,
            system_prompt=system,
            tools=tools,
            tool_handlers=handlers,
            stream=False,
            log_path=log,
        )

        with Status(f"  ⠋ Working...", console=ui._con):
            start_time = time.time()
            try:
                response = agent.send("Execute this task.")
                elapsed = time.time() - start_time
                with open(log, "a") as f:
                    f.write(f"\n--- Task {task_num}: {label} ({elapsed:.1f}s) ---\n{response}\n")
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Task failed: {e}")
                with open(log, "a") as f:
                    f.write(f"ERROR on task {task_num}: {e}\n")
                return 1

        # Verify writes occurred (REQ-D-5)
        if get_write_count() == 0:
            ui.warn("No files written — retrying task...")
            reset_write_count()
            with Status(f"  ⠋ Retrying...", console=ui._con):
                try:
                    agent2 = AgentLoop(
                        model=worker, system_prompt=system,
                        tools=tools, tool_handlers=handlers,
                        stream=False, log_path=log,
                    )
                    response = agent2.send("Execute this task. You must call write_source_file() to produce output.")
                    with open(log, "a") as f:
                        f.write(f"\n--- Task {task_num} RETRY ---\n{response}\n")
                except (RuntimeError, OSError, ValueError) as e:
                    ui.error(f"Retry failed: {e}")

            if get_write_count() == 0:
                if architect:
                    ui.warn("Still no writes after retry — escalating...")
                    esc_dir = d / "escalations"
                    if mod_arg:
                        esc_dir = esc_dir / mod_arg
                    esc_dir.mkdir(parents=True, exist_ok=True)
                    (esc_dir / f"{task_num}.md").write_text(
                        f"Task produced no file output after two attempts.\n\nTask: {task.text}"
                    )
                else:
                    ui.warn("No writes after retry and no architect configured — skipping task")
                    with open(log, "a") as f:
                        f.write(f"SKIPPED task {task_num}: no writes, no architect\n")

        # Git diff check (REQ-D-5) — advisory warning
        if get_write_count() > 0:
            try:
                import subprocess
                with git_lock:  # REQ-D-11: serialize git operations
                    git_result = subprocess.run(
                        ["git", "diff", "--quiet", "HEAD"],
                        capture_output=True, cwd=str(d.parent),
                    )
                if git_result.returncode == 0:
                    ui.warn("write_source_file() called but git shows no changes")
                    with open(log, "a") as f:
                        f.write(f"WARNING task {task_num}: writes occurred but git diff HEAD is clean\n")
            except (FileNotFoundError, subprocess.SubprocessError):
                pass  # git not available or no repo — skip

        # Check for escalation file (REQ-D-6)
        esc_dir = d / "escalations"
        if mod_arg:
            esc_dir = esc_dir / mod_arg
        esc_file = esc_dir / f"{task_num}.md"
        if esc_file.exists():
            question = esc_file.read_text()
            esc_file.unlink()  # ephemeral — clean up immediately

            escalation_count += 1
            if escalation_count > MAX_ESCALATIONS:
                task_store.block(mod_arg)
                blocked_tasks += 1
                ui.warn("Task blocked (max escalations reached)")
                continue

            ui.warn(f"Escalation: {question[:200]}")

            guidance = _consult_architect(architect, question, task.text, tools, handlers, log, esc_prompt_tpl, mod_arg or None)
            if guidance:
                arch_guidance[task_num] = guidance
                continue
            else:
                return 1

        task_store.complete(mod_arg)
        ui.success(f"{label} ({elapsed:.1f}s)")

    # Clean up any leftover escalation dirs
    esc_root = d / "escalations"
    if esc_root.is_dir():
        import shutil
        shutil.rmtree(esc_root)

    if blocked_tasks > 0:
        ui.warn(f"{blocked_tasks} task(s) blocked — marked [!] in TASKS.md")
        return 1

    mod_label = module if module != "_default" else "all"
    ui.done(f"{prefix}All tasks complete ({mod_label})")
    return 0


def _consult_architect(
    architect: ModelConfig,
    question: str,
    task_text: str,
    tools: list,
    handlers: dict,
    log: Path,
    esc_prompt_tpl: str,
    module: str | None = None,
) -> str | None:
    """Consult the architect model for guidance (REQ-D-6, REQ-D-8)."""
    d = voidrift_dir()
    req = d / "REQUIREMENTS.md"
    arch = d / "ARCHITECTURE.md"

    system = esc_prompt_tpl.format(
        question=question,
        task_text=task_text,
        requirements=req.read_text() if req.exists() else "(not found)",
        architecture=arch.read_text() if arch.exists() else "(not found)",
    )

    agent = AgentLoop(
        model=architect,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        log_path=log,
    )

    ui.info("Consulting architect...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            response = agent.send("Provide guidance for this blocked task.")
            with open(log, "a") as f:
                f.write(f"\n--- Architect consultation ---\n{response}\n")
            return response
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Architect consultation failed: {e}")
            return None
