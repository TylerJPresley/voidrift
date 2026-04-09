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
# ALL_TOOLS — every tool schema in the system
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
        "write_framework_file": ctx.write_framework_file,
        "read_source_file": ctx.read_source_file,
        "read_framework_file": ctx.read_framework_file,
        "list_project_artifacts": ctx.list_project_artifacts,
    }
