"""Task manifest manager — CLI-owned orchestration state (REQ-TM-1 through REQ-TM-7).

Reads/writes .voidrift/tasks/manifest.yml. Tracks task status, dependencies,
module grouping, bug references. No agent tool provides write access.
"""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

import yaml


class ManifestManager:
    """Manages .voidrift/tasks/manifest.yml and task file lifecycle."""

    def __init__(self, project_dir: Path | None = None) -> None:
        self._project = (project_dir or Path.cwd()).resolve()
        self._tasks_dir = self._project / ".voidrift" / "tasks"
        self._manifest_path = self._tasks_dir / "manifest.yml"
        self._active_dir = self._tasks_dir / "active"
        self._archived_dir = self._tasks_dir / "archived"
        self._history_path = self._tasks_dir / "history.log"
        self._data: dict = {}

    # ── Bootstrap ────────────────────────────────────────────────────────

    def ensure_dirs(self) -> None:
        """Create task directories if they don't exist."""
        self._active_dir.mkdir(parents=True, exist_ok=True)
        self._archived_dir.mkdir(parents=True, exist_ok=True)

    def exists(self) -> bool:
        """Return True if manifest.yml exists."""
        return self._manifest_path.exists()

    # ── Load / Save ──────────────────────────────────────────────────────

    def load(self) -> None:
        """Load manifest from disk."""
        if self._manifest_path.exists():
            self._data = yaml.safe_load(self._manifest_path.read_text()) or {}
        else:
            self._data = {}

    def save(self) -> None:
        """Write manifest to disk."""
        self._tasks_dir.mkdir(parents=True, exist_ok=True)
        self._manifest_path.write_text(yaml.dump(self._data, default_flow_style=False, sort_keys=False))

    # ── Accessors ────────────────────────────────────────────────────────

    @property
    def next_id(self) -> int:
        return self._data.get("next_id", 1)

    @property
    def next_bug_id(self) -> int:
        return self._data.get("next_bug_id", 1)

    def tasks(self) -> dict[int, dict]:
        """Return all active tasks: {id: {status, module, ...}}."""
        return self._data.get("tasks", {})

    def modules(self) -> dict[str, list[int]]:
        """Return module groupings: {name: [task_ids]}."""
        return self._data.get("modules", {})

    def dependencies(self) -> dict[int, list[int]]:
        """Return dependency graph: {task_id: [depends_on_ids]}."""
        return self._data.get("dependencies", {})

    def get_task(self, task_id: int) -> dict | None:
        """Return a single task's manifest entry."""
        return self.tasks().get(task_id)

    def get_status(self, task_id: int) -> str:
        """Return a task's status, or empty string if not found."""
        t = self.get_task(task_id)
        return t.get("status", "") if t else ""

    # ── Dispatch ─────────────────────────────────────────────────────────

    def dispatchable(self) -> list[int]:
        """Return task IDs that are ready to dispatch (REQ-TM-3).

        A task is dispatchable when status=planned and all dependencies
        are implemented or verified.
        """
        tasks = self.tasks()
        deps = self.dependencies()
        ready = []
        for tid, t in tasks.items():
            if t.get("status") != "planned":
                continue
            task_deps = deps.get(tid, [])
            if all(self.get_status(d) in ("implemented", "verified") for d in task_deps):
                ready.append(tid)
        return ready

    def has_work(self) -> bool:
        """Return True if any tasks are not verified/blocked."""
        return any(t.get("status") in ("planned", "in-progress", "implemented", "failed")
                   for t in self.tasks().values())

    # ── Status Transitions (REQ-TM-2) ───────────────────────────────────

    def set_status(self, task_id: int, status: str) -> None:
        """Set a task's status and handle side effects."""
        tasks = self._data.setdefault("tasks", {})
        if task_id not in tasks:
            return
        tasks[task_id]["status"] = status

        if status == "failed":
            self._block_dependents(task_id)
        elif status in ("implemented", "verified"):
            self._unblock_dependents(task_id)

        self.save()

    def _block_dependents(self, failed_id: int) -> None:
        """Transitively block all tasks depending on failed_id."""
        deps = self.dependencies()
        tasks = self.tasks()
        to_block = set()
        frontier = [tid for tid, d in deps.items() if failed_id in d]
        while frontier:
            tid = frontier.pop()
            if tid in to_block:
                continue
            to_block.add(tid)
            if tasks.get(tid, {}).get("status") in ("planned", "in-progress"):
                tasks[tid]["status"] = "blocked"
            frontier.extend(t for t, d in deps.items() if tid in d)

    def _unblock_dependents(self, resolved_id: int) -> None:
        """Unblock tasks whose dependencies are now all met."""
        deps = self.dependencies()
        tasks = self.tasks()
        for tid, task_deps in deps.items():
            if resolved_id not in task_deps:
                continue
            if tasks.get(tid, {}).get("status") != "blocked":
                continue
            if all(self.get_status(d) in ("implemented", "verified") for d in task_deps):
                tasks[tid]["status"] = "planned"

    # ── Task File Access ─────────────────────────────────────────────────

    def task_path(self, task_id: int) -> Path:
        """Return the path to a task file in active/."""
        return self._active_dir / f"TASK-{task_id}.md"

    def bug_path(self, bug_id: int) -> Path:
        """Return the path to a bug file in active/."""
        return self._active_dir / f"BUG-{bug_id}.md"

    def read_task(self, task_id: int) -> str:
        """Read a task file's content."""
        p = self.task_path(task_id)
        if p.exists():
            return p.read_text()
        return ""

    # ── Registration ─────────────────────────────────────────────────────

    def add_task(self, task_id: int, module: str, depends: list[int] | None = None) -> None:
        """Register a task in the manifest."""
        tasks = self._data.setdefault("tasks", {})
        tasks[task_id] = {"status": "planned", "module": module}
        modules = self._data.setdefault("modules", {})
        modules.setdefault(module, [])
        if task_id not in modules[module]:
            modules[module].append(task_id)
        if depends:
            deps = self._data.setdefault("dependencies", {})
            deps[task_id] = depends
        self._data["next_id"] = max(self.next_id, task_id + 1)
        self.save()

    def add_bug(self, bug_id: int, refs: list[int] | None = None) -> None:
        """Register a bug in the manifest."""
        bugs = self._data.setdefault("bugs", {})
        bugs[bug_id] = {"status": "open", "refs": refs or []}
        self._data["next_bug_id"] = max(self.next_bug_id, bug_id + 1)
        if refs:
            tasks = self.tasks()
            for tid in refs:
                if tid in tasks:
                    tasks[tid].setdefault("refs", [])
                    if bug_id not in tasks[tid]["refs"]:
                        tasks[tid]["refs"].append(bug_id)
        self.save()

    # ── Archive (REQ-TM-5, REQ-TM-6) ────────────────────────────────────

    def archive(self, task_id: int) -> None:
        """Move a verified task to archived/ and log to history."""
        tasks = self._data.get("tasks", {})
        if task_id not in tasks:
            return
        task = tasks[task_id]
        module = task.get("module", "")
        assigned = task.get("assigned", "")

        # Move task file
        src = self.task_path(task_id)
        dst = self._archived_dir / src.name
        if src.exists():
            self._archived_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

        # Move referenced bug files if all their task refs are verified
        for bug_id in task.get("refs", []):
            bugs = self._data.get("bugs", {})
            bug = bugs.get(bug_id, {})
            bug_refs = bug.get("refs", [])
            if all(self.get_status(r) == "verified" or r == task_id for r in bug_refs):
                bug_src = self.bug_path(bug_id)
                if bug_src.exists():
                    shutil.move(str(bug_src), str(self._archived_dir / bug_src.name))
                bugs.pop(bug_id, None)

        # Remove from manifest
        del tasks[task_id]
        modules = self.modules()
        for mod_tasks in modules.values():
            if task_id in mod_tasks:
                mod_tasks.remove(task_id)
        deps = self._data.get("dependencies", {})
        deps.pop(task_id, None)

        # Append to history log
        ts = datetime.now().isoformat(timespec="seconds")
        with open(self._history_path, "a") as f:
            f.write(f"{ts} TASK-{task_id} verified module={module} assigned={assigned}\n")

        self.save()

    # ── Ideas (REQ-IDEA-1 through REQ-IDEA-4) ──────────────────────────

    @property
    def next_idea_id(self) -> int:
        return self._data.get("next_idea_id", 1)

    def ideas(self) -> dict[int, dict]:
        """Return all ideas: {id: {status}}."""
        return self._data.get("ideas", {})

    def idea_path(self, idea_id: int) -> Path:
        """Return the path to an idea file in active/."""
        return self._active_dir / f"IDEA-{idea_id}.md"

    def add_idea(self, idea_id: int, status: str = "draft") -> None:
        """Register an idea in the manifest."""
        ideas = self._data.setdefault("ideas", {})
        ideas[idea_id] = {"status": status}
        self._data["next_idea_id"] = max(self.next_idea_id, idea_id + 1)
        self.save()

    def set_idea_status(self, idea_id: int, status: str) -> None:
        """Update an idea's status."""
        ideas = self._data.get("ideas", {})
        if idea_id in ideas:
            ideas[idea_id]["status"] = status
            self.save()

    def read_idea(self, idea_id: int) -> str:
        """Read an idea file's content."""
        p = self.idea_path(idea_id)
        return p.read_text() if p.exists() else ""

    # ── Summary ──────────────────────────────────────────────────────────

    def summary(self) -> dict[str, int]:
        """Return counts by status."""
        counts: dict[str, int] = {}
        for t in self.tasks().values():
            s = t.get("status", "unknown")
            counts[s] = counts.get(s, 0) + 1
        return counts
