"""In-memory artifact store for project artifacts (AC-MCP3)."""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, PrivateAttr


class ArtifactStore(BaseModel):
    """Holds project artifacts in memory during a session, exports to disk on demand."""

    _artifacts: dict[str, str] = PrivateAttr(default_factory=dict)
    # Keyed by type:key, e.g. "analysis:src/main.py" or "requirements:project"

    def store(self, artifact_type: str, key: str, content: str) -> None:
        self._artifacts[f"{artifact_type}:{key}"] = content

    def get(self, artifact_type: str, key: str) -> str | None:
        return self._artifacts.get(f"{artifact_type}:{key}")

    def get_all(self, artifact_type: str) -> dict[str, str]:
        prefix = f"{artifact_type}:"
        return {
            k[len(prefix):]: v
            for k, v in self._artifacts.items()
            if k.startswith(prefix)
        }

    def export_to_file(self, artifact_type: str, key: str, path: Path) -> bool:
        content = self.get(artifact_type, key)
        if content is None:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return True

    def export_all(self, artifact_type: str, directory: Path, extension: str = ".md") -> int:
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
        return len(self._artifacts)
