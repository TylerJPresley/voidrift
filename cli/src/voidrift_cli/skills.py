"""CLI-native skill resolution (REQ-CTX-1, REQ-SKL-2).

Three-layer search: project (.voidrift/skills/) → domain (~/.voidrift/domain-skills/)
→ north star (~/.voidrift/resources/skills/). First match wins.

Results are cached in process memory for the duration of the run (REQ-CTX-6).
"""

from __future__ import annotations

import os
from pathlib import Path

_VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift"))

# In-process cache: keyed by (name_upper, project_dir)
_cache: dict[tuple[str, str], str | None] = {}


def _skill_dirs(project_dir: Path) -> list[Path]:
    """Return skill search directories in resolution order."""
    return [
        project_dir / ".voidrift" / "skills",
        _VOIDRIFT_HOME / "domain-skills",
        _VOIDRIFT_HOME / "resources" / "skills",
    ]


def _strip_frontmatter(content: str) -> str:
    """Strip YAML frontmatter if present."""
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            return content[end + 5:]
    return content


def find_skill(name: str, project_dir: Path | str | None = None) -> str | None:
    """Find and return skill content using 3-layer resolution (REQ-CTX-1, REQ-SKL-2).

    Search order: project (.voidrift/skills/) → domain (~/.voidrift/domain-skills/)
    → north star (~/.voidrift/resources/skills/). Returns the first match with
    YAML frontmatter stripped. Returns None if not found at any layer.

    Results are cached in process memory for the duration of the run (REQ-CTX-6).

    Args:
        name: Skill name (case-insensitive, e.g. "BACKEND-ENG" or "backend-eng").
        project_dir: Project root directory. Defaults to cwd.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    cache_key = (name.upper(), str(project_dir))
    if cache_key in _cache:
        return _cache[cache_key]

    upper = name.upper()
    for skills_dir in _skill_dirs(project_dir):
        candidate = skills_dir / f"{upper}.md"
        if candidate.is_file():
            content = candidate.read_text(encoding="utf-8")
            result = _strip_frontmatter(content)
            _cache[cache_key] = result
            return result

    _cache[cache_key] = None
    return None


def list_skills(project_dir: Path | str | None = None) -> str:
    """List all available skill files grouped by layer.

    Args:
        project_dir: Project root directory. Defaults to cwd.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    dirs = _skill_dirs(project_dir)
    labels = ["Project", "Domain", "North Star"]
    seen: set[str] = set()
    sections: list[str] = []

    for skills_dir, label in zip(dirs, labels):
        if not skills_dir.is_dir():
            continue
        lines = []
        for p in sorted(skills_dir.glob("*.md")):
            key = p.stem.upper()
            if key in seen:
                continue
            seen.add(key)
            desc = _first_line(p)
            lines.append(f"  - {p.stem.lower()}: {desc}")
        if lines:
            sections.append(f"{label}:\n" + "\n".join(lines))

    return "\n\n".join(sections) if sections else "No skills found."


def _first_line(path: Path) -> str:
    """Return a one-line description from a skill file (frontmatter or first text line)."""
    content = path.read_text(encoding="utf-8")
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            for line in content[4:end].splitlines():
                if line.startswith("description:"):
                    return line[len("description:"):].strip()[:120]
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
            return stripped[:120]
    return ""


def clear_cache() -> None:
    """Clear the in-process skill cache. Useful for tests."""
    _cache.clear()
