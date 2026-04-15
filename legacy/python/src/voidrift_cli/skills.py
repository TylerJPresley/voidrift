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


def _parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter as dict. Returns {} if absent."""
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            import yaml
            try:
                return yaml.safe_load(content[4:end]) or {}
            except Exception:
                pass
    return {}


def get_skill_allowed_tools(name: str, project_dir: Path | str | None = None) -> list[str] | None:
    """Return the allowed_tools list from a skill's frontmatter, or None if absent (REQ-SKL-9)."""
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    upper = name.upper()
    for skills_dir in _skill_dirs(project_dir):
        candidate = skills_dir / f"{upper}.md"
        if candidate.is_file():
            fm = _parse_frontmatter(candidate.read_text(encoding="utf-8"))
            return fm.get("allowed_tools")
    return None


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


def _is_draft(project_dir: Path, name: str) -> bool:
    """Return True if the project-layer skill exists and has status: draft frontmatter."""
    candidate = project_dir / ".voidrift" / "skills" / f"{name.upper()}.md"
    if not candidate.is_file():
        return False
    fm = _parse_frontmatter(candidate.read_text(encoding="utf-8"))
    return str(fm.get("status", "")).lower() == "draft"


def _synthesize_skill(name: str, project_dir: Path, model: object) -> str:
    """Invoke an AgentLoop to generate skill content for ``name``.

    Writes the result as a draft to the project skill directory and returns
    the stripped content (frontmatter removed).

    Args:
        name: Skill name (upper case preferred).
        project_dir: Project root.
        model: A :class:`~voidrift_cli.models.ModelConfig` instance.

    Returns:
        The synthesized skill body (frontmatter stripped).
    """
    from . import prompts as _prompts
    from .agent import AgentLoop

    upper = name.upper()
    system_prompt_raw = _prompts.load_prompt("skills", "SYNTHESIS-DIRECT") or (
        f"You are synthesizing a VoidRift skill named {upper}. "
        "Write a concise, actionable skill guide in markdown. "
        "Include a YAML frontmatter block with: name, description, status: draft."
    )
    system = system_prompt_raw.format(name=upper) if "{name}" in system_prompt_raw else system_prompt_raw
    user_msg = (
        f"Synthesize a VoidRift skill for: {upper}\n\n"
        "Include practical implementation guidance."
    )

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=[],
        tool_handlers={},
        stream=False,
        show_spinner=False,
    )
    result = agent.send(user_msg)

    # Ensure frontmatter is present with status: draft
    if not result.strip().startswith("---"):
        result = (
            f"---\nname: {upper}\n"
            f"description: Synthesized skill for {name.lower()}\n"
            f"status: draft\n---\n\n{result}"
        )
    else:
        # Inject status: draft if not already present
        fm = _parse_frontmatter(result)
        if "status" not in fm:
            result = result.replace("---\n", "---\n", 1)
            # Insert after first ---
            end = result.find("\n---\n", 4)
            if end != -1:
                result = result[: end] + "\nstatus: draft" + result[end:]

    # Write to project skill directory
    skill_dir = project_dir / ".voidrift" / "skills"
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_path = skill_dir / f"{upper}.md"
    skill_path.write_text(result, encoding="utf-8")

    # Invalidate cache entry so caller gets fresh content
    cache_key = (upper, str(project_dir))
    _cache.pop(cache_key, None)

    return _strip_frontmatter(result)


def find_or_synthesize_skill(
    name: str,
    project_dir: Path | str | None = None,
    model: object = None,
) -> str | None:
    """Return skill content, synthesizing a draft if no approved skill is found (REQ-SKL-5).

    Resolution order:
      1. If a non-draft skill exists at any layer → return it (no synthesis).
      2. If a draft skill exists in the project layer → return it as-is.
      3. Otherwise, synthesize a new draft via ``model`` if provided and write
         it to ``.voidrift/skills/{NAME}.md`` with ``status: draft``.

    Args:
        name: Skill name (case-insensitive).
        project_dir: Project root directory. Defaults to cwd.
        model: A :class:`~voidrift_cli.models.ModelConfig` used for synthesis.
               If None, synthesis is skipped.

    Returns:
        Skill body (frontmatter stripped) or None if no skill exists and synthesis
        is unavailable.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()

    # Try normal resolution first (non-draft skills win)
    existing = find_skill(name, project_dir)
    if existing is not None and not _is_draft(project_dir, name):
        return existing

    # Return draft if it exists
    if _is_draft(project_dir, name):
        return existing  # content already stripped by find_skill

    # Synthesize if a model is available
    if model is None:
        return None

    return _synthesize_skill(name, project_dir, model)


def approve_draft_skill(name: str, project_dir: Path | str | None = None) -> bool:
    """Promote a draft project-layer skill to approved status (REQ-SKL-5).

    Updates the ``status`` frontmatter field from ``draft`` to ``approved``
    in place. Invalidates the skill cache.

    Args:
        name: Skill name (case-insensitive).
        project_dir: Project root directory. Defaults to cwd.

    Returns:
        True if the skill was found and promoted, False otherwise.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    upper = name.upper()
    skill_path = project_dir / ".voidrift" / "skills" / f"{upper}.md"
    if not skill_path.is_file():
        return False

    content = skill_path.read_text(encoding="utf-8")
    fm = _parse_frontmatter(content)
    if str(fm.get("status", "")).lower() != "draft":
        return False  # already approved or not a draft

    # Replace status: draft with status: approved
    import re
    updated = re.sub(
        r"^(status:\s*)draft\s*$",
        r"\1approved",
        content,
        flags=re.MULTILINE,
    )
    skill_path.write_text(updated, encoding="utf-8")
    # Invalidate cache
    _cache.pop((upper, str(project_dir)), None)
    return True


def clear_cache() -> None:
    """Clear the in-process skill cache. Useful for tests."""
    _cache.clear()


def make_skill_tool_guard(allowed: list[str] | None, skill_name: str = ""):
    """Return a before_tool_call hook enforcing allowed_tools (REQ-SKL-9).

    Returns None (no restriction) when allowed is None.
    """
    if allowed is None:
        return None

    allowed_set = set(allowed)

    def _guard(name: str, args: str) -> str | None:
        if name in allowed_set:
            return None  # allow
        names = ", ".join(sorted(allowed_set)) if allowed_set else "none"
        return (
            f"Tool '{name}' blocked by skill '{skill_name}'. "
            f"Allowed tools: {names}."
        )

    return _guard
