"""Develop command: Task execution (REQ-D-1 through REQ-D-13)."""

from __future__ import annotations

# Tools available to develop agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "file",
    "shell",
})

# Per-command action visibility within each domain tool (REQ-TOOL-8).
AGENT_TOOL_ACTIONS: dict[str, list[str]] = {
    "file": ["read", "write", "edit", "delete", "list"],
}

import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from ..config import get_max_tokens
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

from ._develop_pipeline import _dispatch_loop, _run_task, _consult_architect


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

