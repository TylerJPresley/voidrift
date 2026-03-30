"""CLI-native task store for parsing and managing TASKS.md (REQ-CTX-3).

Parses a single TASKS.md into per-module task queues.
Supports ``## Module: <name>`` headers for multi-module projects.
Write-through: all state changes persist back to disk immediately.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel, PrivateAttr

_TASK_RE = re.compile(r"^- \[([ x!])\] (.+)$")
_SKILL_RE = re.compile(r"\[([^\]]+)\]\s*$")


class Task(BaseModel):
    """A single task parsed from TASKS.md."""

    text: str
    status: str  # " " = pending, "x" = done, "!" = blocked
    skills: list[str] = []
    line_num: int = 0


class TaskStore(BaseModel):
    """Manages tasks from a single TASKS.md, split by module headers (REQ-CTX-3)."""

    path: Path | None = None
    _modules: dict[str, list[Task]] = PrivateAttr(default_factory=dict)
    _raw_lines: list[str] = PrivateAttr(default_factory=list)

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

        for i, line in enumerate(self._raw_lines):
            header = re.match(r"^## Module:\s*(.+)$", line)
            if header:
                current_module = header.group(1).strip()
                if current_module not in self._modules:
                    self._modules[current_module] = []
                continue

            m = _TASK_RE.match(line)
            if m:
                status, text = m.group(1), m.group(2)
                skills: list[str] = []
                sm = _SKILL_RE.search(text)
                if sm:
                    skills = [s.strip().lower() for s in sm.group(1).split(",")]
                self._modules[current_module].append(
                    Task(text=text, status=status, skills=skills, line_num=i)
                )

        # Remove _default if empty and other modules exist
        if not self._modules.get("_default") and len(self._modules) > 1:
            del self._modules["_default"]

        return {mod: len(tasks) for mod, tasks in self._modules.items()}

    def modules(self) -> list[str]:
        """Return list of module names."""
        return list(self._modules.keys())

    def get_next(self, module: str = "") -> Task | None:
        """Return the first unchecked task for a module.

        Args:
            module: Module name. Empty string uses _default.
        """
        key = module or "_default"
        for task in self._modules.get(key, []):
            if task.status == " ":
                return task
        return None

    def complete(self, module: str = "") -> Task | None:
        """Mark the first unchecked task as done and write through to disk.

        Args:
            module: Module name. Empty string uses _default.

        Returns:
            The completed task, or None if no pending tasks.
        """
        task = self.get_next(module)
        if not task:
            return None
        task.status = "x"
        self._raw_lines[task.line_num] = re.sub(
            r"^- \[ \]", "- [x]", self._raw_lines[task.line_num]
        )
        self._flush()
        return task

    def block(self, module: str = "") -> Task | None:
        """Mark the first unchecked task as blocked and write through to disk.

        Args:
            module: Module name. Empty string uses _default.

        Returns:
            The blocked task, or None if no pending tasks.
        """
        task = self.get_next(module)
        if not task:
            return None
        task.status = "!"
        self._raw_lines[task.line_num] = re.sub(
            r"^- \[ \]", "- [!]", self._raw_lines[task.line_num]
        )
        self._flush()
        return task

    def status(self, module: str = "") -> dict[str, int]:
        """Return done/blocked/remaining counts.

        Args:
            module: Module name. Empty returns aggregated counts across all modules.
        """
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

    def _flush(self) -> None:
        if self.path:
            self.path.write_text("\n".join(self._raw_lines) + "\n", encoding="utf-8")
