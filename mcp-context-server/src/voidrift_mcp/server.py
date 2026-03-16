"""VoidRift MCP Context Server (AC-MCP1 through AC-MCP5).

Stores, retrieves, and exports project artifacts and framework resources.
Communicates via stdio using the MCP protocol.
"""

from __future__ import annotations

import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .artifact_store import ArtifactStore
from .markdown_parser import MarkdownIndex
from .session_store import SessionStore

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
VOIDRIFT_HOME = Path(os.environ.get("VOIDRIFT_HOME", Path.home() / "opt" / "voidrift"))
RESOURCES_DIR = VOIDRIFT_HOME / "resources"
PROJECT_DIR = Path(os.environ.get("VOIDRIFT_PROJECT_DIR", Path.cwd()))
VOIDRIFT_DIR = PROJECT_DIR / ".voidrift"

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
index = MarkdownIndex()
artifacts = ArtifactStore()
session_store = SessionStore()  # in-memory by default
session_id: int = 0

# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "voidrift-context",
    instructions=(
        "VoidRift MCP Context Server. Provides tools to store, retrieve, and "
        "export project artifacts and framework resources. Use get_conventions() "
        "and get_skill() to pull targeted context on demand instead of loading "
        "full files."
    ),
)


def _boot() -> None:
    """Load framework resources into the index on startup."""
    global session_id
    session_id = session_store.start_session(
        phase="init", project_dir=str(PROJECT_DIR)
    )
    if RESOURCES_DIR.is_dir():
        count = index.load_directory(RESOURCES_DIR)
        session_store.log_action(
            session_id, "load_resources", "framework", str(RESOURCES_DIR),
            f"Loaded {count} sections",
        )


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
    artifacts.store("analysis", file_path, analysis)
    session_store.log_action(session_id, "store", "analysis", file_path)
    return f"Stored analysis for {file_path}"


@mcp.tool()
def get_file_analysis(file_path: str) -> str:
    """Retrieve stored analysis for a specific file.

    Args:
        file_path: Relative path of the file.
    """
    result = artifacts.get("analysis", file_path)
    if result is None:
        return f"No analysis found for {file_path}"
    session_store.log_action(session_id, "get", "analysis", file_path)
    return result


@mcp.tool()
def get_all_analyses() -> str:
    """Retrieve all stored file analyses as a combined document."""
    all_a = artifacts.get_all("analysis")
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
        # Try reading from disk
        if key == "project":
            p = VOIDRIFT_DIR / "REQUIREMENTS.md"
        else:
            p = VOIDRIFT_DIR / "spec" / f"{key}.md"
        if p.exists():
            result = p.read_text(encoding="utf-8")
            artifacts.store("requirements", key, result)
        else:
            return f"No requirements found for '{key}'"
    session_store.log_action(session_id, "get", "requirements", key)
    return result


@mcp.tool()
def get_conventions(section: str = "") -> str:
    """Retrieve operational conventions, optionally filtered to a specific section.

    Args:
        section: Heading name to retrieve (e.g. 'Escalation Protocol'). Empty returns all.
    """
    if section:
        s = index.get_section(section, file_filter="CONVENTIONS")
        if s:
            session_store.log_action(session_id, "get", "conventions", section)
            return s.content
        # Try fuzzy search
        results = index.search(section, file_filter="CONVENTIONS")
        if results:
            session_store.log_action(session_id, "get", "conventions", section)
            return "\n\n---\n\n".join(r.content for r in results)
        return f"No conventions section matching '{section}'"
    # Return all conventions headings as a table of contents
    headings = index.list_headings(file_filter="CONVENTIONS")
    session_store.log_action(session_id, "get", "conventions", "toc")
    return "Available conventions sections:\n" + "\n".join(f"- {h}" for h in headings)


@mcp.tool()
def get_skill(name: str, topic: str = "") -> str:
    """Retrieve a skill file's content, optionally filtered to a specific topic.

    Args:
        name: Skill name (e.g. 'backend', 'frontend', 'infra').
        topic: Optional heading within the skill to retrieve.
    """
    file_filter = f"skills/{name.upper()}"
    if topic:
        results = index.search(topic, file_filter=file_filter)
        if results:
            session_store.log_action(session_id, "get", "skill", f"{name}/{topic}")
            return "\n\n---\n\n".join(r.content for r in results)
        return f"No section matching '{topic}' in skill '{name}'"
    # Return all headings for this skill
    headings = index.list_headings(file_filter=file_filter)
    if not headings:
        return f"Skill '{name}' not found. Available skills: {', '.join(_list_skills())}"
    # Return full content
    sections = index.search("", file_filter=file_filter)
    # Actually return all sections since empty query won't match
    all_secs = [s for s in index._sections if file_filter in s.file_path]
    if all_secs:
        session_store.log_action(session_id, "get", "skill", name)
        return "\n\n".join(s.content for s in all_secs)
    return f"Skill '{name}' not found."


def _list_skills() -> list[str]:
    skills_dir = RESOURCES_DIR / "skills"
    if not skills_dir.is_dir():
        return []
    return [p.stem.lower() for p in sorted(skills_dir.glob("*.md"))]


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


@mcp.tool()
def write_file(path: str, content: str) -> str:
    """Write content to a file in the project directory.

    Args:
        path: Relative path from the project root.
        content: File content to write.
    """
    full = PROJECT_DIR / path
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    session_store.log_action(session_id, "write", "file", path)
    return f"Wrote {len(content)} bytes to {path}"


@mcp.tool()
def export_to_file(artifact_type: str, path: str) -> str:
    """Export a stored artifact to a file on disk.

    Args:
        artifact_type: Type of artifact (e.g. 'analysis', 'requirements').
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


@mcp.tool()
def get_framework_resource(name: str) -> str:
    """Retrieve a framework resource file by name.

    Args:
        name: File name (e.g. 'AGENT-ANALYST.md', 'CONVENTIONS.md', 'SKILLS.md').
    """
    p = RESOURCES_DIR / name
    if not p.exists():
        # Try in subdirectories
        candidates = list(RESOURCES_DIR.rglob(name))
        if candidates:
            p = candidates[0]
        else:
            available = [f.name for f in RESOURCES_DIR.rglob("*.md")]
            return f"Resource '{name}' not found. Available: {', '.join(sorted(available))}"
    session_store.log_action(session_id, "get", "resource", name)
    return p.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the MCP server over stdio."""
    _boot()
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
