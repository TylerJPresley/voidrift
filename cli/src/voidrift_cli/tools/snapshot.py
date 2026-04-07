"""Per-task file snapshot and rollback for develop command (REQ-D-15)."""

from __future__ import annotations

import threading
from pathlib import Path

_snapshots = threading.local()


def set_snapshots() -> None:
    """Initialize a fresh snapshot dict for the current task/thread."""
    _snapshots.data = {}


def get_snapshots() -> dict[str, str | None] | None:
    """Return the current thread's snapshot dict, or None if not set."""
    return getattr(_snapshots, "data", None)


def clear_snapshots() -> None:
    """Clear snapshots after a successful task."""
    _snapshots.data = None


def compute_diff_stats(project_dir: Path | None = None) -> list[dict]:
    """Compute per-file diff stats from current snapshots (TASK-FW-018).

    Call before clear_snapshots(). Returns list of
    {path, status, lines_added, lines_removed} dicts.
    """
    snaps = getattr(_snapshots, "data", None)
    if not snaps:
        return []
    base = project_dir or Path.cwd()
    stats = []
    for path, original in snaps.items():
        full = base / path
        current = full.read_text(encoding="utf-8", errors="replace") if full.exists() else None
        if original is None and current is not None:
            stats.append({"path": path, "status": "created", "lines_added": current.count("\n") + 1, "lines_removed": 0})
        elif original is not None and current is None:
            stats.append({"path": path, "status": "deleted", "lines_added": 0, "lines_removed": original.count("\n") + 1})
        elif original is not None and current is not None and original != current:
            old_lines = original.splitlines()
            new_lines = current.splitlines()
            added = sum(1 for l in new_lines if l not in old_lines)
            removed = sum(1 for l in old_lines if l not in new_lines)
            stats.append({"path": path, "status": "modified", "lines_added": added, "lines_removed": removed})
    return stats


def rollback_snapshots(log_path: Path | None = None, project_dir: Path | None = None) -> None:
    """Restore all snapshotted files to their pre-task state (REQ-D-15)."""
    snaps = getattr(_snapshots, "data", None)
    if not snaps:
        return
    base = project_dir or Path.cwd()
    for path, original in snaps.items():
        full = base / path
        if original is None:
            if full.exists():
                full.unlink()
                _log_rollback(log_path, f"[ROLLBACK deleted={path}]")
        else:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(original, encoding="utf-8")
            _log_rollback(log_path, f"[ROLLBACK restored={path}]")
    _snapshots.data = None


def _log_rollback(log_path: Path | None, msg: str) -> None:
    if log_path:
        with open(log_path, "a") as f:
            f.write(msg + "\n")
