"""CLI-native task store for parsing and managing TASKS.md (REQ-CTX-3).

Parses a single TASKS.md into per-module task queues.
Supports ``## Module: <name>`` headers for multi-module projects.
Tasks are multi-line blocks: marker line, indented metadata, indented description.
Write-through: all state changes persist back to disk immediately.
"""

from __future__ import annotations

import re
import threading
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, PrivateAttr

_TASK_RE = re.compile(r"^- \[([ x!])\] (.+)$")


class Task(BaseModel):
    """A single task parsed from TASKS.md."""

    text: str
    status: str  # " " = pending, "x" = done, "!" = blocked
    file: str = ""
    skills: list[str] = []
    reqs: list[str] = []
    depends: list[int] = []
    line_start: int = 0
    line_end: int = 0  # exclusive


class TaskStore(BaseModel):
    """Manages tasks from a single TASKS.md, split by module headers (REQ-CTX-3)."""

    path: Path | None = None
    _modules: dict[str, list[Task]] = PrivateAttr(default_factory=dict)
    _raw_lines: list[str] = PrivateAttr(default_factory=list)
    _lock: threading.Lock = PrivateAttr(default_factory=threading.Lock)

    def load(self, path: Path) -> dict[str, int]:
        """Load and parse a TASKS.md file.

        Args:
            path: Path to the TASKS.md file.

        Returns:
            Dict of module name to task count.
        """
        self.path = path
        self._raw_lines = path.read_text(encoding="utf-8").splitlines()
        self._modules = {}
        current_module = "_default"
        self._modules[current_module] = []

        # First pass: find task marker lines and module headers
        task_starts: list[tuple[int, str, str, str]] = []  # (line, status, text, module)
        for i, line in enumerate(self._raw_lines):
            header = re.match(r"^## Module:\s*(.+)$", line)
            if header:
                current_module = header.group(1).strip()
                if current_module not in self._modules:
                    self._modules[current_module] = []
                continue
            m = _TASK_RE.match(line)
            if m:
                task_starts.append((i, m.group(1), m.group(2), current_module))

        # Second pass: determine block boundaries and extract metadata
        for idx, (line_num, status, text, module) in enumerate(task_starts):
            # Block ends at next task marker, next module header, or EOF
            if idx + 1 < len(task_starts):
                end = task_starts[idx + 1][0]
            else:
                end = len(self._raw_lines)
            # Trim trailing blank lines from block
            while end > line_num + 1 and not self._raw_lines[end - 1].strip():
                end -= 1

            skills: list[str] = []
            reqs: list[str] = []
            depends: list[int] = []
            file_path: str = ""
            for j in range(line_num + 1, end):
                stripped = self._raw_lines[j].strip()
                if stripped.lower().startswith("skills:"):
                    skills = [s.strip() for s in stripped.split(":", 1)[1].split(",") if s.strip()]
                elif stripped.lower().startswith("reqs:"):
                    reqs = [r.strip() for r in stripped.split(":", 1)[1].split(",") if r.strip()]
                elif stripped.lower().startswith("depends:"):
                    depends = [int(d.strip()) for d in stripped.split(":", 1)[1].split(",") if d.strip().isdigit()]
                elif stripped.lower().startswith("file:"):
                    file_path = stripped.split(":", 1)[1].strip()

            self._modules[module].append(
                Task(text=text, status=status, file=file_path, skills=skills, reqs=reqs,
                     depends=depends, line_start=line_num, line_end=end)
            )

        # Remove _default if empty and other modules exist
        if not self._modules.get("_default") and len(self._modules) > 1:
            del self._modules["_default"]

        return {mod: len(tasks) for mod, tasks in self._modules.items()}

    def modules(self) -> list[str]:
        """Return list of module names."""
        return list(self._modules.keys())

    def get_next(self, module: str = "") -> Task | None:
        """Return the first unchecked task for a module."""
        key = module or "_default"
        for task in self._modules.get(key, []):
            if task.status == " ":
                return task
        return None

    def complete(self, module: str = "") -> Task | None:
        """Remove the first unchecked task block from TASKS.md and append to TASKS-DONE.md."""
        with self._lock:
            task = self.get_next(module)
            if not task:
                return None
            task.status = "x"
            block_size = task.line_end - task.line_start
            del self._raw_lines[task.line_start:task.line_end]
            # Shift line numbers for all tasks after the removed block
            for mod_tasks in self._modules.values():
                for t in mod_tasks:
                    if t.line_start > task.line_start:
                        t.line_start -= block_size
                        t.line_end -= block_size
            self._flush()
            self._append_done(task)
        return task

    def block(self, module: str = "") -> Task | None:
        """Mark the first unchecked task as blocked and write through to disk."""
        with self._lock:
            task = self.get_next(module)
            if not task:
                return None
            task.status = "!"
            self._raw_lines[task.line_start] = re.sub(
                r"^- \[ \]", "- [!]", self._raw_lines[task.line_start]
            )
            self._flush()
        return task

    def status(self, module: str = "") -> dict[str, int]:
        """Return done/blocked/remaining counts."""
        if module:
            return self._module_status(module)
        result: dict[str, int] = {"done": 0, "blocked": 0, "remaining": 0}
        for mod in self._modules:
            s = self._module_status(mod)
            for k in result:
                result[k] += s[k]
        return result

    def _module_status(self, module: str) -> dict[str, int]:
        tasks = self._modules.get(module, [])
        return {
            "done": sum(1 for t in tasks if t.status == "x"),
            "blocked": sum(1 for t in tasks if t.status == "!"),
            "remaining": sum(1 for t in tasks if t.status == " "),
        }

    def _append_done(self, task: Task) -> None:
        if not self.path:
            return
        done_path = self.path.parent / "TASKS-DONE.md"
        ts = datetime.now().isoformat(timespec="seconds")
        with open(done_path, "a", encoding="utf-8") as f:
            f.write(f"- [x] {task.text}  <!-- {ts} -->\n")

    def _flush(self) -> None:
        if self.path:
            self.path.write_text("\n".join(self._raw_lines) + "\n", encoding="utf-8")
