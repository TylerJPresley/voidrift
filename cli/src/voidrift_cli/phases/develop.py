"""Phase 3 — Develop: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

import os
import signal
import subprocess
import time
from datetime import datetime
from pathlib import Path

from rich.console import Console
from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig, ensure_model_ready, cleanup_model, resolve_model
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space,
    check_requirements_exist, check_task_files, count_tasks,
    truncate_task_label, console, err_console,
)

DEVELOPER_PROMPT = """[ROLE: Developer]

You are a Developer in the VoidRift framework. Execute tasks atomically.

You have MCP tools to read project context and write files.
Use get_next_task() to get your current task.
Use complete_task() when done.
Use write_file() to create/modify source files.
Use get_skill() to load skill conventions for the current task.
Use read_source_file() to examine existing code.

Follow the edit format: write complete file contents.
One task at a time. Be precise and minimal.
"""

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

    # Pre-flight checks (REQ-D-1)
    if not check_requirements_exist():
        err_console.print("[red]REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.[/red]")
        return 1

    task_file, is_multi = check_task_files()
    if not task_file:
        err_console.print("[red]No task files found. Run 'voidrift plan <model>' first.[/red]")
        return 1

    # REQ-D-12
    if workers != 1 and not is_multi:
        err_console.print("[yellow]No module headers found. Falling back to single worker.[/yellow]")
        workers = 1

    # REQ-D-2
    done, blocked, total = count_tasks(task_file)
    if done + blocked >= total and total > 0:
        console.print("[green]All tasks complete.[/green]")
        return 0

    # Lock file (REQ-D-3)
    lock = d / ".develop.lock"
    if lock.exists():
        try:
            parts = lock.read_text().strip().split("\n")
            pid = int(parts[0])
            os.kill(pid, 0)
            err_console.print(f"[red]Develop session already running (PID {pid}, started {parts[1] if len(parts) > 1 else 'unknown'})[/red]")
            return 1
        except (ProcessLookupError, ValueError, IndexError):
            lock.unlink()

    lock.write_text(f"{os.getpid()}\n{datetime.now().isoformat()}")

    def _handle_sigterm(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    prev_handler = signal.signal(signal.SIGTERM, _handle_sigterm)

    try:
        ensure_model_ready(worker)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        lock.unlink(missing_ok=True)
        return 1

    log = log_path("develop")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    # Set up MCP tools and load tasks
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        mcp_mod.load_tasks(str(task_file))
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    modules = mcp_mod.tasks.modules() if hasattr(mcp_mod, 'tasks') else ["_default"]

    result = 1
    try:
        if is_multi and workers != 1:
            # TODO: concurrent worker pool (REQ-D-10, REQ-D-11)
            err_console.print("[yellow]Multi-worker mode not yet implemented. Running sequentially.[/yellow]")

        for module in modules:
            label = f"[{module}] " if is_multi else ""
            result = _develop_module(worker, architect, module, label, tools, handlers, log)
            if result != 0:
                break
    except KeyboardInterrupt:
        err_console.print("\n[yellow]Interrupted.[/yellow]")
    finally:
        signal.signal(signal.SIGTERM, prev_handler)
        lock.unlink(missing_ok=True)
        cleanup_model(worker)
        if architect and architect.model_type == "kiro":
            cleanup_model(architect)

    return result


def _develop_module(
    worker: ModelConfig,
    architect: ModelConfig | None,
    module: str,
    prefix: str,
    tools: list,
    handlers: dict,
    log: Path,
) -> int:
    """Execute tasks for a single module via MCP task tools (REQ-D-4).

    Args:
        worker: Developer model configuration.
        architect: Optional architect model for escalations.
        module: Module name (or '_default' for single-module).
        prefix: Display prefix (e.g. '[backend] ').
        tools: MCP tool definitions.
        handlers: MCP tool handler functions.
        log: Path to the develop log file.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    import voidrift_mcp.server as mcp_mod

    escalation_count = 0
    blocked_tasks = 0
    d = voidrift_dir()
    mod_arg = "" if module == "_default" else module

    while True:
        task = mcp_mod.tasks.get_next(mod_arg)
        if not task:
            break

        status = mcp_mod.tasks.status(mod_arg)
        task_num = status["done"] + status["blocked"] + 1
        total = status["done"] + status["blocked"] + status["remaining"]
        label = truncate_task_label(f"- [ ] {task.text}")

        console.print(f"\n{prefix}[bold]Task {task_num}/{total}:[/bold] {label}")

        # Check for prior architect response
        arch_context = ""
        resp_dir = d / "architect_responses"
        if mod_arg:
            resp_dir = resp_dir / mod_arg
        if resp_dir.is_dir():
            responses = sorted(resp_dir.glob(f"{task_num}-*.md"))
            if responses:
                arch_context = f"\n\nArchitect guidance:\n{responses[-1].read_text()}"

        agent = AgentLoop(
            model=worker,
            system_prompt=DEVELOPER_PROMPT + arch_context,
            tools=tools,
            tool_handlers=handlers,
            stream=False,
        )

        with Status(f"{prefix}Working on task {task_num}/{total}...", console=console):
            start_time = time.time()
            try:
                response = agent.send(task.text)
                elapsed = time.time() - start_time
                with open(log, "a") as f:
                    f.write(f"\n--- Task {task_num}: {label} ({elapsed:.1f}s) ---\n{response}\n")
            except (RuntimeError, OSError, ValueError) as e:
                err_console.print(f"[red]Task failed: {e}[/red]")
                with open(log, "a") as f:
                    f.write(f"ERROR on task {task_num}: {e}\n")
                return 1

        # Check for escalation file (REQ-D-6)
        esc_dir = d / "escalations"
        if mod_arg:
            esc_dir = esc_dir / mod_arg
        esc_file = esc_dir / f"{task_num}.md"
        if esc_file.exists():
            escalation_count += 1
            if escalation_count > MAX_ESCALATIONS:  # REQ-D-7
                mcp_mod.tasks.block(mod_arg)
                blocked_tasks += 1
                err_console.print(f"[yellow]Task blocked (max escalations reached)[/yellow]")
                continue

            question = esc_file.read_text()
            err_console.print(f"[yellow]Escalation: {question[:200]}[/yellow]")

            if not architect:
                err_console.print("[red]No architect configured. Re-run with an architect model.[/red]")
                return 1

            guidance = _consult_architect(architect, question, task.text, tools, handlers, log, mod_arg or None)
            if guidance:
                resp_dir.mkdir(parents=True, exist_ok=True)
                n = len(list(resp_dir.glob(f"{task_num}-*.md"))) + 1
                (resp_dir / f"{task_num}-{n}.md").write_text(guidance)
                continue
            else:
                return 1

        # Mark complete via MCP (REQ-D-9)
        mcp_mod.tasks.complete(mod_arg)
        console.print(f"  [green]✓[/green] {label} ({elapsed:.1f}s)")

    if blocked_tasks > 0:
        err_console.print(f"\n[yellow]{blocked_tasks} task(s) blocked — marked [!] in TASKS.md[/yellow]")
        return 1

    mod_label = module if module != "_default" else "all"
    console.print(f"\n[green]✅ {prefix}All tasks complete ({mod_label})[/green]")
    return 0


def _consult_architect(
    architect: ModelConfig,
    question: str,
    task_text: str,
    tools: list,
    handlers: dict,
    log: Path,
    module: str | None = None,
) -> str | None:
    """Consult the architect model for guidance (AC-D28a, AC-D28b).

    Args:
        architect: Architect model configuration.
        question: The developer's escalation question.
        task_text: The current task line text.
        tools: MCP tool definitions.
        handlers: MCP tool handler functions.
        log: Path to the develop log file.
        module: Module name for multi-module projects.

    Returns:
        Architect's guidance text, or None on failure.
    """
    try:
        ensure_model_ready(architect)
    except RuntimeError as e:
        err_console.print(f"[red]Cannot reach architect: {e}[/red]")
        return None

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
        system_prompt=(
            "[ROLE: Architect]\n\n"
            "A developer is blocked and needs your guidance. "
            "Provide design direction, not implementation code. "
            "Be specific about file paths, interfaces, and behavior."
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=False,
    )

    with Status("[bold cyan]Consulting architect...", console=console):
        try:
            response = agent.send("\n\n".join(context_parts))
            with open(log, "a") as f:
                f.write(f"\n--- Architect consultation ---\n{response}\n")
            return response
        except (RuntimeError, OSError, ValueError) as e:
            err_console.print(f"[red]Architect consultation failed: {e}[/red]")
            return None
