"""CLI-native prompt and template loading (REQ-RES-6, REQ-CTX-6).

Loads prompts directly from disk at command init. Parses H2 sections from
{cmd}.md files.

Three-layer search for both prompts and templates:
  project (.voidrift/prompts/ | .voidrift/templates/)
  → domain (~/.voidrift/domain-prompts/ | ~/.voidrift/domain-templates/)
  → north star (~/.voidrift/resources/prompts/ | ~/.voidrift/resources/templates/)
First match wins.

Results are cached in process memory for the duration of the run (REQ-CTX-6).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift"))

# In-process caches
_prompt_cache: dict[tuple[str, str, str], str] = {}   # (cmd, section, project_dir) -> content
_template_cache: dict[tuple[str, str], str] = {}       # (name_upper, project_dir) -> content


def _prompt_dirs(project_dir: Path) -> list[Path]:
    return [
        project_dir / ".voidrift" / "prompts",
        _VOIDRIFT_HOME / "domain-prompts",
        _VOIDRIFT_HOME / "resources" / "prompts",
    ]


def _template_dirs(project_dir: Path) -> list[Path]:
    return [
        project_dir / ".voidrift" / "templates",
        _VOIDRIFT_HOME / "domain-templates",
        _VOIDRIFT_HOME / "resources" / "templates",
    ]


def _parse_sections(content: str) -> dict[str, str]:
    """Parse H2 sections from markdown content. Returns section_name -> body."""
    sections: dict[str, str] = {}
    parts = re.split(r"^## (.+)$", content, flags=re.MULTILINE)
    # parts[0] = preamble (ignored); then alternating: section_name, section_content
    for i in range(1, len(parts), 2):
        name = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        sections[name] = body.strip()
    return sections


def load_prompt(cmd: str, section: str, project_dir: Path | str | None = None) -> str:
    """Load a section from a command prompt file (REQ-RES-6, REQ-CTX-6).

    Three-layer search: project → domain → north star. Returns empty string if
    the command file or section is not found.

    Args:
        cmd: Command name (e.g. "gather", "plan", "develop", "chat", "system").
        section: H2 section name within the command file (e.g. "TRIAGE", "SYSTEM").
        project_dir: Project root directory. Defaults to cwd.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    cache_key = (cmd, section, str(project_dir))
    if cache_key in _prompt_cache:
        return _prompt_cache[cache_key]

    for prompt_dir in _prompt_dirs(project_dir):
        candidate = prompt_dir / f"{cmd}.md"
        if candidate.is_file():
            sections = _parse_sections(candidate.read_text(encoding="utf-8"))
            result = sections.get(section, "")
            _prompt_cache[cache_key] = result
            return result

    _prompt_cache[cache_key] = ""
    return ""


def load_template(name: str, project_dir: Path | str | None = None) -> str:
    """Load a template file, stripping YAML frontmatter (REQ-RES-6, REQ-CTX-6).

    Three-layer search: project → domain → north star. Returns empty string if
    the template is not found at any layer.

    Args:
        name: Template name without extension, case-insensitive (e.g. "REQUIREMENTS-TEMPLATE").
        project_dir: Project root directory. Defaults to cwd.
    """
    project_dir = Path(project_dir) if project_dir else Path.cwd()
    upper = name.upper()
    cache_key = (upper, str(project_dir))
    if cache_key in _template_cache:
        return _template_cache[cache_key]

    for tmpl_dir in _template_dirs(project_dir):
        candidate = tmpl_dir / f"{upper}.md"
        if candidate.is_file():
            content = candidate.read_text(encoding="utf-8")
            if content.startswith("---\n"):
                end = content.find("\n---\n", 4)
                if end != -1:
                    content = content[end + 5:]
            _template_cache[cache_key] = content.strip()
            return _template_cache[cache_key]

    _template_cache[cache_key] = ""
    return ""


def clear_cache() -> None:
    """Clear all in-process caches. Useful for tests."""
    _prompt_cache.clear()
    _template_cache.clear()
