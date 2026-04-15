"""Tool registry: OpenAI-format tool definitions and handler mappings.

ALL tool schemas live here, organized as named group lists. tool_builder.py
imports schemas from this module — it contains zero inline schema dicts.

Groups:
  FILESYSTEM_TOOLS  — file read/write/edit/list + ask_user_question
  SKILL_TOOLS       — get_skill, list_skills
  MEMORY_TOOLS      — read_memory, write_memory, list_memory
  SESSION_TOOLS     — search_history
  DOCUMENT_TOOLS    — read_document
  CODE_ANALYSIS_TOOLS — code_analysis
  BASH_TOOL         — run_command (base schema; description set at build time)
  VERIFY_TOOLS      — read_process_output, http_request, browser_*

ALL_TOOLS concatenates every group.
"""

from __future__ import annotations

from .filesystem import WriteContext

# ---------------------------------------------------------------------------
# Filesystem + interaction tools (formerly LOCAL_TOOLS)
# ---------------------------------------------------------------------------
FILESYSTEM_TOOLS: list[dict] = [
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
                    "force_write": {"type": "boolean", "description": "Overwrite even if the file was modified externally. Default: false."},
                },
                "required": ["path", "content"],
            },
        },
        "_guidelines": [
            "Write complete file content — never write placeholder stubs or TODOs.",
            "For existing files, read first to understand the current state.",
        ],
    },
    {
        "type": "function",
        "function": {
            "name": "edit_source_file",
            "description": (
                "Surgical edit: replace a specific section of an existing source file. "
                "old_str must match exactly one location — if it appears more than once, the edit is rejected. "
                "Use for modifications to existing files. Use write_source_file for new files or full rewrites."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                    "old_str": {"type": "string", "description": "Exact text to find and replace (must appear exactly once)"},
                    "new_str": {"type": "string", "description": "Replacement text"},
                    "force_write": {"type": "boolean", "description": "Overwrite even if the file was modified externally. Default: false."},
                },
                "required": ["path", "old_str", "new_str"],
            },
        },
        "_guidelines": [
            "Always call read_source_file before edit_source_file to confirm the exact string. Never guess at old_str content.",
            "Prefer edit_source_file over write_source_file for modifications to existing files.",
        ],
    },
    {
        "type": "function",
        "function": {
            "name": "delete_source_file",
            "description": "Delete a source file from the project directory. The file must exist. Directories cannot be deleted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root (e.g. src/old_module.py)"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_framework_file",
            "description": "Write a framework artifact to the .voidrift/ directory. Use append=true to add content to an existing file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. TASKS.md, arch/backend.md)"},
                    "content": {"type": "string", "description": "File content to write"},
                    "append": {"type": "boolean", "description": "Append to existing file instead of overwriting. Default: false."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_source_file",
            "description": (
                "Read a source file from the project directory. "
                "If the file exceeds the line limit, a warning header is returned with pagination instructions. "
                "Use offset and limit to read large files in chunks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                    "offset": {"type": "integer", "description": "Line offset to start reading from (0-based, default 0)"},
                    "limit": {"type": "integer", "description": "Maximum number of lines to return. Omit to use the model's configured max_read_lines."},
                },
                "required": ["path"],
            },
        },
        "_guidelines": [
            "When a pagination warning is returned, use offset to read remaining content before drawing conclusions.",
        ],
        "concurrent_safe": True,
    },
    {
        "type": "function",
        "function": {
            "name": "read_framework_file",
            "description": (
                "Read a framework artifact from the .voidrift/ directory. "
                "If the file exceeds the line limit, a warning header is returned with pagination instructions. "
                "Use offset and limit to read large files in chunks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. arch/backend.md, analysis/src/main.py.md)"},
                    "offset": {"type": "integer", "description": "Line offset to start reading from (0-based, default 0)"},
                    "limit": {"type": "integer", "description": "Maximum number of lines to return. Omit to use the model's configured max_read_lines."},
                },
                "required": ["path"],
            },
        },
        "concurrent_safe": True,
    },
    {
        "type": "function",
        "function": {
            "name": "list_project_artifacts",
            "description": "List all files in the project's .voidrift/ directory (excludes logs).",
            "parameters": {"type": "object", "properties": {}},
        },
        "concurrent_safe": True,
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch a URL and return a concise summary of its content. Results are cached for the session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch (https://)"},
                },
                "required": ["url"],
            },
        },
        "concurrent_safe": True,
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user_question",
            "description": "Ask the operator a clarifying question. Use only for genuine ambiguity that cannot be resolved from available context — not for rhetorical questions or confirmations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The specific question for the operator."},
                    "options": {"type": "string", "description": "Optional: JSON array of choices to present, e.g. '[\"option A\", \"option B\"]'"},
                },
                "required": ["question"],
            },
        },
    },
]

# Backward compat alias — existing code imports LOCAL_TOOLS
LOCAL_TOOLS = FILESYSTEM_TOOLS

# ---------------------------------------------------------------------------
# Skill tools (chat only)
# ---------------------------------------------------------------------------
SKILL_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_skill",
            "description": "Retrieve a skill document by name, optionally scoped to an H2 section.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name as returned by list_skills()"},
                    "topic": {"type": "string", "description": "Optional H2 heading within the skill to retrieve a specific section"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_skills",
            "description": "List all available skill documents grouped by layer (project, domain, north star).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# ---------------------------------------------------------------------------
# Memory tools (chat only)
# ---------------------------------------------------------------------------
MEMORY_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "read_memory",
            "description": "Read a memory entry by name. Searches project memory first, then global.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Memory entry name"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_memory",
            "description": "Write or update a memory entry. Use to persist project facts, conventions, and decisions across sessions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Entry name (lowercase, hyphens)"},
                    "content": {"type": "string", "description": "Entry content (markdown)"},
                    "scope": {"type": "string", "description": "project (default) or global", "enum": ["project", "global"]},
                    "description": {"type": "string", "description": "Short description for the memory index"},
                },
                "required": ["name", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_memory",
            "description": "List all memory entries across project and global layers.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# ---------------------------------------------------------------------------
# Session tools (chat only)
# ---------------------------------------------------------------------------
SESSION_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_history",
            "description": (
                "Search conversation history by keyword. Searches all session "
                "entries including those before compaction. Returns matching "
                "entries with timestamps and roles."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search term (case-insensitive substring match)"},
                    "limit": {"type": "integer", "description": "Max results to return (default 5, max 10)"},
                },
                "required": ["query"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Document tools (chat, gather)
# ---------------------------------------------------------------------------
DOCUMENT_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "read_document",
            "description": (
                "Extract text from a binary document file (PDF, DOCX, XLSX). "
                "Returns plaintext or markdown. Requires pymupdf, python-docx, "
                "or openpyxl depending on format."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                },
                "required": ["path"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Code analysis tools (chat, gather)
# ---------------------------------------------------------------------------
CODE_ANALYSIS_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "code_analysis",
            "description": (
                "Analyze a source file and return structured JSON with language, "
                "line count, imports, exported symbols, and complexity estimate. "
                "Requires tree-sitter."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path relative to project root"},
                },
                "required": ["path"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Bash tool (develop, chat, verify) — base schema; description set at build time
# ---------------------------------------------------------------------------
BASH_TOOL: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Shell command to run"},
                    "cwd": {"type": "string", "description": "Working directory (default: project root)"},
                },
                "required": ["cmd"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Verify execution tools (verify-execute only)
# ---------------------------------------------------------------------------
VERIFY_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "read_process_output",
            "description": "Read buffered stdout/stderr from a running process (up to 500 lines).",
            "parameters": {
                "type": "object",
                "properties": {
                    "handle_id": {"type": "string", "description": "Handle ID returned by start_process"},
                },
                "required": ["handle_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "http_request",
            "description": (
                "Make an HTTP request with session-scoped cookie and auth header persistence. "
                "Cookies and Authorization headers are preserved across calls in the same session."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "method": {"type": "string", "description": "HTTP method (GET, POST, PUT, PATCH, DELETE)"},
                    "url": {"type": "string", "description": "Full URL including scheme"},
                    "headers": {"type": "string", "description": "JSON object of request headers (default {})"},
                    "body": {"type": "string", "description": "Request body (default empty)"},
                    "session_id": {"type": "string", "description": "Named session for persistence (default 'default')"},
                },
                "required": ["method", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Navigate the browser to a URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL to navigate to"},
                    "session_id": {"type": "string", "description": "Browser session ID (default 'default')"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": "Take a full-page screenshot. Returns base64 PNG or saves to .voidrift/ path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Browser session ID"},
                    "save_path": {"type": "string", "description": "Optional path relative to .voidrift/ to save PNG"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click an element on the current page using a CSS or text selector.",
            "parameters": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS or text selector (e.g. 'button.submit' or 'text=Login')"},
                    "session_id": {"type": "string", "description": "Browser session ID"},
                },
                "required": ["selector"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_get_text",
            "description": "Get visible text content of an element (default: full page body).",
            "parameters": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector (default 'body')"},
                    "session_id": {"type": "string", "description": "Browser session ID"},
                },
                "required": [],
            },
        },
    },
]

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

# ---------------------------------------------------------------------------
# ALL_TOOLS — every tool schema in the system (legacy)
# ---------------------------------------------------------------------------
ALL_TOOLS: list[dict] = (
    FILESYSTEM_TOOLS
    + SKILL_TOOLS
    + MEMORY_TOOLS
    + SESSION_TOOLS
    + DOCUMENT_TOOLS
    + CODE_ANALYSIS_TOOLS
    + BASH_TOOL
    + VERIFY_TOOLS
)


def make_local_handlers(ctx: "WriteContext") -> dict:
    """Create handler dict bound to the given WriteContext instance."""
    return {
        "write_source_file": ctx.write_source_file,
        "edit_source_file": ctx.edit_source_file,
        "delete_source_file": ctx.delete_source_file,
        "write_framework_file": ctx.write_framework_file,
        "read_source_file": ctx.read_source_file,
        "read_framework_file": ctx.read_framework_file,
        "list_project_artifacts": ctx.list_project_artifacts,
    }


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
