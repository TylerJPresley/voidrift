"""CLI-native filesystem tools (REQ-MCP-4a).

These run on the workstation — not via MCP — because they need local
filesystem access. Domain-separated by tool name:
  write_source_file / read_source_file  → project source tree
  write_framework_file / read_framework_file → .voidrift/ artifacts
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable


class WriteContext:
    """Per-run state for filesystem write tools (REQ-MCP-11, REQ-D-5, REQ-PS-3).

    Encapsulates mutable write-tracking state so tests can create isolated
    instances without relying on module-level globals.

    Usage:
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/main.py", "...")
    """

    def __init__(self, project_dir: Path | None = None) -> None:
        self._project_dir = (project_dir or Path.cwd()).resolve()
        self._framework_dir = self._project_dir / ".voidrift"
        self._source_write_count: int = 0
        self._written_this_run: set[str] = set()
        self._rewrite_allowed: set[str] = set()
        self._session_files: list[str] = []

    # --- State management ---

    def reset_write_count(self) -> None:
        """Reset per-task write counter and duplicate guard. Call before each task."""
        self._source_write_count = 0
        self._written_this_run = set()
        self._rewrite_allowed = set()

    def reset_session_files(self) -> None:
        """Reset session-level file log. Call at develop session start."""
        self._session_files = []

    def get_session_files(self) -> list[str]:
        """Return all source files written since last reset_session_files()."""
        return list(self._session_files)

    def get_write_count(self) -> int:
        """Return number of write_source_file calls since last reset_write_count()."""
        return self._source_write_count

    def allow_rewrite(self, path: str) -> None:
        """Allow a path to be rewritten (e.g. during iterative synthesis)."""
        self._rewrite_allowed.add(path)
        self._rewrite_allowed.add(f".voidrift/{path}")

    # --- Validation helpers ---

    def _validate_content(self, content: str) -> str | None:
        if not content or content.strip() in ("...", "TODO", "TBD", "placeholder"):
            return f"Error: content is a placeholder ('{content.strip()}'). Write the FULL file content."
        return None

    def _check_duplicate(self, path: str, full: Path, content: str) -> str | None:
        if path in self._written_this_run and full.exists() and path not in self._rewrite_allowed:
            return f"Already written: {path} — file is complete. Proceed to the next step."
        return None

    # --- Tool implementations ---

    def write_source_file(self, path: str, content: str) -> str:
        """Write a source file to the project directory."""
        if err := self._validate_content(content):
            return err
        if path.startswith(".voidrift/") or path.startswith(".voidrift\\"):
            return "Access denied: use write_framework_file for .voidrift/ paths."
        full = self._project_dir / path
        try:
            full.resolve().relative_to(self._project_dir)
        except ValueError:
            return f"Access denied: {path} is outside the project directory"
        if err := self._check_duplicate(path, full, content):
            return err
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._source_write_count += 1
        self._written_this_run.add(path)
        self._session_files.append(path)
        return f"Wrote {len(content)} bytes to {path}"

    def write_framework_file(self, path: str, content: str) -> str:
        """Write a framework artifact to the .voidrift/ directory."""
        if err := self._validate_content(content):
            return err
        if path.startswith(".voidrift/"):
            path = path[len(".voidrift/"):]
        full = self._framework_dir / path
        try:
            full.resolve().relative_to(self._framework_dir.resolve())
        except ValueError:
            return f"Access denied: {path} resolves outside .voidrift/"
        canon = f".voidrift/{path}"
        if err := self._check_duplicate(canon, full, content):
            return err
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._written_this_run.add(canon)
        return f"Wrote {len(content)} bytes to .voidrift/{path}"

    def read_source_file(self, path: str) -> str:
        """Read a source file from the project directory."""
        full = self._project_dir / path
        if not full.exists():
            return f"File not found: {path}"
        if not full.is_file():
            return f"Not a file: {path}"
        try:
            full.resolve().relative_to(self._project_dir)
        except ValueError:
            return f"Access denied: {path} is outside the project directory"
        if ".voidrift/logs" in path or ".voidrift\\logs" in path:
            return "Access denied: log files are not readable by the model. Use 'voidrift log' instead."
        return full.read_text(encoding="utf-8", errors="replace")

    def read_framework_file(self, path: str) -> str:
        """Read a framework artifact from the .voidrift/ directory."""
        if path.startswith(".voidrift/"):
            path = path[len(".voidrift/"):]
        full = self._framework_dir / path
        if not full.exists():
            return f"File not found: .voidrift/{path}"
        if not full.is_file():
            return f"Not a file: .voidrift/{path}"
        try:
            full.resolve().relative_to(self._framework_dir.resolve())
        except ValueError:
            return f"Access denied: {path} resolves outside .voidrift/"
        if path.startswith("logs/") or path.startswith("logs\\"):
            return "Access denied: log files are not readable by the model."
        return full.read_text(encoding="utf-8", errors="replace")

    def list_project_artifacts(self) -> str:
        """List all files in the project's .voidrift/ directory (excludes logs)."""
        if not self._framework_dir.is_dir():
            return "No .voidrift/ directory found."
        files = sorted(self._framework_dir.rglob("*"))
        result = []
        for f in files:
            if f.is_file() and "logs" not in f.relative_to(self._framework_dir).parts:
                rel = f.relative_to(self._project_dir)
                size = f.stat().st_size
                result.append(f"  {rel} ({size} bytes)")
        if not result:
            return ".voidrift/ directory is empty."
        return f"Project artifacts ({len(result)} files):\n" + "\n".join(result)

    def get_handlers(self) -> dict[str, Callable]:
        """Return a handler dict mapping tool names to bound methods."""
        return {
            "write_source_file": self.write_source_file,
            "write_framework_file": self.write_framework_file,
            "read_source_file": self.read_source_file,
            "read_framework_file": self.read_framework_file,
            "list_project_artifacts": self.list_project_artifacts,
        }


# ---------------------------------------------------------------------------
# Module-level singleton — backward-compatible API for existing callers
# ---------------------------------------------------------------------------

_ctx = WriteContext()


def reset_write_count() -> None:
    """Reset per-task write counter and duplicate guard."""
    _ctx.reset_write_count()


def reset_session_files() -> None:
    """Reset session-level file log."""
    _ctx.reset_session_files()


def get_session_files() -> list[str]:
    """Return all source files written since last reset_session_files()."""
    return _ctx.get_session_files()


def get_write_count() -> int:
    """Return write_source_file call count since last reset."""
    return _ctx.get_write_count()


def allow_rewrite(path: str) -> None:
    """Allow a path to be rewritten (e.g. during iterative synthesis)."""
    _ctx.allow_rewrite(path)


def write_source_file(path: str, content: str) -> str:
    """Write a source file to the project directory."""
    return _ctx.write_source_file(path, content)


def write_framework_file(path: str, content: str) -> str:
    """Write a framework artifact to the .voidrift/ directory."""
    return _ctx.write_framework_file(path, content)


def read_source_file(path: str) -> str:
    """Read a source file from the project directory."""
    return _ctx.read_source_file(path)


def read_framework_file(path: str) -> str:
    """Read a framework artifact from the .voidrift/ directory."""
    return _ctx.read_framework_file(path)


def list_project_artifacts() -> str:
    """List all files in the project's .voidrift/ directory (excludes logs)."""
    return _ctx.list_project_artifacts()


# Tool definitions in OpenAI format for use with AgentLoop
LOCAL_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "write_source_file",
            "description": "Write a source file to the project directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root (e.g. src/main.py)"},
                    "content": {"type": "string", "description": "File content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_framework_file",
            "description": "Write a framework artifact to the .voidrift/ directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. TASKS.md, arch/backend.md)"},
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
            "description": "Read a source file from the project directory.",
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
            "name": "read_framework_file",
            "description": "Read a framework artifact from the .voidrift/ directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. arch/backend.md, spec/frontend.md)"},
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
    "write_source_file": write_source_file,
    "write_framework_file": write_framework_file,
    "read_source_file": read_source_file,
    "read_framework_file": read_framework_file,
    "list_project_artifacts": list_project_artifacts,
}
