"""Write-through artifact store for project artifacts (AC-MCP3).

Writes to both in-memory cache and disk simultaneously.
Memory serves as a read cache; disk is the source of truth.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, PrivateAttr


class ArtifactStore(BaseModel):
    """Caches project artifacts in memory, writes through to disk on store."""

    voidrift_dir: Path = Path(".voidrift")
    _artifacts: dict[str, str] = PrivateAttr(default_factory=dict)

    def _disk_path(self, artifact_type: str, key: str) -> Path | None:
        """Map artifact type+key to a disk path, or None if memory-only."""
        if artifact_type == "requirements":
            if key == "project":
                return self.voidrift_dir / "REQUIREMENTS.md"
            return self.voidrift_dir / "spec" / f"{key}.md"
        return None

    def store(self, artifact_type: str, key: str, content: str) -> None:
        """Store artifact in memory and write through to disk."""
        self._artifacts[f"{artifact_type}:{key}"] = content
        p = self._disk_path(artifact_type, key)
        if p:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")

    def get(self, artifact_type: str, key: str) -> str | None:
        """Get from memory cache, falling back to disk."""
        cached = self._artifacts.get(f"{artifact_type}:{key}")
        if cached is not None:
            return cached
        p = self._disk_path(artifact_type, key)
        if p and p.exists():
            content = p.read_text(encoding="utf-8")
            self._artifacts[f"{artifact_type}:{key}"] = content
            return content
        return None

    def get_all(self, artifact_type: str) -> dict[str, str]:
        """Get all artifacts of a given type from cache."""
        prefix = f"{artifact_type}:"
        return {
            k[len(prefix):]: v
            for k, v in self._artifacts.items()
            if k.startswith(prefix)
        }

    def export_to_file(self, artifact_type: str, key: str, path: Path) -> bool:
        """Export a specific artifact to an arbitrary path."""
        content = self.get(artifact_type, key)
        if content is None:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return True

    def export_all(self, artifact_type: str, directory: Path, extension: str = ".md") -> int:
        """Export all artifacts of a type to a directory."""
        items = self.get_all(artifact_type)
        count = 0
        for key, content in items.items():
            safe_name = key.replace("/", "_").replace("\\", "_")
            path = directory / f"{safe_name}{extension}"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            count += 1
        return count

    @property
    def count(self) -> int:
        """Number of cached artifacts."""
        return len(self._artifacts)
