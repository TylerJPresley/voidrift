"""Tool registry — builds (tools, handlers) tuples for each framework command.

Imports tool implementations and assembles the OpenAI-format tool list and
handler dict passed to AgentLoop. This module is the only place that knows
which tools exist and which commands use them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable


def build_local_tools(cmd: str | None = None, project_dir: Path | None = None, ctx=None) -> tuple[list[dict], dict[str, Callable]]:
    """Build OpenAI-format agent tool definitions from CLI-native filesystem tools.

    Args:
        cmd: Command name to filter agent tools. None returns all agent tools.
        project_dir: Project root directory. Defaults to Path.cwd().

    Returns:
        Tuple of (agent_tool_definitions, agent_tool_handlers) for use with AgentLoop.
    """
    import importlib as _importlib

    allowed: set[str] | frozenset[str] | None = None
    if cmd is not None:
        _cmd_base = cmd.split("-")[0]
        try:
            _mod = _importlib.import_module(f".commands.{_cmd_base}", package=__package__)
        except ImportError:
            _mod = None
        if cmd == "verify-execute":
            allowed = getattr(_mod, "AGENT_TOOLS_EXECUTE", None) if _mod else None
        elif cmd == "verify-plan":
            allowed = getattr(_mod, "AGENT_TOOLS_PLAN", None) if _mod else None
        else:
            allowed = getattr(_mod, "AGENT_TOOLS", None) if _mod else None

    _project_dir = project_dir or Path.cwd()

    from .tools.filesystem import WriteContext as _WriteContext
    from .tools.registry import LOCAL_TOOLS, make_local_handlers as _make_handlers
    _ctx = ctx if ctx is not None else _WriteContext(project_dir=_project_dir)
    from .skills import find_skill as _find_skill, list_skills as _list_skills
    from .skills import get_skill_allowed_tools as _get_allowed
    from .config import _voidrift_home as _vh

    import re as _re
    import json as _json

    def _get_skill_handler(name: str, topic: str = "") -> str:
        content = _find_skill(name)
        if content is None:
            return f"Skill '{name}' not found."
        # Encode skill metadata in the return value so callers can extract it
        # without relying on module-level mutable state (REQ-SKL-9).
        at = _get_allowed(name)
        if topic:
            parts = _re.split(r"^## (.+)$", content, flags=_re.MULTILINE)
            for i in range(1, len(parts), 2):
                if parts[i].strip().lower() == topic.strip().lower():
                    content = parts[i + 1].strip() if i + 1 < len(parts) else ""
                    break
            else:
                return f"Section '{topic}' not found in skill '{name}'."
        if at is not None or name:
            meta = _json.dumps({"_skill_allowed_tools": at, "_skill_name": name})
            prefix = f"<!-- SKILL_META:{meta} -->\n"
            return prefix + content
        return content

    def _list_skills_handler() -> str:
        return _list_skills()

    skill_tools = [
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
    skill_handlers: dict[str, Callable] = {
        "get_skill": _get_skill_handler,
        "list_skills": _list_skills_handler,
    }

    # Verify execution tools (process lifecycle, HTTP, browser)
    from .tools import process_manager as _pm, http_client as _http, browser as _browser

    verify_tools = [
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
    verify_handlers: dict[str, Callable] = {
        "read_process_output": _pm.read_process_output,
        "http_request": _http.http_request,
        "browser_navigate": _browser.browser_navigate,
        "browser_screenshot": _browser.browser_screenshot,
        "browser_click": _browser.browser_click,
        "browser_get_text": _browser.browser_get_text,
    }

    tools: list[dict] = []
    handlers: dict[str, Callable] = {}

    # Include CLI-native filesystem agent tools, filtered by command
    _local_handlers = _make_handlers(_ctx)
    for tool_def in LOCAL_TOOLS:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = _local_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = _local_handlers[name]

    # Include skill agent tools (chat command only)
    for tool_def in skill_tools:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = skill_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = skill_handlers[name]

    # Memory tools — chat only (REQ-MEM-1)
    from .memory import MemoryManager as _MemMgr

    def _read_memory_handler(name: str) -> str:
        content = _MemMgr(str(_project_dir)).read(name)
        return content if content else f"Memory entry '{name}' not found."

    def _write_memory_handler(name: str, content: str, scope: str = "project", description: str = "") -> str:
        _MemMgr(str(_project_dir)).write(name, content, scope=scope, description=description)
        return f"Memory entry '{name}' saved ({scope})."

    def _list_memory_handler() -> str:
        entries = _MemMgr(str(_project_dir)).list_entries()
        if not entries:
            return "No memory entries."
        return "\n".join(f"- {e.name} ({e.scope}): {e.description}" for e in entries)

    memory_tools = [
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
    memory_handlers: dict[str, Callable] = {
        "read_memory": _read_memory_handler,
        "write_memory": _write_memory_handler,
        "list_memory": _list_memory_handler,
    }

    for tool_def in memory_tools:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = memory_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = memory_handlers[name]

    # Search history tool — chat only (REQ-U-18)
    from .session import ChatSession as _ChatSes

    def _search_history_handler(query: str, limit: int = 5) -> str:
        _session = _ChatSes.load_or_create(_project_dir / ".voidrift")
        if not _session.path.exists():
            return "No session history available."
        results = _session.search_entries(query, limit=limit)
        if not results:
            return f"No matches found for '{query}'."
        lines = [f"Found {len(results)} match(es) for '{query}':"]
        for r in results:
            lines.append(f"\n[{r['timestamp']}] {r['role']}:\n{r['content']}")
        return "\n".join(lines)

    _sh_tool = {
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
    }
    if allowed is None or "search_history" in allowed:
        tools.append(_sh_tool)
    handlers["search_history"] = _search_history_handler

    # Document format tool — chat, gather (REQ-U-19)
    from .tools.document import read_document as _read_doc

    def _read_document_handler(path: str) -> str:
        return _read_doc(path, str(_project_dir))

    _doc_tool = {
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
    }
    if allowed is None or "read_document" in allowed:
        tools.append(_doc_tool)
    handlers["read_document"] = _read_document_handler

    # Code analysis tool — chat, gather (REQ-U-20)
    from .tools.code_analysis import code_analysis as _code_analysis

    def _code_analysis_handler(path: str) -> str:
        return _code_analysis(path, str(_project_dir))

    _ca_tool = {
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
    }
    if allowed is None or "code_analysis" in allowed:
        tools.append(_ca_tool)
    handlers["code_analysis"] = _code_analysis_handler

    # Bash tool — develop, chat, verify (REQ-SEC-4, REQ-CFG-9)
    from .config import get_bash_config as _get_bash_cfg, get_allowed_commands as _get_ac
    from .tools.bash import create_run_command as _create_rc

    _bash_cmd = cmd.split("-")[0] if cmd is not None else ""  # "verify-execute" -> "verify"
    if _bash_cmd in ("develop", "chat", "verify"):
        _bcfg = _get_bash_cfg(_bash_cmd)
        _rc_handler = _create_rc(_bcfg, global_allowed=_get_ac())

        # Load bash description from the command module if available, else use defaults.
        _bash_mod = None
        try:
            _bash_mod = _importlib.import_module(f".commands.{_bash_cmd}", package=__package__)
        except ImportError:
            pass
        _bash_module_desc = getattr(_bash_mod, "BASH_DESCRIPTION", None)
        _bash_defaults: dict[str, tuple[str, list[str]]] = {
            "verify": (
                "Run a shell command synchronously and return its stdout, stderr, and exit code.",
                [],
            ),
        }
        if _bash_module_desc is not None:
            _desc, _guidelines = _bash_module_desc
        else:
            _desc, _guidelines = _bash_defaults.get(_bash_cmd, ("Run a shell command.", []))

        _bash_tool_def: dict = {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": _desc,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {"type": "string", "description": "Shell command to run"},
                        "cwd": {"type": "string", "description": "Working directory (default: project root)"},
                    },
                    "required": ["cmd"],
                },
            },
        }
        if _guidelines:
            _bash_tool_def["_guidelines"] = _guidelines

        if allowed is None or "run_command" in allowed:
            tools.append(_bash_tool_def)
        handlers["run_command"] = _rc_handler

    # Include verify execution tools (verify-execute only; never registered for other commands)
    for tool_def in verify_tools:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = verify_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = verify_handlers[name]

    return tools, handlers


def build_tool_guidelines(tools: list[dict]) -> str:
    """Assemble tool usage guidelines from tool definitions (TASK-FW-012).

    Extracts ``_guidelines`` lists from tool defs and formats them as
    bullet points. Returns empty string if no tools have guidelines.
    """
    lines: list[str] = []
    for t in tools:
        guidelines = t.get("_guidelines")
        if guidelines:
            name = t.get("function", {}).get("name", "")
            for g in guidelines:
                lines.append(f"- {name}: {g}")
    if not lines:
        return ""
    return "## Tool Guidelines\n\n" + "\n".join(lines)
