"""Git checkpoint manager for develop rollback (REQ-D-20)."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Checkpoint:
    stash_ref: str
    task_id: str | None
    turn: int
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()


class GitCheckpointManager:
    """Creates and restores git stash checkpoints per develop task."""

    def __init__(self, project_dir: str) -> None:
        self._dir = project_dir
        self._checkpoints: list[Checkpoint] = []

    def create(self, turn: int, task_id: str | None = None) -> Checkpoint | None:
        """Create a checkpoint via `git stash create`. Returns None if tree is clean."""
        try:
            r = subprocess.run(
                ["git", "stash", "create", f"voidrift-turn-{turn}"],
                cwd=self._dir, capture_output=True, text=True, timeout=10,
            )
            ref = r.stdout.strip()
            if not ref:
                return None
            cp = Checkpoint(stash_ref=ref, task_id=task_id, turn=turn)
            self._checkpoints.append(cp)
            return cp
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return None

    def restore(self, checkpoint: Checkpoint) -> bool:
        """Restore working tree to checkpoint state. Returns True on success."""
        try:
            subprocess.run(
                ["git", "checkout", checkpoint.stash_ref, "--", "."],
                cwd=self._dir, check=True, timeout=10,
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return False

    @property
    def checkpoints(self) -> list[Checkpoint]:
        return list(self._checkpoints)

    def save(self, path: Path) -> None:
        """Persist checkpoints to JSONL file."""
        with open(path, "w", encoding="utf-8") as f:
            for cp in self._checkpoints:
                f.write(json.dumps({
                    "stash_ref": cp.stash_ref, "task_id": cp.task_id,
                    "turn": cp.turn, "timestamp": cp.timestamp,
                }) + "\n")

    @staticmethod
    def load_checkpoints(path: Path) -> list[Checkpoint]:
        """Load checkpoints from JSONL file."""
        if not path.exists():
            return []
        cps = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    d = json.loads(line)
                    cps.append(Checkpoint(**d))
                except (json.JSONDecodeError, TypeError):
                    continue
        return cps
