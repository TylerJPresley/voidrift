"""Two-layer project memory system (REQ-MEM-1).

Project memory: <project>/.voidrift/memory/
Global memory:  ~/.voidrift/memory/
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class MemoryEntry:
    """A single memory entry's metadata."""

    name: str
    scope: str  # "project" or "global"
    description: str


class MemoryManager:
    """Manages two-layer memory: project (.voidrift/memory/) and global (~/.voidrift/memory/).

    Project entries override global entries with the same name.
    """

    def __init__(self, project_dir: str):
        self._project_dir = Path(project_dir) / ".voidrift" / "memory"
        self._global_dir = Path.home() / ".voidrift" / "memory"

    def read(self, name: str) -> str | None:
        """Read a memory entry by name. Project first, then global."""
        for d in (self._project_dir, self._global_dir):
            p = d / f"{name}.md"
            if p.exists():
                return p.read_text()
        return None

    def write(self, name: str, content: str, scope: str = "project", description: str = "") -> None:
        """Write or update a memory entry and rebuild the index."""
        d = self._project_dir if scope == "project" else self._global_dir
        d.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat()
        p = d / f"{name}.md"
        # Preserve created timestamp on update
        created = now
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("created:"):
                    created = line.split(":", 1)[1].strip()
                    break
        fm = f"---\nname: {name}\nscope: {scope}\ndescription: {description}\ncreated: {created}\nupdated: {now}\n---\n"
        p.write_text(fm + content)
        self._rebuild_index(d)

    def delete(self, name: str, scope: str = "project") -> bool:
        """Delete a memory entry and rebuild the index."""
        d = self._project_dir if scope == "project" else self._global_dir
        p = d / f"{name}.md"
        if not p.exists():
            return False
        p.unlink()
        self._rebuild_index(d)
        return True

    def list_entries(self) -> list[MemoryEntry]:
        """List all entries, project overriding global on name collision."""
        seen: dict[str, MemoryEntry] = {}
        for d, scope in ((self._global_dir, "global"), (self._project_dir, "project")):
            if not d.is_dir():
                continue
            for p in sorted(d.glob("*.md")):
                if p.name == "MEMORY.md":
                    continue
                name = p.stem
                desc = ""
                for line in p.read_text().splitlines():
                    if line.startswith("description:"):
                        desc = line.split(":", 1)[1].strip()
                        break
                seen[name] = MemoryEntry(name=name, scope=scope, description=desc)
        return list(seen.values())

    def index_prompt_block(self) -> str:
        """Compact block for system prompt injection — names and descriptions only."""
        entries = self.list_entries()
        if not entries:
            return ""
        lines = ["## Project Memory (use read_memory to load details)"]
        for e in entries:
            lines.append(f"- {e.name}: {e.description}")
        return "\n".join(lines)

    def _rebuild_index(self, d: Path) -> None:
        """Rebuild MEMORY.md index for a layer directory."""
        entries = []
        for p in sorted(d.glob("*.md")):
            if p.name == "MEMORY.md":
                continue
            name = p.stem
            desc = ""
            for line in p.read_text().splitlines():
                if line.startswith("description:"):
                    desc = line.split(":", 1)[1].strip()
                    break
            entries.append((name, desc))
        lines = ["# Memory Index\n"]
        for name, desc in entries:
            lines.append(f"- [{name}]({name}.md) — {desc}")
        (d / "MEMORY.md").write_text("\n".join(lines) + "\n")
