"""Tool registry: OpenAI-format tool definitions and handler mappings.

ALL tool schemas live here. tool_builder.py imports schemas from this
module — it contains zero inline schema dicts.

Domain tools (10):
  DOMAIN_FILE     — read, write, edit, delete, list
  DOMAIN_HTTP     — get, post, put, delete
  DOMAIN_SHELL    — run shell commands
  DOMAIN_BROWSER  — navigate, screenshot, click, get_text
  DOMAIN_PROCESS  — read_output
  DOMAIN_SKILL    — get, list
  DOMAIN_MEMORY   — read, write, list, delete
  DOMAIN_SESSION  — search
  DOMAIN_ANALYZE  — code, document
  DOMAIN_ASK      — ask operator a question

DOMAIN_TOOLS concatenates every domain schema.
"""

from __future__ import annotations

from .filesystem import WriteContext


# ---------------------------------------------------------------------------
# DOMAIN_TOOLS — consolidated 10-tool schema (TASK-F20)
# ---------------------------------------------------------------------------

DOMAIN_FILE: dict = {
    "type": "function",
    "function": {
        "name": "file",
        "description": "Read, write, edit, delete, or list files in the project.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["read", "write", "edit", "delete", "list"], "description": "Operation to perform"},
                "path": {"type": "string", "description": "File path relative to project root"},
                "content": {"type": "string", "description": "File content (write action)"},
                "old_str": {"type": "string", "description": "Text to find (edit action)"},
                "new_str": {"type": "string", "description": "Replacement text (edit action)"},
                "offset": {"type": "integer", "description": "Line offset for reading (read action)"},
                "limit": {"type": "integer", "description": "Max lines to read (read action)"},
                "force_write": {"type": "boolean", "description": "Overwrite externally modified file (write action)"},
            },
            "required": ["action"],
        },
    },
    "_guidelines": [
        "Read files before writing to understand current state.",
        "Use edit for surgical changes, write for new files or full rewrites.",
    ],
}

DOMAIN_HTTP: dict = {
    "type": "function",
    "function": {
        "name": "http",
        "description": "Make HTTP requests. GET without a session summarizes the response.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["get", "post", "put", "delete"], "description": "HTTP method"},
                "url": {"type": "string", "description": "Request URL"},
                "headers": {"type": "object", "description": "Request headers"},
                "body": {"type": "string", "description": "Request body"},
                "session_id": {"type": "string", "description": "Session ID for cookie/auth persistence"},
            },
            "required": ["action", "url"],
        },
    },
}

DOMAIN_SHELL: dict = {
    "type": "function",
    "function": {
        "name": "shell",
        "description": "Run a shell command.",
        "parameters": {
            "type": "object",
            "properties": {
                "cmd": {"type": "string", "description": "Shell command to run"},
                "cwd": {"type": "string", "description": "Working directory"},
            },
            "required": ["cmd"],
        },
    },
}

DOMAIN_BROWSER: dict = {
    "type": "function",
    "function": {
        "name": "browser",
        "description": "Control a browser for testing.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["navigate", "screenshot", "click", "get_text"], "description": "Browser action"},
                "url": {"type": "string", "description": "URL to navigate to (navigate action)"},
                "selector": {"type": "string", "description": "CSS selector (click, get_text actions)"},
                "session_id": {"type": "string", "description": "Browser session ID"},
            },
            "required": ["action"],
        },
    },
}

DOMAIN_PROCESS: dict = {
    "type": "function",
    "function": {
        "name": "process",
        "description": "Read output from a running process.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["read_output"], "description": "Process action"},
                "handle_id": {"type": "string", "description": "Process handle ID"},
            },
            "required": ["action", "handle_id"],
        },
    },
}

DOMAIN_SKILL: dict = {
    "type": "function",
    "concurrent_safe": True,
    "function": {
        "name": "skill",
        "description": "Load or list available skills.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["get", "list"], "description": "Skill action"},
                "name": {"type": "string", "description": "Skill name (get action)"},
                "topic": {"type": "string", "description": "Section within the skill (get action)"},
            },
            "required": ["action"],
        },
    },
}

DOMAIN_MEMORY: dict = {
    "type": "function",
    "concurrent_safe": True,
    "function": {
        "name": "memory",
        "description": "Persist knowledge across sessions.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["read", "write", "list", "delete"], "description": "Memory action"},
                "name": {"type": "string", "description": "Entry name (read, write, delete actions)"},
                "content": {"type": "string", "description": "Entry content (write action)"},
                "scope": {"type": "string", "enum": ["project", "global"], "description": "Storage scope (write action, default: project)"},
                "description": {"type": "string", "description": "Entry description (write action)"},
            },
            "required": ["action"],
        },
    },
}

DOMAIN_SESSION: dict = {
    "type": "function",
    "concurrent_safe": True,
    "function": {
        "name": "session",
        "description": "Search conversation history.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["search"], "description": "Session action"},
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results (default 5, max 10)"},
            },
            "required": ["action", "query"],
        },
    },
}

DOMAIN_ANALYZE: dict = {
    "type": "function",
    "concurrent_safe": True,
    "function": {
        "name": "analyze",
        "description": "Analyze source files or extract text from documents.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["code", "document"], "description": "Analysis type"},
                "path": {"type": "string", "description": "File path relative to project root"},
            },
            "required": ["action", "path"],
        },
    },
}

DOMAIN_ASK: dict = {
    "type": "function",
    "function": {
        "name": "ask",
        "description": "Ask the operator a question.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Question to ask"},
                "options": {"type": "array", "items": {"type": "string"}, "description": "Optional numbered choices"},
            },
            "required": ["question"],
        },
    },
}

DOMAIN_TOOLS: list[dict] = [
    DOMAIN_FILE, DOMAIN_HTTP, DOMAIN_SHELL, DOMAIN_BROWSER, DOMAIN_PROCESS,
    DOMAIN_SKILL, DOMAIN_MEMORY, DOMAIN_SESSION, DOMAIN_ANALYZE, DOMAIN_ASK,
]


def make_domain_handlers(ctx: "WriteContext", project_dir: str = "") -> dict:
    """Create dispatch handlers for the consolidated domain tools (TASK-F20).

    Each handler routes based on the ``action`` parameter to the existing
    WriteContext methods. The ``file`` handler uses path to determine whether
    the target is in ``.voidrift/`` (framework) or project source.
    """
    _voidrift_prefix = ".voidrift/"

    def _is_framework_path(path: str) -> bool:
        return path.startswith(_voidrift_prefix) or path.startswith(".voidrift\\")

    def _file_handler(action: str, path: str = "", content: str = "",
                      old_str: str = "", new_str: str = "",
                      offset: int = 0, limit: int | None = None,
                      force_write: bool = False) -> str:
        if action == "read":
            if not path:
                return "Error: path is required for read."
            # Auto-detect document formats
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
            if ext in ("pdf", "docx", "xlsx"):
                from .document import read_document
                return read_document(path, project_dir or str(ctx._project_dir))
            if _is_framework_path(path):
                return ctx.read_framework_file(path, offset=offset, limit=limit)
            return ctx.read_source_file(path, offset=offset, limit=limit)
        elif action == "write":
            if not path:
                return "Error: path is required for write."
            if _is_framework_path(path):
                return ctx.write_framework_file(path, content)
            return ctx.write_source_file(path, content, force_write=force_write)
        elif action == "edit":
            if not path:
                return "Error: path is required for edit."
            return ctx.edit_source_file(path, old_str, new_str)
        elif action == "delete":
            if not path:
                return "Error: path is required for delete."
            return ctx.delete_source_file(path)
        elif action == "list":
            return ctx.list_project_artifacts()
        return f"Unknown file action: {action}"

    return {
        "file": _file_handler,
    }
