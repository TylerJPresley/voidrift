"""Git status snapshot for agent context injection (REQ-D-18)."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field


@dataclass
class GitSnapshot:
    branch: str
    recent_commits: list[str] = field(default_factory=list)
    changed_files: list[str] = field(default_factory=list)

    def to_prompt_block(self) -> str:
        lines = ["## Git Context", f"Branch: {self.branch}"]
        if self.recent_commits:
            lines.append("Recent commits:")
            lines.extend(f"  {c}" for c in self.recent_commits[:5])
        if self.changed_files:
            lines.append("Uncommitted changes:")
            lines.extend(f"  {f}" for f in self.changed_files[:20])
            overflow = len(self.changed_files) - 20
            if overflow > 0:
                lines.append(f"  ... and {overflow} more")
        else:
            lines.append("Working tree: clean")
        return "\n".join(lines)


def capture_git_snapshot(project_dir: str) -> GitSnapshot | None:
    """Capture current git state. Returns None if not a git repo or git unavailable."""
    def _git(*args: str) -> str:
        try:
            r = subprocess.run(
                ["git", *args], cwd=project_dir,
                capture_output=True, text=True, timeout=5,
            )
            return r.stdout.strip() if r.returncode == 0 else ""
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return ""

    branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    if not branch:
        return None
    commits = _git("log", "--oneline", "-5", "--no-decorate").splitlines()
    status = _git("status", "--short", "--porcelain").splitlines()
    return GitSnapshot(branch=branch, recent_commits=commits, changed_files=status)
