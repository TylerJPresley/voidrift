"""Tool registry: OpenAI-format tool definitions and handler mappings.

Defines LOCAL_TOOLS (list of tool schemas) and make_local_handlers (factory
that creates a name → callable dict bound to a WriteContext instance) used by
tool_builder.build_local_tools to assemble agent tool sets.

Moved here from filesystem.py so that WriteContext can live in isolation and
the registry is the single place that assembles tool schemas from all sub-modules.
"""

from __future__ import annotations

from .filesystem import WriteContext
from .interaction import web_fetch, ask_user_question

# Tool definitions in OpenAI format for use with AgentLoop
LOCAL_TOOLS: list[dict] = [
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


def make_local_handlers(ctx: "WriteContext") -> dict:
    """Create handler dict bound to the given WriteContext instance."""
    return {
        "write_source_file": ctx.write_source_file,
        "edit_source_file": ctx.edit_source_file,
        "write_framework_file": ctx.write_framework_file,
        "read_source_file": ctx.read_source_file,
        "read_framework_file": ctx.read_framework_file,
        "list_project_artifacts": ctx.list_project_artifacts,
        "web_fetch": web_fetch,
        "ask_user_question": ask_user_question,
    }
