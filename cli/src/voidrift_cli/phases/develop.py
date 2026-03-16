"""Phase 3 — Develop: Task execution (AC-D1 through AC-D53)."""

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
    check_requirements_exist, check_task_files, count_tasks, get_next_task,
    mark_task, truncate_task_label, console,
)

DEVELOPER_PROMPT = """[ROLE: Developer]

You are a Developer in the VoidRift framework. Execute tasks atomically.

You have MCP tools to read project context and write files.
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

    # Pre-flight checks
    if not check_requirements_exist():  # AC-D4a
        console.print("[red]REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.[/red]")
        return 1

    task_files, is_multi = check_task_files()
    if not task_files:  # AC-D2
        console.print("[red]No task files found. Run 'voidrift plan <model>' first.[/red]")
        return 1

    if workers != 1 and not is_multi:  # AC-D1
        console.print("[yellow]No module headers found. Falling back to single worker.[/yellow]")
        workers = 1

    # Check all tasks complete (AC-D3)
    all_done = True
    for tf in task_files:
        done, blocked, total = count_tasks(tf)
        if done + blocked < total:
            all_done = False
            break
    if all_done:
        console.print("[green]All tasks complete.[/green]")
        return 0

    # Lock file (AC-D5)
    lock = d / ".develop.lock"
    if lock.exists():
        try:
            parts = lock.read_text().strip().split("\n")
            pid = int(parts[0])
            os.kill(pid, 0)  # Check if alive
            console.print(f"[red]Develop session already running (PID {pid}, started {parts[1] if len(parts) > 1 else 'unknown'})[/red]")
            return 1
        except (ProcessLookupError, ValueError, IndexError):
            lock.unlink()  # Stale lock

    lock.write_text(f"{os.getpid()}\n{datetime.now().isoformat()}")

    # SIGTERM handler for clean shutdown
    def _handle_sigterm(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    prev_handler = signal.signal(signal.SIGTERM, _handle_sigterm)

    try:
        ensure_model_ready(worker)
    except RuntimeError as e:
        console.print(f"[red]Error: {e}[/red]")
        lock.unlink(missing_ok=True)
        return 1

    log = log_path("develop")
    with open(log, "a") as f:
        f.write(f"\n=== Develop session: {datetime.now().isoformat()} ===\n")

    # Set up tools
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    result = 1
    try:
        if is_multi:
            result = _develop_sequential(worker, architect, task_files, tools, handlers, log)
        else:
            result = _develop_loop(worker, architect, task_files[0], tools, handlers, log)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/yellow]")
    finally:
        signal.signal(signal.SIGTERM, prev_handler)
        lock.unlink(missing_ok=True)
        cleanup_model(worker)
        if architect and architect.model_type == "kiro":
            cleanup_model(architect)

    return result


def _develop_loop(
    worker: ModelConfig,
    architect: ModelConfig | None,
    task_file: Path,
    tools: list,
    handlers: dict,
    log: Path,
    module: str | None = None,
) -> int:
    """Execute tasks from a single task file (AC-D9).

    Args:
        worker: Developer model configuration.
        architect: Optional architect model for escalations.
        task_file: Path to the TASKS*.md file.
        tools: MCP tool definitions.
        handlers: MCP tool handler functions.
        log: Path to the develop log file.
        module: Module name for multi-module projects.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    escalation_count = 0
    blocked_tasks = 0
    d = voidrift_dir()

    while True:
        task_info = get_next_task(task_file)
        if not task_info:
            break

        task_num, task_text = task_info
        done, _, total = count_tasks(task_file)
        label = truncate_task_label(task_text)
        prefix = f"[{module}] " if module else ""

        console.print(f"\n{prefix}[bold]Task {done + 1}/{total}:[/bold] {label}")

        # Check for prior architect response
        arch_context = ""
        resp_dir = d / "architect_responses"
        if module:
            resp_dir = resp_dir / module
        if resp_dir.is_dir():
            # Find highest numbered response for this task
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

        # Execute task
        with Status(f"{prefix}Working on task {done + 1}/{total}...", console=console):
            start_time = time.time()
            try:
                response = agent.send(task_text)
                elapsed = time.time() - start_time
                with open(log, "a") as f:
                    f.write(f"\n--- Task {task_num}: {label} ({elapsed:.1f}s) ---\n{response}\n")
            except Exception as e:
                console.print(f"[red]Task failed: {e}[/red]")
                with open(log, "a") as f:
                    f.write(f"ERROR on task {task_num}: {e}\n")
                return 1

        # Check for escalation file (AC-D18)
        esc_dir = d / "escalations"
        if module:
            esc_dir = esc_dir / module
        esc_file = esc_dir / f"{task_num}.md"
        if esc_file.exists():
            escalation_count += 1
            if escalation_count > MAX_ESCALATIONS:
                mark_task(task_file, "!")  # AC-D26
                blocked_tasks += 1
                console.print(f"[yellow]Task blocked (max escalations reached)[/yellow]")
                continue

            question = esc_file.read_text()
            console.print(f"[yellow]Escalation: {question[:200]}[/yellow]")

            if not architect:  # AC-D19
                console.print("[red]No architect configured. Re-run with an architect model.[/red]")
                return 1

            guidance = _consult_architect(architect, question, task_text, tools, handlers, log, module)
            if guidance:
                # Write response and retry
                resp_dir.mkdir(parents=True, exist_ok=True)
                n = len(list(resp_dir.glob(f"{task_num}-*.md"))) + 1
                (resp_dir / f"{task_num}-{n}.md").write_text(guidance)
                continue  # Retry same task
            else:
                return 1

        # Mark complete (AC-D34)
        mark_task(task_file)
        console.print(f"  [green]✓[/green] {label} ({elapsed:.1f}s)")

    # Summary (AC-D27)
    if blocked_tasks > 0:
        console.print(f"\n[yellow]{blocked_tasks} task(s) blocked — marked [!] in {task_file.name}[/yellow]")
        for line in task_file.read_text().splitlines():
            if "- [!]" in line:
                console.print(f"  {line.strip()}")
        return 1

    console.print(f"\n[green]✅ All tasks complete in {task_file.name}[/green]")
    return 0


def _develop_sequential(
    worker: ModelConfig,
    architect: ModelConfig | None,
    task_files: list[Path],
    tools: list,
    handlers: dict,
    log: Path,
) -> int:
    """Process multiple modules sequentially (AC-D33).

    Args:
        worker: Developer model configuration.
        architect: Optional architect model for escalations.
        task_files: List of TASKS-<module>.md file paths.
        tools: MCP tool definitions.
        handlers: MCP tool handler functions.
        log: Path to the develop log file.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    d = voidrift_dir()
    tasks_md = d / "TASKS.md"

    for tf in sorted(task_files):
        module = tf.stem.replace("TASKS-", "")
        console.print(f"\n[bold cyan]Module: {module}[/bold cyan]")

        # Copy module tasks to TASKS.md (AC-D34)
        import shutil
        shutil.copy2(tf, tasks_md)

        result = _develop_loop(worker, architect, tasks_md, tools, handlers, log, module=module)

        # Sync back (AC-D34)
        shutil.copy2(tasks_md, tf)

        if result != 0:
            tasks_md.unlink(missing_ok=True)
            return result

    # Clean up (AC-D36)
    tasks_md.unlink(missing_ok=True)
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
        console.print(f"[red]Cannot reach architect: {e}[/red]")
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
        except Exception as e:
            console.print(f"[red]Architect consultation failed: {e}[/red]")
            return None
