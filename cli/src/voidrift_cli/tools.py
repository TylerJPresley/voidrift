"""CLI-native filesystem tools (REQ-MCP-4a).

These run on the workstation — not via MCP — because they need local
filesystem access.
"""

from __future__ import annotations

from pathlib import Path

PROJECT_DIR = Path.cwd()


def write_file(path: str, content: str) -> str:
    """Write content to a file in the project directory."""
    full = PROJECT_DIR / path
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    return f"Wrote {len(content)} bytes to {path}"


def read_source_file(path: str) -> str:
    """Read a source file from the project directory."""
    full = PROJECT_DIR / path
    if not full.exists():
        return f"File not found: {path}"
    if not full.is_file():
        return f"Not a file: {path}"
    try:
        full.resolve().relative_to(PROJECT_DIR.resolve())
    except ValueError:
        return f"Access denied: {path} is outside the project directory"
    return full.read_text(encoding="utf-8", errors="replace")


def list_project_artifacts() -> str:
    """List all files in the project's .voidrift/ directory."""
    voidrift_dir = PROJECT_DIR / ".voidrift"
    if not voidrift_dir.is_dir():
        return "No .voidrift/ directory found."
    files = sorted(voidrift_dir.rglob("*"))
    result = []
    for f in files:
        if f.is_file():
            rel = f.relative_to(PROJECT_DIR)
            size = f.stat().st_size
            result.append(f"  {rel} ({size} bytes)")
    if not result:
        return ".voidrift/ directory is empty."
    return f"Project artifacts ({len(result)} files):\n" + "\n".join(result)


# Tool definitions in OpenAI format for use with AgentLoop
LOCAL_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": write_file.__doc__,
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                    "content": {"type": "string", "description": "File content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_source_file",
            "description": read_source_file.__doc__,
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_project_artifacts",
            "description": list_project_artifacts.__doc__,
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

LOCAL_HANDLERS = {
    "write_file": write_file,
    "read_source_file": read_source_file,
    "list_project_artifacts": list_project_artifacts,
}
