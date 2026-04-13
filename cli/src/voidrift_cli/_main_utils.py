"""Utility CLI commands — status, log, prune, unlock, rollback, doctor, memory, completions."""

from __future__ import annotations

import os
import signal
import sys
from datetime import datetime
from pathlib import Path

import click

from . import ui
from .utils import voidrift_dir

@click.command()
def status() -> None:
    """Show project command status."""
    _status()


def render_kanban_board(mm: "ManifestManager") -> "Table":
    """Build a Rich Table Kanban board from a loaded ManifestManager (REQ-TM-1).

    Columns: Planned | In Progress | Implemented | Verified | Blocked/Failed
    Each cell lists TASK-N identifiers grouped by module.

    Args:
        mm: A loaded ManifestManager instance.

    Returns:
        A :class:`rich.table.Table` ready to be printed.
    """
    from rich.table import Table
    from rich.text import Text

    STATUS_COLS = [
        ("planned",     "Planned",     "cyan"),
        ("in_progress", "In Progress", "yellow"),
        ("implemented", "Implemented", "blue"),
        ("verified",    "Verified",    "green"),
        ("blocked",     "Blocked",     "red"),
    ]

    table = Table(
        title="Task Board",
        show_lines=True,
        expand=False,
    )
    for _, label, color in STATUS_COLS:
        table.add_column(label, style=color, no_wrap=False, min_width=12)

    # Group tasks by status, then by module within each status column
    buckets: dict[str, dict[str, list[str]]] = {s: {} for s, _, _ in STATUS_COLS}
    tasks = mm.tasks()
    for tid, task in tasks.items():
        raw_status = task.get("status", "planned")
        # Normalise failed → blocked for display
        col_key = "blocked" if raw_status == "failed" else raw_status
        if col_key not in buckets:
            col_key = "planned"
        mod = task.get("module") or "—"
        buckets[col_key].setdefault(mod, []).append(f"TASK-{tid}")

    cells: list[Text] = []
    for col_key, _, color in STATUS_COLS:
        lines: list[str] = []
        for mod in sorted(buckets[col_key]):
            ids = ", ".join(sorted(buckets[col_key][mod]))
            lines.append(f"[{mod}]\n{ids}")
        cells.append(Text("\n\n".join(lines) if lines else "—"))

    table.add_row(*cells)
    return table


def _status():
    """Print project status."""
    from .utils import voidrift_dir

    d = voidrift_dir()

    ui.header("VoidRift Status")

    req = d / "REQUIREMENTS.md"
    if req.exists():
        ui._con.print("  ✅ Gather: REQUIREMENTS.md exists")
    else:
        ui._con.print("  ⬜ Gather: Run 'voidrift gather <model>'")

    has_manifest = (d / "tasks" / "manifest.yml").exists()
    has_arch = (d / "ARCHITECTURE.md").exists()
    if has_manifest and has_arch:
        ui._con.print("  ✅ Plan: Tasks and architecture exist")
    elif has_arch:
        ui._con.print("  🔄 Plan: Architecture exists, no tasks")
    else:
        ui._con.print("  ⬜ Plan: Run 'voidrift plan <model>'")

    if has_manifest:
        from .manifest import ManifestManager
        mm = ManifestManager()
        mm.load()
        s = mm.summary()
        total = sum(s.values())
        verified = s.get("verified", 0)
        implemented = s.get("implemented", 0)
        planned = s.get("planned", 0)
        blocked = s.get("blocked", 0)
        failed = s.get("failed", 0)
        if total == 0:
            ui._con.print("  ⬜ Develop: No tasks")
        elif verified == total:
            ui._con.print(f"  ✅ Develop: All {total} tasks verified")
        else:
            parts = []
            if verified: parts.append(f"{verified} verified")
            if implemented: parts.append(f"{implemented} implemented")
            if planned: parts.append(f"{planned} planned")
            if blocked: parts.append(f"{blocked} blocked")
            if failed: parts.append(f"{failed} failed")
            ui._con.print(f"  🔄 Develop: {', '.join(parts)} ({total} total)")
        # Kanban board
        if total > 0:
            ui._con.print()
            ui._con.print(render_kanban_board(mm))
    else:
        ui._con.print("  ⬜ Develop: No tasks")

    from .commands.deploy import _detect_iac
    if _detect_iac():
        ui._con.print("  ✅ Deploy: IaC detected")
    else:
        ui._con.print("  ⬜ Deploy: Run 'voidrift deploy <model>'")

    if (d / "VERIFY.md").exists():
        text = (d / "VERIFY.md").read_text()
        if "PASS" in text:
            ui._con.print("  ✅ Verify: PASS")
        else:
            ui._con.print("  ❌ Verify: FAIL")
    else:
        ui._con.print("  ⬜ Verify: Run 'voidrift verify <model>'")

    spec_dir = d / "spec"
    if spec_dir.is_dir():
        specs = list(spec_dir.glob("*.md"))
        if specs:
            ui._con.print(f"\n  Feature specs ({len(specs)}):")
            for s in sorted(specs):
                ui._con.print(f"    - {s.stem}")


@click.command()
@click.argument("command", required=False)
@click.option("--prune", is_flag=True, help="Delete log files")
@click.option("--follow", "-f", is_flag=True, help="Tail the log file")
def log(command, prune, follow) -> None:
    """View or manage command log files."""
    from .utils import voidrift_dir

    d = voidrift_dir() / "logs"
    valid_commands = ["gather", "plan", "develop", "deploy", "verify", "chat"]

    if prune:
        pattern = f"{command}-*.log" if command else "*.log"
        logs = sorted(d.glob(pattern))
        for l in logs:
            l.unlink()
        ui.info(f"Deleted {len(logs)} log file(s)" if logs else "No log files to prune")
        return

    if not command:
        ui._con.print("Usage: voidrift log <command> [--prune] [--follow/-f]")
        ui._con.print(f"Commands: {', '.join(valid_commands)}")
        sys.exit(1)

    if command not in valid_commands:
        ui.error(f"Invalid command: {command}. Must be one of: {', '.join(valid_commands)}")
        sys.exit(1)

    logs = sorted(d.glob(f"{command}-*.log"))
    if not logs:
        ui.error(f"No log files found for command: {command}")
        sys.exit(1)

    latest = logs[-1]

    if follow:
        import time as _time
        try:
            with open(latest) as f:
                f.seek(0, 2)  # end of file
                while True:
                    line = f.readline()
                    if line:
                        ui._con.print(line, end="", markup=False)
                    else:
                        _time.sleep(0.3)
        except KeyboardInterrupt:
            return
    else:
        lines = latest.read_text().splitlines()
        for line in lines[-200:]:
            ui._con.print(line, markup=False)


@click.command()
@click.option("--global", "global_", is_flag=True, help="Prune framework-level data (~/.voidrift)")
@click.option("--all", "all_", is_flag=True, help="Remove all ephemeral data (ignore retention limit)")
def prune(global_: bool, all_: bool) -> None:
    """Clean ephemeral data (logs, stale locks, session DB)."""
    from datetime import datetime, timezone, timedelta
    from .utils import voidrift_dir
    from .config import get_retention, voidrift_home

    if global_:
        log_dir = voidrift_home() / "logs"
        if not log_dir.exists():
            ui.info("No global logs found — nothing to prune")
            return
        if all_:
            import shutil
            shutil.rmtree(log_dir)
            ui.success("Removed all global framework logs")
        else:
            days = get_retention("global")
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            logs = sorted(log_dir.glob("*.log*"))
            removed = [f for f in logs if datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc) < cutoff]
            for f in removed:
                f.unlink()
            ui.success(f"Pruned {len(removed)} global log(s) older than {days} days")
        return

    d = voidrift_dir()
    if not d.exists():
        ui.error("No .voidrift directory found — nothing to prune")
        sys.exit(1)

    if all_:
        import shutil
        shutil.rmtree(d)
        ui.success("Removed .voidrift/ — clean slate")
        return

    removed_logs = 0
    keep = get_retention("project")
    logs = sorted((d / "logs").glob("*.log"))
    for old in logs[:-keep] if keep else logs:
        old.unlink()
        removed_logs += 1

    lock = d / ".develop.lock"
    stale_lock = False
    if lock.exists():
        try:
            pid = int(lock.read_text().strip().split("\n")[0])
            os.kill(pid, 0)
        except (ProcessLookupError, ValueError, IndexError):
            lock.unlink()
            stale_lock = True

    parts = []
    if removed_logs:
        parts.append(f"{removed_logs} log(s)")
    if stale_lock:
        parts.append("stale lock")

    # Analysis cache pruning (REQ-U-14)
    from .utils import prune_analysis_cache
    from .config import get_cache_config
    cache_cfg = get_cache_config()
    cache_stats = prune_analysis_cache(
        d.parent,
        max_entries=cache_cfg.get("max_entries", 500),
        ttl_days=cache_cfg.get("ttl_days", 30),
    )
    cache_total = cache_stats["stale"] + cache_stats["expired"] + cache_stats["lru"]
    if cache_total:
        freed_kb = cache_stats["bytes_freed"] // 1024
        detail = []
        if cache_stats["stale"]:
            detail.append(f"{cache_stats['stale']} stale")
        if cache_stats["expired"]:
            detail.append(f"{cache_stats['expired']} expired")
        if cache_stats["lru"]:
            detail.append(f"{cache_stats['lru']} LRU")
        parts.append(f"{cache_total} analysis cache ({', '.join(detail)}, {freed_kb}KB freed)")

    ui.success(f"Pruned {', '.join(parts)}" if parts else "Nothing to prune")


@click.command()
def unlock() -> None:
    """Remove develop lock and kill running process."""
    from .utils import voidrift_dir

    lock = voidrift_dir() / ".develop.lock"
    if not lock.exists():
        ui.info("No lock file found.")
        return

    try:
        parts = lock.read_text().strip().split("\n")
        pid = int(parts[0])
        try:
            os.kill(pid, 0)
            os.kill(pid, signal.SIGTERM)
            import time
            time.sleep(2)
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            ui.info(f"Killed process {pid}")
        except ProcessLookupError:
            ui.info(f"Removed stale lock (PID {pid} not running)")
    except (ValueError, IndexError):
        ui.info("Removed invalid lock file")

    lock.unlink()


# skills_cmd is registered in main.py directly


@click.command()
@click.argument("turn", required=False, type=int)
def rollback(turn) -> None:
    """Restore working tree to a develop checkpoint."""
    from .utils import voidrift_dir
    from .git_checkpoint import GitCheckpointManager, Checkpoint

    cp_path = voidrift_dir() / "checkpoints.jsonl"
    cps = GitCheckpointManager.load_checkpoints(cp_path)
    if not cps:
        ui.error("No checkpoints found. Run 'voidrift develop' first.")
        sys.exit(1)

    if turn is None:
        ui.header("Available checkpoints")
        for cp in cps:
            ui.info(f"  turn {cp.turn}  {cp.timestamp[:19]}  {cp.task_id or ''}")
        ui.info("\nUsage: voidrift rollback <turn>")
        return

    match = [cp for cp in cps if cp.turn == turn]
    if not match:
        ui.error(f"No checkpoint for turn {turn}. Available: {', '.join(str(c.turn) for c in cps)}")
        sys.exit(1)

    cp = match[0]
    mgr = GitCheckpointManager(str(Path.cwd()))
    if mgr.restore(cp):
        ui.success(f"Restored working tree to turn {turn} ({cp.task_id or 'unknown task'})")
    else:
        ui.error(f"Failed to restore checkpoint for turn {turn}")
        sys.exit(1)


@click.command()
@click.option("--fix", is_flag=True, help="Auto-fix where safe")
def doctor(fix) -> None:
    """Run diagnostic checks on VoidRift setup."""
    from .doctor import run_checks

    ui.header("VoidRift Doctor")
    checks = run_checks(fix=fix)

    _ICONS = {"pass": "✓", "warn": "⚠", "fail": "✗"}
    _STYLES = {"pass": "green", "warn": "yellow", "fail": "red bold"}

    for c in checks:
        icon = _ICONS[c.result]
        style = _STYLES[c.result]
        msg = f"  {c.message}" if c.message else ""
        ui._con.print(f"  [{style}]{icon}[/{style}]  {c.name}{msg}")
        if c.fix_hint and c.result != "pass":
            ui._con.print(f"      [dim]{c.fix_hint}[/dim]")

    warns = sum(1 for c in checks if c.result == "warn")
    fails = sum(1 for c in checks if c.result == "fail")
    if fails:
        ui.error(f"{fails} failed, {warns} warnings")
        sys.exit(1)
    elif warns:
        ui.warn(f"{warns} warning(s)")
    else:
        ui.success("All checks passed")


@click.group()
def memory() -> None:
    """Manage project and global memory entries."""


@memory.command("list")
def memory_list() -> None:
    """List all memory entries grouped by layer."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    entries = mm.list_entries()
    if not entries:
        ui.info("No memory entries.")
        return
    project = [e for e in entries if e.scope == "project"]
    global_ = [e for e in entries if e.scope == "global"]
    if project:
        ui._con.print("\n[bold]Project memory[/bold]")
        for e in project:
            ui._con.print(f"  {e.name} — {e.description}")
    if global_:
        ui._con.print("\n[bold]Global memory[/bold]")
        for e in global_:
            ui._con.print(f"  {e.name} — {e.description}")


@memory.command("show")
@click.argument("name")
def memory_show(name) -> None:
    """Print full content of a memory entry."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    content = mm.read(name)
    if content is None:
        ui.error(f"Memory entry '{name}' not found.")
        sys.exit(1)
    click.echo(content)


@memory.command("delete")
@click.argument("name")
@click.option("--global", "global_", is_flag=True, help="Delete from global memory instead of project")
def memory_delete(name, global_) -> None:
    """Remove a memory entry."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    scope = "global" if global_ else "project"
    if mm.delete(name, scope=scope):
        ui.success(f"Deleted '{name}' from {scope} memory.")
    else:
        ui.error(f"Memory entry '{name}' not found in {scope} memory.")
        sys.exit(1)


@memory.command("export")
def memory_export() -> None:
    """Export all memory entries as a single markdown file."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    entries = mm.list_entries()
    if not entries:
        ui.info("No memory entries to export.")
        return
    for e in entries:
        content = mm.read(e.name) or ""
        click.echo(f"## {e.name} ({e.scope})\n")
        # Strip frontmatter from output
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                content = content[end + 3:].strip()
        click.echo(content)
        click.echo()


@click.command("completions")
@click.argument("shell", type=click.Choice(["bash", "zsh", "fish"]))
def completions_cmd(shell: str) -> None:
    """Generate shell completion script.

    \b
    Install once:
      voidrift completions bash > ~/.local/share/bash-completion/completions/voidrift
      voidrift completions zsh > ~/.zfunc/_voidrift
      voidrift completions fish > ~/.config/fish/completions/voidrift.fish
    """
    import subprocess
    env_var = "_VOIDRIFT_COMPLETE"
    result = subprocess.run(
        ["voidrift"],
        env={**os.environ, env_var: f"{shell}_source"},
        capture_output=True,
        text=True,
    )
    click.echo(result.stdout)


if __name__ == "__main__":
    cli()
