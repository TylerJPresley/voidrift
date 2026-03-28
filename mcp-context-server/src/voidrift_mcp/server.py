"""VoidRift MCP Context Server (AC-MCP1 through AC-MCP5).

Stores, retrieves, and exports project artifacts and framework resources.
Communicates via stdio using the MCP protocol.
"""

from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastmcp import FastMCP

from .artifact_store import ArtifactStore
from .markdown_parser import MarkdownIndex
from .session_store import SessionStore
from .task_store import TaskStore

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift"))
RESOURCES_DIR = VOIDRIFT_HOME / "resources"
DOMAIN_SKILLS_DIR = VOIDRIFT_HOME / "domain-skills"
PROJECT_DIR = Path.cwd()
VOIDRIFT_DIR = PROJECT_DIR / ".voidrift"
PROJECT_SKILLS_DIR = VOIDRIFT_DIR / "skills"

# ---------------------------------------------------------------------------
# Logging (REQ-LOG-5)
# ---------------------------------------------------------------------------


def _setup_mcp_log() -> None:
    """Initialize the MCP server log at ~/.voidrift/logs/mcp.log."""
    log_dir = VOIDRIFT_HOME / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    logger = logging.getLogger("voidrift.mcp")
    if logger.handlers:
        return
    logger.setLevel(logging.DEBUG)
    handler = RotatingFileHandler(
        log_dir / "mcp.log",
        maxBytes=1 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    ))
    logger.addHandler(handler)
    logger.propagate = False


def _mcp_log() -> logging.Logger:
    logger = logging.getLogger("voidrift.mcp")
    if not logger.handlers:
        _setup_mcp_log()
    return logger


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
index = MarkdownIndex()
artifacts = ArtifactStore(voidrift_dir=VOIDRIFT_DIR)
tasks = TaskStore()
session_store = SessionStore(db_path=VOIDRIFT_HOME / "sessions.db")
session_id: int = 0
run_id: str = ""

# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "voidrift-context",
    instructions=(
        "VoidRift MCP Context Server. Provides tools to store, retrieve, and "
        "export project artifacts and framework resources. Use get_skill() "
        "and get_skill() to pull targeted context on demand instead of loading "
        "full files."
    ),
)


def _boot() -> None:
    """Load framework resources into the index on startup."""
    global session_id
    _setup_mcp_log()
    _mcp_log().info("boot run_id=%s project=%s", run_id or "unscoped", PROJECT_DIR)
    _written_paths.clear()
    session_id = session_store.start_session(
        run_id=run_id or "unscoped",
        phase="init", project_dir=str(PROJECT_DIR)
    )
    if RESOURCES_DIR.is_dir():
        count = index.load_directory(RESOURCES_DIR)
        session_store.log_action(
            session_id, "load_resources", "framework", str(RESOURCES_DIR),
            f"Loaded {count} sections",
        )
        _mcp_log().info("loaded %d resource sections from %s", count, RESOURCES_DIR)


# ---------------------------------------------------------------------------
# Tools (AC-MCP4)
# ---------------------------------------------------------------------------


@mcp.tool()
def store_file_analysis(file_path: str, analysis: str) -> str:
    """Store analysis results for a source file.

    Args:
        file_path: Relative path of the analyzed file.
        analysis: The analysis text (purpose, functionality, dependencies, issues).
    """
    session_store.put(run_id, "analysis", file_path, analysis)
    session_store.log_action(session_id, "store", "analysis", file_path)
    return f"Stored analysis for {file_path}"


@mcp.tool()
def get_file_analysis(file_path: str) -> str:
    """Retrieve stored analysis for a specific file.

    Args:
        file_path: Relative path of the file.
    """
    result = session_store.get(run_id, "analysis", file_path)
    if result is None:
        return f"No analysis found for {file_path}"
    session_store.log_action(session_id, "get", "analysis", file_path)
    return result


@mcp.tool()
def get_all_analyses() -> str:
    """Retrieve all stored file analyses for the current run."""
    all_a = session_store.get_all(run_id, "analysis")
    if not all_a:
        return "No analyses stored yet."
    session_store.log_action(session_id, "get_all", "analysis")
    parts = []
    for path, content in sorted(all_a.items()):
        parts.append(f"## {path}\n\n{content}")
    return "\n\n---\n\n".join(parts)


@mcp.tool()
def store_requirements(content: str, key: str = "project") -> str:
    """Store requirements content in memory.

    Args:
        content: The requirements markdown text.
        key: Identifier — 'project' for REQUIREMENTS.md, or a feature name for specs.
    """
    artifacts.store("requirements", key, content)
    session_store.log_action(session_id, "store", "requirements", key)
    return f"Stored requirements: {key}"


@mcp.tool()
def get_requirements(key: str = "project") -> str:
    """Retrieve stored requirements.

    Args:
        key: 'project' for REQUIREMENTS.md, or a feature name for specs.
    """
    result = artifacts.get("requirements", key)
    if result is None:
        return f"No requirements found for '{key}'"
    session_store.log_action(session_id, "get", "requirements", key)
    return result


# ---------------------------------------------------------------------------
# Task management tools (AC-MCP4c)
# ---------------------------------------------------------------------------


@mcp.tool()
def load_tasks(path: str = ".voidrift/TASKS.md") -> str:
    """Load a TASKS.md file into the server, parsing module headers.

    Args:
        path: Relative path to the task file.
    """
    full = PROJECT_DIR / path
    if not full.exists():
        return f"Task file not found: {path}"
    counts = tasks.load(full)
    session_store.log_action(session_id, "load", "tasks", path)
    lines = [f"Loaded {sum(counts.values())} tasks from {path}"]
    for mod, count in counts.items():
        label = mod if mod != "_default" else "(default)"
        lines.append(f"  {label}: {count} tasks")
    return "\n".join(lines)


@mcp.tool()
def get_next_task(module: str = "") -> str:
    """Return the next unchecked task for a module.

    Args:
        module: Module name. Empty for single-module projects.
    """
    task = tasks.get_next(module)
    if not task:
        return f"No tasks remaining for module '{module or '_default'}'"
    session_store.log_action(session_id, "get", "task", f"{module or '_default'}")
    result = f"Task: {task.text}"
    if task.skills:
        result += f"\nSkills: {', '.join(task.skills)}"
    return result


@mcp.tool()
def complete_task(module: str = "") -> str:
    """Mark the next unchecked task as complete and write through to disk.

    Args:
        module: Module name. Empty for single-module projects.
    """
    task = tasks.complete(module)
    if not task:
        return f"No pending tasks to complete for module '{module or '_default'}'"
    session_store.log_action(session_id, "complete", "task", f"{module or '_default'}")
    status = tasks.status(module)
    return f"Completed: {task.text}\nRemaining: {status['remaining']}, Done: {status['done']}, Blocked: {status['blocked']}"


@mcp.tool()
def get_task_status(module: str = "") -> str:
    """Return task counts for a module or all modules.

    Args:
        module: Module name. Empty returns counts for all modules.
    """
    session_store.log_action(session_id, "get", "task_status", module or "all")
    if module:
        s = tasks.status(module)
        return f"Module '{module}': {s['done']} done, {s['blocked']} blocked, {s['remaining']} remaining"
    lines = []
    for mod in tasks.modules():
        s = tasks.status(mod)
        label = mod if mod != "_default" else "(default)"
        lines.append(f"{label}: {s['done']} done, {s['blocked']} blocked, {s['remaining']} remaining")
    if not lines:
        return "No tasks loaded. Use load_tasks() first."
    return "\n".join(lines)


@mcp.tool()
def get_template(name: str) -> str:
    """Retrieve a template file by name.

    Args:
        name: Template name as returned by list_templates().
    """
    file_filter = f"templates/{name.upper()}"
    all_secs = [s for s in index._sections if file_filter in s.file_path]
    if all_secs:
        session_store.log_action(session_id, "get", "template", name)
        return "\n\n".join(s.content for s in all_secs)
    available = [p.stem.lower() for p in sorted((RESOURCES_DIR / "templates").glob("*.md"))]
    return f"Template '{name}' not found. Available: {', '.join(available)}"


def _find_skill_file(name: str) -> Path | None:
    """Search for a skill file across all three layers (REQ-SKL-2).

    Search order: project (.voidrift/skills/) → domain (~/.voidrift/domain-skills/)
    → north star (~/.voidrift/resources/skills/). Returns the first match.
    """
    upper = name.upper()
    for skills_dir in (PROJECT_SKILLS_DIR, DOMAIN_SKILLS_DIR, RESOURCES_DIR / "skills"):
        candidate = skills_dir / f"{upper}.md"
        if candidate.is_file():
            return candidate
    return None


@mcp.tool()
def get_skill(name: str, topic: str = "") -> str:
    """Retrieve a skill file's content, optionally filtered to a specific topic.

    Searches project skills, domain skills, and north-star skills in order (REQ-SKL-2).

    Args:
        name: Skill name as returned by list_skills().
        topic: Optional heading within the skill to retrieve.
    """
    skill_path = _find_skill_file(name)
    if skill_path is None:
        available = ", ".join(_list_skill_names())
        _mcp_log().warning("skill not found: %s", name)
        return f"Skill '{name}' not found. Available skills: {available}"

    content = skill_path.read_text(encoding="utf-8")

    # Strip YAML frontmatter if present
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            content = content[end + 5:]

    if topic:
        # Filter to sections matching the topic heading
        lines = content.splitlines()
        matched: list[str] = []
        in_section = False
        for line in lines:
            if line.startswith("## ") or line.startswith("# "):
                in_section = topic.lower() in line.lower()
            if in_section:
                matched.append(line)
        if matched:
            session_store.log_action(session_id, "get", "skill", f"{name}/{topic}")
            return "\n".join(matched)
        return f"No section matching '{topic}' in skill '{name}'"

    session_store.log_action(session_id, "get", "skill", name)
    return content


def _first_line(path: Path) -> str:
    """Return the first non-empty, non-heading, non-frontmatter line as a description."""
    content = path.read_text(encoding="utf-8")
    # Check for YAML frontmatter description field first
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


def _list_skill_names() -> list[str]:
    """Return deduplicated skill names visible in search order (project → domain → north-star)."""
    seen: set[str] = set()
    names: list[str] = []
    for skills_dir in (PROJECT_SKILLS_DIR, DOMAIN_SKILLS_DIR, RESOURCES_DIR / "skills"):
        if skills_dir.is_dir():
            for p in sorted(skills_dir.glob("*.md")):
                key = p.stem.upper()
                if key not in seen:
                    seen.add(key)
                    names.append(p.stem.lower())
    return names


@mcp.tool()
def list_skills() -> str:
    """List all available skill files grouped by layer (north star, domain, project)."""
    sections: list[str] = []

    def _layer_lines(skills_dir: Path, label: str) -> list[str]:
        if not skills_dir.is_dir():
            return []
        lines = []
        for p in sorted(skills_dir.glob("*.md")):
            lines.append(f"  - {p.stem.lower()}: {_first_line(p)}")
        if lines:
            return [f"{label}:"] + lines
        return []

    sections += _layer_lines(RESOURCES_DIR / "skills", "North Star")
    sections += _layer_lines(DOMAIN_SKILLS_DIR, "Domain")
    pending = DOMAIN_SKILLS_DIR / "pending"
    sections += _layer_lines(pending, "Domain (pending)")
    sections += _layer_lines(PROJECT_SKILLS_DIR, "Project")

    return "\n".join(sections) if sections else "No skills found."


@mcp.tool()
def list_templates() -> str:
    """List all available template files with descriptions."""
    templates_dir = RESOURCES_DIR / "templates"
    if not templates_dir.is_dir():
        return "No templates directory found."
    lines = []
    for p in sorted(templates_dir.glob("*.md")):
        lines.append(f"- {p.stem.lower()}: {_first_line(p)}")
    return "\n".join(lines) if lines else "No templates found."


@mcp.tool()
def list_documents() -> str:
    """List all .voidrift/ project artifacts with file sizes."""
    if not VOIDRIFT_DIR.is_dir():
        return "No .voidrift/ directory found."
    lines = []
    for p in sorted(VOIDRIFT_DIR.rglob("*.md")):
        rel = p.relative_to(VOIDRIFT_DIR)
        size = p.stat().st_size
        lines.append(f"- {rel} ({size:,} bytes)")
    return "\n".join(lines) if lines else "No documents found."


@mcp.tool()
def get_prompt(phase: str, section: str) -> str:
    """Retrieve a stage-specific prompt section from resources/prompts/<phase>.md.

    Args:
        phase: Phase name as returned by list_prompts().
        section: H2 section name within the prompt file.
    """
    file_filter = f"prompts/{phase.lower()}"
    all_secs = [s for s in index._sections if file_filter in s.file_path]
    if not all_secs:
        available = [p.stem.lower() for p in sorted((RESOURCES_DIR / "prompts").glob("*.md"))]
        return f"Prompt file '{phase}' not found. Available: {', '.join(available)}"
    for s in all_secs:
        if s.heading.upper() == section.upper():
            session_store.log_action(session_id, "get", "prompt", f"{phase}/{section}")
            return s.content
    names = [s.heading for s in all_secs]
    return f"Section '{section}' not found in '{phase}'. Available: {', '.join(names)}"


@mcp.tool()
def list_prompts(phase: str = "") -> str:
    """List available prompt sections. If phase is given, list sections for that phase. Otherwise list all phases.

    Args:
        phase: Optional phase name to filter by.
    """
    prompts_dir = RESOURCES_DIR / "prompts"
    if not prompts_dir.is_dir():
        return "No prompts directory found."
    if phase:
        file_filter = f"prompts/{phase.lower()}"
        secs = [s for s in index._sections if file_filter in s.file_path]
        if not secs:
            available = [p.stem.lower() for p in sorted(prompts_dir.glob("*.md"))]
            return f"Phase '{phase}' not found. Available: {', '.join(available)}"
        return "\n".join(f"- {s.heading}" for s in secs)
    lines = []
    for p in sorted(prompts_dir.glob("*.md")):
        file_filter = f"prompts/{p.stem.lower()}"
        secs = [s for s in index._sections if file_filter in s.file_path]
        names = ", ".join(s.heading for s in secs)
        lines.append(f"- {p.stem.lower()}: {names}")
    return "\n".join(lines) if lines else "No prompts found."


@mcp.tool()
def read_source_file(path: str) -> str:
    """Read a source file from the project directory.

    Args:
        path: Relative path from the project root.
    """
    full = PROJECT_DIR / path
    if not full.exists():
        return f"File not found: {path}"
    if not full.is_file():
        return f"Not a file: {path}"
    # Safety: don't read outside project
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    session_store.log_action(session_id, "read", "source", path)
    return full.read_text(encoding="utf-8", errors="replace")


_written_paths: set = set()


@mcp.tool()
def write_file(path: str, content: str) -> str:
    """Write content to a file in the project directory.

    Args:
        path: Relative path from the project root.
        content: File content to write.
    """
    if path in _written_paths:
        return f"File already written this run: {path}"
    full = PROJECT_DIR / path
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    _written_paths.add(path)
    session_store.log_action(session_id, "write", "file", path)
    _mcp_log().info("write path=%s bytes=%d", path, len(content))
    return f"Wrote {len(content)} bytes to {path}"


@mcp.tool()
def export_to_file(artifact_type: str, path: str) -> str:
    """Export a stored artifact to a file on disk.

    Args:
        artifact_type: Artifact type — 'analysis' or 'requirements'.
        path: Relative path to write to.
    """
    full = PROJECT_DIR / path
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    # For requirements, use the key from the path
    key = Path(path).stem
    if artifact_type == "requirements" and key == "REQUIREMENTS":
        key = "project"
    # Check SessionStore for ephemeral types, ArtifactStore for persistent
    if artifact_type == "analysis":
        content = session_store.get(run_id, "analysis", key)
        if content:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content, encoding="utf-8")
            session_store.log_action(session_id, "export", artifact_type, path)
            return f"Exported {artifact_type}:{key} to {path}"
        return f"No artifact found for {artifact_type}:{key}"
    ok = artifacts.export_to_file(artifact_type, key, full)
    if ok:
        session_store.log_action(session_id, "export", artifact_type, path)
        return f"Exported {artifact_type}:{key} to {path}"
    return f"No artifact found for {artifact_type}:{key}"


@mcp.tool()
def list_project_artifacts() -> str:
    """List all files in the project's .voidrift/ directory."""
    if not VOIDRIFT_DIR.is_dir():
        return "No .voidrift/ directory found."
    files = sorted(VOIDRIFT_DIR.rglob("*"))
    result = []
    for f in files:
        if f.is_file():
            rel = f.relative_to(PROJECT_DIR)
            size = f.stat().st_size
            result.append(f"  {rel} ({size} bytes)")
    if not result:
        return ".voidrift/ directory is empty."
    return f"Project artifacts ({len(result)} files):\n" + "\n".join(result)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the MCP server over stdio."""
    _boot()
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
