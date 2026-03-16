"""Shared utilities for the VoidRift CLI."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from rich.console import Console

console = Console()

VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / "opt" / "voidrift"))


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


def log_path(phase: str) -> Path:
    """Generate a timestamped log file path (AC-LOG1).

    Args:
        phase: Phase name (gather, plan, develop, automate, verify).

    Returns:
        Path to the new log file.
    """
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return ensure_voidrift_dir() / f"{phase}-{ts}.log"


def check_disk_space() -> None:
    """Warn if less than 1GB available (AC-MC7)."""
    st = os.statvfs(".")
    avail_gb = (st.f_bavail * st.f_frsize) / (1024**3)
    if avail_gb < 1.0:
        console.print(f"[yellow]⚠ Low disk space: {avail_gb:.1f} GB available[/yellow]")


def check_requirements_exist() -> bool:
    """Check if REQUIREMENTS.md exists.

    Returns:
        True if ``.voidrift/REQUIREMENTS.md`` is present.
    """
    return (voidrift_dir() / "REQUIREMENTS.md").exists()


def check_task_files() -> tuple[list[Path], bool]:
    """Find task files.

    Returns:
        Tuple of (task_files, is_multi_module).
    """
    d = voidrift_dir()
    single = d / "TASKS.md"
    multi = sorted(d.glob("TASKS-*.md"))
    if multi:
        return multi, True
    if single.exists():
        return [single], False
    return [], False


def count_tasks(task_file: Path) -> tuple[int, int, int]:
    """Count done, blocked, and total tasks in a task file.

    Args:
        task_file: Path to a TASKS*.md file.

    Returns:
        Tuple of (done, blocked, total).
    """
    if not task_file.exists():
        return 0, 0, 0
    text = task_file.read_text()
    done = text.count("- [x]")
    blocked = text.count("- [!]")
    total = done + blocked + text.count("- [ ]")
    return done, blocked, total


def get_next_task(task_file: Path) -> tuple[int, str] | None:
    """Get the first unchecked task.

    Args:
        task_file: Path to a TASKS*.md file.

    Returns:
        Tuple of (task_num, task_text) or None if all tasks are done.
    """
    if not task_file.exists():
        return None
    lines = task_file.read_text().splitlines()
    task_num = 0
    for line in lines:
        if line.strip().startswith("- ["):
            task_num += 1
            if line.strip().startswith("- [ ]"):
                return task_num, line.strip()
    return None


def mark_task(task_file: Path, marker: str = "x") -> None:
    """Mark the first unchecked task with the given marker (AC-D34).

    Args:
        task_file: Path to a TASKS*.md file.
        marker: Character to place in the checkbox (``x`` or ``!``).
    """
    text = task_file.read_text()
    text = text.replace("- [ ]", f"- [{marker}]", 1)
    task_file.write_text(text)


def extract_skill_tags(task_text: str) -> list[str]:
    """Extract [skill1, skill2] tags from a task line.

    Args:
        task_text: A single task line from TASKS.md.

    Returns:
        List of lowercase skill tag strings.
    """
    m = re.search(r"\[([a-z, ]+)\]\s*$", task_text)
    if not m:
        return []
    return [t.strip() for t in m.group(1).split(",") if t.strip()]


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
