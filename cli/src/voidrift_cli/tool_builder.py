"""Tool registry — builds (tools, handlers) tuples for each framework command.

Imports tool schemas from tools/registry.py and assembles handler dicts.
This module contains zero inline tool schema dicts — all schemas live in
the registry (REQ-TOOL-3).
"""

from __future__ import annotations

import importlib as _importlib
from pathlib import Path
from typing import Callable


def _make_write_guard(name: str, handler, gate, confirm_holder: list) -> "Callable":
    """Wrap a write handler with the session permission gate (REQ-U-22)."""
    def guarded(*args, **kwargs):
        if gate.writes:
            return handler(*args, **kwargs)
        path = args[0] if args else kwargs.get("path", "?")
        confirm = confirm_holder[0]
        if confirm is None:
            return f"Permission denied: {name} — no operator present (non-interactive session)."
        if not confirm("writes", f"{name}({path!r})"):
            return f"Permission denied: operator declined {name}({path!r})."
        return handler(*args, **kwargs)
    return guarded


def _make_run_guard(handler, gate, confirm_holder: list) -> "Callable":
    """Wrap run_command with the session permission gate (REQ-U-22)."""
    import json as _json

    def guarded(*args, **kwargs):
        if gate.runs:
            return handler(*args, **kwargs)
        cmd = args[0] if args else kwargs.get("cmd", "?")
        confirm = confirm_holder[0]
        if confirm is None:
            return _json.dumps({"error": "Permission denied: run_command — no operator present (non-interactive session).", "exit_code": -1})
        if not confirm("runs", f"run_command({cmd!r})"):
            return _json.dumps({"error": f"Permission denied: operator declined run_command({cmd!r}).", "exit_code": -1})
        return handler(*args, **kwargs)
    return guarded


def _make_read_outside_guard(name: str, handler, project_dir: "Path", gate, confirm_holder: list, ctx) -> "Callable":
    """Wrap a read handler: free inside project dir, gated outside (REQ-U-22)."""
    def guarded(path: str, offset: int = 0, limit=None):
        try:
            full = (project_dir / path).resolve()
            full.relative_to(project_dir.resolve())
            # Inside project — delegate to normal handler (sandbox + pagination apply)
            return handler(path, offset=offset, limit=limit)
        except ValueError:
            pass
        # Outside project dir — gate check
        if not gate.reads_outside:
            confirm = confirm_holder[0]
            if confirm is None:
                return f"Permission denied: {path!r} is outside the project directory — no operator present."
            if not confirm("reads_outside", f"{name}({path!r}) — outside project directory"):
                return f"Permission denied: operator declined reading {path!r} (outside project directory)."
        # Granted — read directly with pagination guard
        full = (project_dir / path) if not Path(path).is_absolute() else Path(path)
        full = full.resolve()
        if not full.exists():
            return f"File not found: {path}"
        if not full.is_file():
            return f"Not a file: {path}"
        return ctx._read_with_guard(full, str(path), offset, limit)
    return guarded


def _resolve_allowed(cmd: str | None) -> set[str] | frozenset[str] | None:
    """Resolve the allowed tool names for a command via dynamic import."""
    if cmd is None:
        return None
    _cmd_base = cmd.split("-")[0]
    try:
        _mod = _importlib.import_module(f".commands.{_cmd_base}", package=__package__)
    except ImportError:
        return None
    if cmd == "verify-execute":
        return getattr(_mod, "AGENT_TOOLS_EXECUTE", None)
    elif cmd == "verify-plan":
        return getattr(_mod, "AGENT_TOOLS_PLAN", None)
    return getattr(_mod, "AGENT_TOOLS", None)


def build_handlers(cmd: str | None, project_dir: Path, ctx=None, web_fetch_kwargs: dict | None = None, ask_fn=None, source_read_ctx=None, permission_gate=None, permission_confirm_holder=None) -> dict[str, Callable]:
    """Build all tool handlers bound to the given project directory.

    Args:
        cmd: Command name (used for bash config). None builds all non-bash handlers.
        project_dir: Project root directory.
        ctx: Optional WriteContext instance. Created if not provided.
        web_fetch_kwargs: Optional kwargs for make_web_fetch_handler (REQ-TOOL-5).
            When provided, the real web_fetch handler is built at build time.
            When None, a fallback handler is registered.
        ask_fn: Optional callback for ask_user_question (REQ-TOOL-5).
            When provided, the handler calls ask_fn for operator interaction.
            When None, the handler uses the non-interactive fallback.
        source_read_ctx: Optional WriteContext rooted at a source directory (REQ-G-18).
            When provided, its read_source_file replaces the default handler,
            giving gather full pagination/guards scoped to the source path.

    Returns:
        Dict mapping tool name to handler callable.
    """
    import json as _json
    import re as _re

    from .tools.filesystem import WriteContext as _WriteContext
    from .tools.registry import make_local_handlers as _make_handlers

    _ctx = ctx if ctx is not None else _WriteContext(project_dir=project_dir)
    handlers: dict[str, Callable] = _make_handlers(_ctx)

    # --- Source read context override (REQ-G-18) ---
    if source_read_ctx is not None:
        handlers["read_source_file"] = source_read_ctx.read_source_file

    # --- Web fetch handler (REQ-TOOL-5) ---
    if web_fetch_kwargs is not None:
        from .tools.web import make_web_fetch_handler as _make_wf
        handlers["web_fetch"] = _make_wf(**web_fetch_kwargs)
    else:
        handlers["web_fetch"] = lambda url: "web_fetch is only available during an active chat session."

    # --- Ask user handler (REQ-TOOL-5) ---
    from .tools.interaction import make_ask_user_handler as _make_auh
    handlers["ask_user_question"] = _make_auh(ask_fn=ask_fn)

    # --- Skill handlers ---
    from .skills import find_skill as _find_skill, list_skills as _list_skills
    from .skills import get_skill_allowed_tools as _get_allowed

    def _get_skill_handler(name: str, topic: str = "") -> str:
        content = _find_skill(name)
        if content is None:
            return f"Skill '{name}' not found."
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

    handlers["get_skill"] = _get_skill_handler
    handlers["list_skills"] = _list_skills

    # --- Memory handlers ---
    from .memory import MemoryManager as _MemMgr

    def _read_memory(name: str) -> str:
        content = _MemMgr(str(project_dir)).read(name)
        return content if content else f"Memory entry '{name}' not found."

    def _write_memory(name: str, content: str, scope: str = "project", description: str = "") -> str:
        _MemMgr(str(project_dir)).write(name, content, scope=scope, description=description)
        return f"Memory entry '{name}' saved ({scope})."

    def _list_memory() -> str:
        entries = _MemMgr(str(project_dir)).list_entries()
        if not entries:
            return "No memory entries."
        return "\n".join(f"- {e.name} ({e.scope}): {e.description}" for e in entries)

    handlers["read_memory"] = _read_memory
    handlers["write_memory"] = _write_memory
    handlers["list_memory"] = _list_memory

    # --- Session handler ---
    from .session import ChatSession as _ChatSes

    def _search_history(query: str, limit: int = 5) -> str:
        _session = _ChatSes.load_or_create(project_dir / ".voidrift")
        if not _session.path.exists():
            return "No session history available."
        results = _session.search_entries(query, limit=limit)
        if not results:
            return f"No matches found for '{query}'."
        lines = [f"Found {len(results)} match(es) for '{query}':"]
        for r in results:
            lines.append(f"\n[{r['timestamp']}] {r['role']}:\n{r['content']}")
        return "\n".join(lines)

    handlers["search_history"] = _search_history

    # --- Document handler ---
    from .tools.document import read_document as _read_doc

    handlers["read_document"] = lambda path: _read_doc(path, str(project_dir))

    # --- Code analysis handler ---
    from .tools.code_analysis import code_analysis as _code_analysis

    handlers["code_analysis"] = lambda path: _code_analysis(path, str(project_dir))

    # --- Verify execution handlers ---
    from .tools import process_manager as _pm, http_client as _http, browser as _browser

    handlers["read_process_output"] = _pm.read_process_output
    handlers["http_request"] = _http.http_request
    handlers["browser_navigate"] = _browser.browser_navigate
    handlers["browser_screenshot"] = _browser.browser_screenshot
    handlers["browser_click"] = _browser.browser_click
    handlers["browser_get_text"] = _browser.browser_get_text

    # --- Bash handler ---
    _bash_cmd = cmd.split("-")[0] if cmd is not None else ""
    if _bash_cmd in ("develop", "chat", "verify"):
        from .config import get_bash_config as _get_bash_cfg, get_allowed_commands as _get_ac
        from .tools.bash import create_run_command as _create_rc

        _bcfg = _get_bash_cfg(_bash_cmd)
        handlers["run_command"] = _create_rc(_bcfg, global_allowed=_get_ac())

    # --- Permission gate (REQ-U-22, chat only) ---
    if permission_gate is not None and permission_confirm_holder is not None:
        for _wname in ("write_source_file", "edit_source_file", "write_framework_file"):
            if _wname in handlers:
                handlers[_wname] = _make_write_guard(_wname, handlers[_wname], permission_gate, permission_confirm_holder)
        if "run_command" in handlers:
            handlers["run_command"] = _make_run_guard(handlers["run_command"], permission_gate, permission_confirm_holder)
        _read_ctx = ctx if ctx is not None else _ctx
        for _rname in ("read_source_file", "read_framework_file"):
            if _rname in handlers:
                handlers[_rname] = _make_read_outside_guard(_rname, handlers[_rname], project_dir, permission_gate, permission_confirm_holder, _read_ctx)

    return handlers


def filter_tools(all_tools: list[dict], allowed_names: set[str] | frozenset[str] | None) -> list[dict]:
    """Filter tool schema list to only those in the allowed set.

    Args:
        all_tools: Full list of tool schema dicts.
        allowed_names: Set of tool names to include. None returns all tools.

    Returns:
        Filtered list of tool schema dicts.
    """
    if allowed_names is None:
        return list(all_tools)
    return [t for t in all_tools if t["function"]["name"] in allowed_names]


def validate_schema_handler_contract(tools: list[dict], handlers: dict[str, Callable]) -> None:
    """Validate that each handler's signature accepts its schema-defined parameters.

    Args:
        tools: Tool schema dicts with ``function.parameters.properties``.
        handlers: Mapping of tool name to handler callable.

    Raises:
        ValueError: If a handler is missing a schema-defined parameter and
            does not accept ``**kwargs``.
    """
    import inspect as _inspect

    for tool in tools:
        name = tool["function"]["name"]
        handler = handlers.get(name)
        if handler is None:
            continue
        sig = _inspect.signature(handler)
        if any(p.kind == _inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            continue
        handler_params = {
            p.name for p in sig.parameters.values()
            if p.name != "self"
        }
        schema_params = set(tool["function"].get("parameters", {}).get("properties", {}).keys())
        missing = schema_params - handler_params
        if missing:
            raise ValueError(
                f"Tool '{name}': handler {handler} missing schema-defined "
                f"parameter(s): {', '.join(sorted(missing))}"
            )


def _build_bash_tool_def(cmd: str | None) -> dict | None:
    """Build the bash tool definition with dynamic description, or None if not applicable."""
    _bash_cmd = cmd.split("-")[0] if cmd is not None else ""
    if _bash_cmd not in ("develop", "chat", "verify"):
        return None

    from .tools.registry import BASH_TOOL

    _bash_mod = None
    try:
        _bash_mod = _importlib.import_module(f".commands.{_bash_cmd}", package=__package__)
    except ImportError:
        pass

    _bash_module_desc = getattr(_bash_mod, "BASH_DESCRIPTION", None)
    _bash_defaults: dict[str, tuple[str, list[str]]] = {
        "verify": ("Run a shell command synchronously and return its stdout, stderr, and exit code.", []),
    }
    if _bash_module_desc is not None:
        _desc, _guidelines = _bash_module_desc
    else:
        _desc, _guidelines = _bash_defaults.get(_bash_cmd, ("Run a shell command.", []))

    _bash_base = BASH_TOOL[0]
    tool_def: dict = {
        "type": "function",
        "function": {**_bash_base["function"], "description": _desc},
    }
    if _guidelines:
        tool_def["_guidelines"] = _guidelines
    return tool_def


def build_local_tools(
    cmd: str | None = None,
    project_dir: Path | None = None,
    ctx=None,
    web_fetch_kwargs: dict | None = None,
    ask_fn=None,
    source_read_ctx=None,
    permission_gate=None,
    permission_confirm_holder=None,
) -> tuple[list[dict], dict[str, Callable]]:
    """Build OpenAI-format agent tool definitions from CLI-native filesystem tools.

    Args:
        cmd: Command name to filter agent tools. None returns all agent tools.
        project_dir: Project root directory. Defaults to Path.cwd().
        ctx: Optional WriteContext instance.
        web_fetch_kwargs: Optional kwargs for make_web_fetch_handler (REQ-TOOL-5).
        ask_fn: Optional callback for ask_user_question (REQ-TOOL-5).
        source_read_ctx: Optional WriteContext for source reads (REQ-G-18).

    Returns:
        Tuple of (agent_tool_definitions, agent_tool_handlers) for use with AgentLoop.
    """
    from .tools.registry import (
        LOCAL_TOOLS, SKILL_TOOLS, MEMORY_TOOLS, SESSION_TOOLS,
        DOCUMENT_TOOLS, CODE_ANALYSIS_TOOLS, VERIFY_TOOLS,
    )

    _project_dir = project_dir or Path.cwd()
    allowed = _resolve_allowed(cmd)
    handlers = build_handlers(cmd, _project_dir, ctx=ctx, web_fetch_kwargs=web_fetch_kwargs, ask_fn=ask_fn, source_read_ctx=source_read_ctx, permission_gate=permission_gate, permission_confirm_holder=permission_confirm_holder)

    # Assemble the full schema list (non-bash tools)
    all_schemas = (
        LOCAL_TOOLS + SKILL_TOOLS + MEMORY_TOOLS + SESSION_TOOLS
        + DOCUMENT_TOOLS + CODE_ANALYSIS_TOOLS + VERIFY_TOOLS
    )
    tools = filter_tools(all_schemas, allowed)

    # Bash tool has dynamic description — handle separately
    bash_def = _build_bash_tool_def(cmd)
    if bash_def is not None and (allowed is None or "run_command" in allowed):
        tools.append(bash_def)

    validate_schema_handler_contract(tools, handlers)

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
