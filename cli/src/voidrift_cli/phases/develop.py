"""Phase 3 — Develop: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

import os
import signal
import time
from datetime import datetime
from pathlib import Path

from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space,
    check_requirements_exist, check_task_files, count_tasks,
    truncate_task_label,
)
from .. import ui

MAX_ESCALATIONS = 5


def run_develop(
    worker: ModelConfig,
    architect: ModelConfig | None = None,
    workers: int = 1,
) -> int:
    """Execute the develop phase.

    Args:
        worker: Model configuration for the developer role.
        architect: Optional model for escalation consultations.
        workers: Number of concurrent module workers (0 = one per module).

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

    if workers != 1 and not is_multi:
        ui.warn("No module headers found. Falling back to single worker.")
        workers = 1

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

    def _handle_sigterm(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    prev_handler = signal.signal(signal.SIGTERM, _handle_sigterm)

    ui.phase("VoidRift Develop")
    log, run_id = boot_run("develop")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod.run_id = run_id
        mcp_mod._boot()
        mcp_mod.load_tasks(str(task_file))
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    modules = mcp_mod.tasks.modules() if hasattr(mcp_mod, 'tasks') else ["_default"]

    _get_prompt = handlers.get("get_prompt", lambda *a: "")
    dev_system = _get_prompt("develop", "SYSTEM")
    esc_system = _get_prompt("develop", "ESCALATION")

    result = 1
    try:
        if is_multi and workers != 1:
            ui.warn("Multi-worker mode not yet implemented. Running sequentially.")

        for module in modules:
            label = f"[{module}] " if is_multi else ""
            result = _develop_module(worker, architect, module, label, tools, handlers, log, dev_system, esc_system)
            if result != 0:
                break
    except KeyboardInterrupt:
        ui.warn("Interrupted.")
    finally:
        signal.signal(signal.SIGTERM, prev_handler)
        lock.unlink(missing_ok=True)

    return result


def _develop_module(
    worker: ModelConfig,
    architect: ModelConfig | None,
    module: str,
    prefix: str,
    tools: list,
    handlers: dict,
    log: Path,
    dev_system: str,
    esc_system: str,
) -> int:
    """Execute tasks for a single module via MCP task tools (REQ-D-4)."""
    import voidrift_mcp.server as mcp_mod

    escalation_count = 0
    blocked_tasks = 0
    d = voidrift_dir()
    mod_arg = "" if module == "_default" else module
    arch_guidance: dict[int, str] = {}  # task_num -> latest architect response

    while True:
        task = mcp_mod.tasks.get_next(mod_arg)
        if not task:
            break

        status = mcp_mod.tasks.status(mod_arg)
        task_num = status["done"] + status["blocked"] + 1
        total = status["done"] + status["blocked"] + status["remaining"]
        label = truncate_task_label(f"- [ ] {task.text}")

        ui.stage(f"{prefix}Task {task_num}/{total}: {label}")

        arch_context = ""
        if task_num in arch_guidance:
            arch_context = f"\n\nArchitect guidance:\n{arch_guidance[task_num]}"

        agent = AgentLoop(
            model=worker,
            system_prompt=dev_system + arch_context,
            tools=tools,
            tool_handlers=handlers,
            stream=False,
            log_path=log,
        )

        with Status(f"  ⠋ Working...", console=ui._con):
            start_time = time.time()
            try:
                response = agent.send(task.text)
                elapsed = time.time() - start_time
                with open(log, "a") as f:
                    f.write(f"\n--- Task {task_num}: {label} ({elapsed:.1f}s) ---\n{response}\n")
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Task failed: {e}")
                with open(log, "a") as f:
                    f.write(f"ERROR on task {task_num}: {e}\n")
                return 1

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
                mcp_mod.tasks.block(mod_arg)
                blocked_tasks += 1
                ui.warn("Task blocked (max escalations reached)")
                continue

            ui.warn(f"Escalation: {question[:200]}")

            if not architect:
                ui.error("No architect configured. Re-run with an architect model.")
                return 1

            guidance = _consult_architect(architect, question, task.text, tools, handlers, log, esc_system, mod_arg or None)
            if guidance:
                arch_guidance[task_num] = guidance
                continue
            else:
                return 1

        mcp_mod.tasks.complete(mod_arg)
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
    esc_system: str,
    module: str | None = None,
) -> str | None:
    """Consult the architect model for guidance (REQ-D-6, REQ-D-8)."""
    d = voidrift_dir()
    context_parts = [f"Question from developer:\n{question}\n\nTask:\n{task_text}"]
    req = d / "REQUIREMENTS.md"
    if req.exists():
        context_parts.append(f"REQUIREMENTS.md:\n{req.read_text()[:8000]}")
    arch = d / "ARCHITECTURE.md"
    if arch.exists():
        context_parts.append(f"ARCHITECTURE.md:\n{arch.read_text()[:8000]}")

    agent = AgentLoop(
        model=architect,
        system_prompt=esc_system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        log_path=log,
    )

    ui.info("Consulting architect...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            response = agent.send("\n\n".join(context_parts))
            with open(log, "a") as f:
                f.write(f"\n--- Architect consultation ---\n{response}\n")
            return response
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Architect consultation failed: {e}")
            return None
