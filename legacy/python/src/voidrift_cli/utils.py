"""Shared utilities for the VoidRift CLI."""

from __future__ import annotations

import logging
import os
import re
import subprocess
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

from rich.console import Console

console = Console()
err_console = Console(stderr=True)

VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift"))


def voidrift_dir() -> Path:
    """Return the .voidrift/ directory for the current project.

    Returns:
        Path to ``<cwd>/.voidrift/``.
    """
    return Path.cwd() / ".voidrift"


def ensure_voidrift_dir() -> Path:
    """Create .voidrift/ if it doesn't exist (AC-PS2).

    Returns:
        Path to the created or existing directory.
    """
    d = voidrift_dir()
    d.mkdir(exist_ok=True)
    return d


def log_path(cmd: str) -> Path:
    """Generate a timestamped log file path (AC-LOG1).

    Args:
        cmd: Command name (gather, plan, develop, deploy, verify).

    Returns:
        Path to the new log file.
    """
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_dir = ensure_voidrift_dir() / "logs"
    log_dir.mkdir(exist_ok=True)
    return log_dir / f"{cmd}-{ts}.log"


def boot_run(cmd: str) -> tuple[Path, str]:
    """Start a command run: create log and set run ID.

    Args:
        cmd: Command name.

    Returns:
        Tuple of (log_path, run_id).
    """
    log = log_path(cmd)
    run_id = log.stem
    return log, run_id


def check_disk_space() -> None:
    """Warn if less than 1GB available (AC-MC7)."""
    st = os.statvfs(".")
    avail_gb = (st.f_bavail * st.f_frsize) / (1024**3)
    if avail_gb < 1.0:
        err_console.print(f"[yellow]⚠ Low disk space: {avail_gb:.1f} GB available[/yellow]")


def check_requirements_exist() -> bool:
    """Check if REQUIREMENTS.md exists.

    Returns:
        True if ``.voidrift/REQUIREMENTS.md`` is present.
    """
    return (voidrift_dir() / "REQUIREMENTS.md").exists()


def truncate_task_label(task_text: str, max_len: int = 72) -> str:
    """Truncate task label for display (AC-D11).

    Args:
        task_text: A single task line from TASKS.md.
        max_len: Maximum label length before truncation.

    Returns:
        Cleaned and possibly truncated label string.
    """
    label = re.sub(r"^- \[.\]\s*", "", task_text)
    label = re.sub(r"\s*\[[a-z, ]+\]\s*$", "", label)
    if len(label) > max_len:
        label = label[: max_len - 3] + "..."
    return label


# ---------------------------------------------------------------------------
# STATE.md — project lifecycle log (REQ-PS-3)
# ---------------------------------------------------------------------------

def append_state(
    cmd: str,
    model_alias: str,
    summary: str,
    files_created: list[str] | None = None,
    analyzed_files: list[tuple[str, str]] | None = None,
) -> None:
    """Append a command entry to STATE.md.

    Args:
        cmd: Command name (gather, plan, develop, etc.).
        model_alias: Model alias used.
        summary: One-line outcome summary.
        files_created: List of file paths created/modified (relative to project root).
        analyzed_files: List of (filepath, category) tuples (gather only).
    """
    from datetime import datetime
    d = voidrift_dir()
    state = d / "STATE.md"
    ts = datetime.now().isoformat(timespec="seconds")
    lines = [f"## {ts} — {cmd} ({model_alias})", f"{summary}", ""]
    if analyzed_files:
        lines.append("### Analyzed")
        for fp, cat in analyzed_files:
            lines.append(f"- {cat}: {fp}")
        lines.append("")
    if files_created:
        lines.append("### Files")
        for fp in files_created:
            lines.append(f"- created: {fp}")
        lines.append("")
    entry = "\n".join(lines) + "\n"
    with open(state, "a", encoding="utf-8") as f:
        f.write(entry)


def get_state_manifest(cmd: str) -> list[str]:
    """Get file manifest from the most recent STATE.md entry for a command.

    Returns:
        List of file paths from the manifest, or empty list.
    """
    d = voidrift_dir()
    state = d / "STATE.md"
    if not state.exists():
        return []
    text = state.read_text()
    # Find all entries for this command, take the last one
    pattern = rf"^## .+ — {re.escape(cmd)} \(.+\)$"
    entries = list(re.finditer(pattern, text, re.MULTILINE))
    if not entries:
        return []
    last = entries[-1]
    # Extract from last entry to next entry or end
    start = last.start()
    next_entry = re.search(r"^## .+ — \w+ \(.+\)$", text[last.end():], re.MULTILINE)
    block = text[start:last.end() + next_entry.start()] if next_entry else text[start:]
    # Parse file paths from manifest
    files = []
    for line in block.splitlines():
        m = re.match(r"^- created: (.+)$", line)
        if m:
            files.append(m.group(1))
    return files


# ---------------------------------------------------------------------------
# System log (REQ-LOG-4)
# ---------------------------------------------------------------------------

def setup_system_log() -> None:
    """Initialize the rotating system log at ~/.voidrift/logs/voidrift.log.

    Always writes to ~/.voidrift/ regardless of VOIDRIFT_HOME — framework
    logs are user-global, not project-scoped.

    Safe to call multiple times — handlers are only added once.
    """
    log_dir = Path.home() / ".voidrift" / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return  # Non-fatal: log directory creation failed

    logger = logging.getLogger("voidrift")
    if logger.handlers:
        return  # Already initialised

    logger.setLevel(logging.DEBUG)
    handler = RotatingFileHandler(
        log_dir / "voidrift.log",
        maxBytes=1 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    ))
    logger.addHandler(handler)
    logger.propagate = False  # Don't bubble up to root logger


def get_system_logger() -> logging.Logger:
    """Return the voidrift system logger, initialising it if needed."""
    logger = logging.getLogger("voidrift")
    if not logger.handlers:
        setup_system_log()
    return logger


def undo_command(cmd: str) -> list[str]:
    """Remove files from the last STATE.md entry for a command and remove the entry.

    Returns:
        List of files that were deleted.
    """
    manifest = get_state_manifest(cmd)
    deleted = []
    for fp in manifest:
        p = Path(fp) if Path(fp).is_absolute() else Path.cwd() / fp
        if p.exists():
            p.unlink()
            deleted.append(fp)
    # Remove the entry from STATE.md
    d = voidrift_dir()
    state = d / "STATE.md"
    if state.exists():
        text = state.read_text()
        pattern = rf"^## .+ — {re.escape(cmd)} \(.+\)$"
        entries = list(re.finditer(pattern, text, re.MULTILINE))
        if entries:
            last = entries[-1]
            next_entry = re.search(r"^## .+ — \w+ \(.+\)$", text[last.end():], re.MULTILINE)
            end = last.end() + next_entry.start() if next_entry else len(text)
            text = text[:last.start()] + text[end:]
            state.write_text(text)
    return deleted


# ── Analysis cache pruning (REQ-U-14) ──────────────────────────────────────


def prune_analysis_cache(
    project_dir: Path,
    max_entries: int = 500,
    ttl_days: int = 30,
) -> dict:
    """Prune .voidrift/analysis/ — stale, expired, then LRU. Returns stats dict."""
    import time

    analysis_dir = project_dir / ".voidrift" / "analysis"
    if not analysis_dir.exists():
        return {"stale": 0, "expired": 0, "lru": 0, "bytes_freed": 0}

    entries = []
    for p in analysis_dir.rglob("*.md"):
        if p.name.startswith("context-"):
            continue
        source = ""
        try:
            head = p.read_text(encoding="utf-8", errors="replace")[:512]
            if head.startswith("---"):
                for line in head.splitlines():
                    if line.strip().startswith("file:"):
                        source = line.split(":", 1)[1].strip()
                        break
        except OSError:
            pass
        entries.append({"path": p, "source": source, "mtime": p.stat().st_mtime, "size": p.stat().st_size})

    entries.sort(key=lambda e: e["mtime"])
    now = time.time()
    ttl_secs = ttl_days * 86400
    remove = set()
    stale = expired = lru = freed = 0

    # Stage 1: stale
    for e in entries:
        if e["source"] and not (project_dir / e["source"]).exists():
            remove.add(id(e))
            stale += 1

    # Stage 2: expired
    for e in entries:
        if id(e) not in remove and (now - e["mtime"]) > ttl_secs:
            remove.add(id(e))
            expired += 1

    # Stage 3: LRU
    remaining = len(entries) - len(remove)
    if remaining > max_entries:
        for e in entries:
            if remaining <= max_entries:
                break
            if id(e) not in remove:
                remove.add(id(e))
                lru += 1
                remaining -= 1

    for e in entries:
        if id(e) in remove:
            freed += e["size"]
            e["path"].unlink(missing_ok=True)

    return {"stale": stale, "expired": expired, "lru": lru, "bytes_freed": freed}
