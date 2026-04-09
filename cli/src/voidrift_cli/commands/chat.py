"""Chat command: Interactive session with CLI-native tools (REQ-U-1, REQ-U-2)."""

from __future__ import annotations

# Tools available to chat agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "read_source_file",
    "write_source_file",
    "edit_source_file",
    "read_framework_file",
    "write_framework_file",
    "list_project_artifacts",
    "web_fetch",
    "ask_user_question",
    "get_skill",
    "list_skills",
    "read_memory",
    "write_memory",
    "list_memory",
    "search_history",
    "read_document",
    "code_analysis",
    "run_command",
})

BASH_DESCRIPTION: tuple[str, list[str]] = (
    "Run shell commands to explore, debug, and validate.",
    [
        "Use for build, test, and lint. Not for git operations or file manipulation.",
        "Check exit_code in the result — non-zero means failure.",
    ],
)

import sys
import time
from pathlib import Path

import click

from .. import ui
from ..models import resolve_model
from ._chat_idea import IdeaSession, _handle_idea_command
from ._chat_display import (
    _setup_terminal,
    _restore_terminal,
    _build_key_bindings,
    _make_display_callbacks,
    _handle_web_fetch_confirm,
    _handle_ask_user,
    _handle_permission_prompt,
    _query_max_context,
    PermissionGate,
)

from ..models import shell_complete_model as _complete_model


def _interactive_loop(agent, mc, log, title, write_tools=None, extra_header=None, web_fetch_kwargs=None, original_skill=None, session=None, style="verbose", fs_ctx=None, permission_gate=None, permission_confirm_holder=None):
    """Shared interactive terminal loop (REQ-UI-1, REQ-UI-2, REQ-UI-4)."""
    from ..agent import AgentLoop
    from ._chat_compact import ContextCompactor

    _original_skill = original_skill or ""

    model_label = f"{mc.alias} ({mc.model_id})"
    ui.header(title)
    if extra_header:
        for line in extra_header:
            ui.detail(line)
    ui.detail(f"Log: {log}")
    ui.detail(f"Model: {model_label}")

    # Query context window size from model API (REQ-UI-6)
    max_ctx = _query_max_context(mc)

    def _estimate_tokens(messages):
        """Rough token estimate: chars / 4."""
        return sum(len(m.get("content") or "") for m in messages) // 4

    def _context_prompt():
        """Build colored context percentage prompt (REQ-UI-6)."""
        from prompt_toolkit import ANSI
        mode = ""
        if _idea_session.is_active():
            idea_id = _idea_session.idea_id
            mode = f" idea:{idea_id}" if idea_id else " idea"
        if not max_ctx:
            if mode:
                return ANSI(f"\n\033[36m[{mode.strip()}]\033[0m > ")
            return ANSI("\n> ")
        pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
        if pct > 80:
            color = "\033[31m"  # red
        elif pct > 60:
            color = "\033[33m"  # yellow
        else:
            color = "\033[37m"  # white
        if mode:
            return ANSI(f"\n{color}[{pct}%\033[36m{mode}{color}]\033[0m > ")
        return ANSI(f"\n{color}[{pct}%]\033[0m > ")

    from rich.live import Live
    from rich.padding import Padding as _RPadding
    from rich.spinner import Spinner as _RSpinner
    from rich.text import Text as _RText

    # Shared state for Live-based streaming display.
    _live_holder: list = [None]
    _live_start: list[float] = [0.0]
    _turn_label: list[str] = [""]
    _got_token: list[bool] = [False]
    _stream_buf: list[str] = []
    _term_holder: list = [None]

    def _thinking_text(elapsed: float = 0.0, tokens_in: int = 0, ctx_pct: int | None = None) -> str:
        """Build thinking spinner text with optional telemetry."""
        parts = [ui.elapsed_str(elapsed)] if elapsed >= 1 else []
        if tokens_in:
            parts.append(f"↓ {ui.token_str(tokens_in)} tokens")
        if ctx_pct is not None:
            parts.append(f"ctx {ctx_pct}%")
        if parts:
            parts.append("thinking")
            return f"  {_turn_label[0]} ({' · '.join(parts)})"
        return f"  {_turn_label[0]}"

    def _thinking() -> _RPadding:
        return _RPadding(_RSpinner("dots", text=_thinking_text(), style="dim"), pad=(1, 0, 0, 0))

    _stats_parts: list[str] = []
    _tool_calls_this_turn: list[str] = []

    _display_cbs = _make_display_callbacks(
        agent=agent,
        style=style,
        live_holder=_live_holder,
        live_start=_live_start,
        turn_label=_turn_label,
        got_token=_got_token,
        stream_buf=_stream_buf,
        stats_parts=_stats_parts,
        tool_calls_this_turn=_tool_calls_this_turn,
        thinking_fn=_thinking,
    )
    on_token = _display_cbs["on_token"]
    on_complete = _display_cbs["on_complete"]
    on_progress = _display_cbs["on_progress"]
    on_tool_call = _display_cbs["on_tool_call"]
    on_tool_result = _display_cbs["on_tool_result"]

    if web_fetch_kwargs:
        import click as _click

        def _live_confirm(url: str) -> bool:
            live = _live_holder[0]
            if live is not None:
                live.transient = True
                live.stop()
                live.transient = False
            _ts = _term_holder[0]
            if _ts is not None:
                _tm, _fd, _saved = _ts
                try:
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _saved)
                except Exception:
                    pass

            def _do_confirm() -> bool:
                try:
                    return _click.confirm("  Allow fetch?", default=False)
                except _click.Abort:
                    return False

            allowed = _handle_web_fetch_confirm(url, ui._con, _do_confirm)

            if _ts is not None:
                try:
                    _raw = _tm.tcgetattr(_fd)
                    _raw[3] &= ~(_tm.ECHO | _tm.ICANON)
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _raw)
                except Exception:
                    pass
            if live is not None:
                live.start()
                live.update(_thinking())
            return allowed

        _wf_handler = agent.tool_handlers.get("web_fetch")
        if _wf_handler is not None and hasattr(_wf_handler, "set_confirm"):
            _wf_handler.set_confirm(_live_confirm)

    _auh_handler = agent.tool_handlers.get("ask_user_question")
    if _auh_handler is not None and hasattr(_auh_handler, "set_ask_fn"):
        def _live_ask(question: str, options: list[str] | None) -> str:
            live = _live_holder[0]
            if live is not None:
                live.transient = True
                live.stop()
                live.transient = False
            _ts = _term_holder[0]
            if _ts is not None:
                _tm, _fd, _saved = _ts
                try:
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _saved)
                except Exception:
                    pass

            def _do_input() -> str:
                try:
                    return input("  > ")
                except (EOFError, KeyboardInterrupt):
                    return "[No response]"

            response = _handle_ask_user(question, options, ui._con, _do_input)

            if _ts is not None:
                try:
                    _raw = _tm.tcgetattr(_fd)
                    _raw[3] &= ~(_tm.ECHO | _tm.ICANON)
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _raw)
                except Exception:
                    pass
            if live is not None:
                live.start()
                live.update(_thinking())
            return response

        _auh_handler.set_ask_fn(_live_ask)

    # --- Permission gate confirm (REQ-U-22) ---
    if permission_gate is not None and permission_confirm_holder is not None:
        def _live_perm_confirm(category: str, description: str) -> bool:
            live = _live_holder[0]
            if live is not None:
                live.transient = True
                live.stop()
                live.transient = False
            _ts = _term_holder[0]
            if _ts is not None:
                _tm, _fd, _saved = _ts
                try:
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _saved)
                except Exception:
                    pass

            def _do_input() -> str:
                try:
                    return input("  > ")
                except (EOFError, KeyboardInterrupt):
                    return "3"

            result = _handle_permission_prompt(category, description, permission_gate, ui._con, _do_input)

            if _ts is not None:
                try:
                    _raw = _tm.tcgetattr(_fd)
                    _raw[3] &= ~(_tm.ECHO | _tm.ICANON)
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _raw)
                except Exception:
                    pass
            if live is not None:
                live.start()
                live.update(_thinking())
            return result

        permission_confirm_holder[0] = _live_perm_confirm

    agent.on_token = on_token
    agent.on_complete = on_complete
    agent.on_tool_call = on_tool_call
    agent.on_tool_result = on_tool_result
    agent.on_progress = on_progress

    from prompt_toolkit import PromptSession

    _prompt_session = PromptSession(key_bindings=_build_key_bindings(), multiline=True)

    _consecutive_interrupt = 0

    _compactor = ContextCompactor(
        agent=agent,
        log=log,
        max_ctx=max_ctx,
        ui=ui,
        session=session,
        original_skill=_original_skill,
        fs_ctx=fs_ctx,
        estimate_tokens=_estimate_tokens,
        setup_terminal=_setup_terminal,
        restore_terminal=_restore_terminal,
    )

    _idea_session = IdeaSession()

    try:
        while True:
            try:
                user_input = _prompt_session.prompt(_context_prompt()).strip()
                _consecutive_interrupt = 0
            except KeyboardInterrupt:
                _consecutive_interrupt += 1
                if _consecutive_interrupt >= 2:
                    raise
                ui.info("Press Ctrl+C again to exit.")
                continue
            except EOFError:
                break
            if user_input.lower() in ("quit", "exit", "/quit"):
                break
            if not user_input:
                continue
            _consecutive_interrupt = 0

            if user_input.lower().strip() == "/compact":
                _compactor.compact()
                continue

            if user_input.lower().strip() == "/clear":
                if session:
                    session.clear()
                agent.messages = [agent.messages[0]]
                ui.info("Session cleared.")
                continue

            if user_input.lower().startswith("/quick"):
                _quick_text = user_input[6:].strip()
                if not _quick_text:
                    ui.info("Usage: /quick <question>")
                    continue
                try:
                    _quick_client = agent._get_client()
                    _quick_resp = _quick_client.chat.completions.create(
                        model=agent._model_name(),
                        messages=[
                            {"role": "system", "content": "Answer concisely."},
                            {"role": "user", "content": _quick_text},
                        ],
                        max_tokens=_get_max_tokens(mc, "chat.quick"),
                    )
                    _quick_answer = _quick_resp.choices[0].message.content or ""
                    ui._con.print()
                    ui._con.print(ui.render_text(_quick_answer) if style != "raw" else f"  {_quick_answer}")
                except Exception as _qe:
                    ui.error(f"Quick answer failed: {_qe}")
                continue

            low = user_input.lower().strip()
            if low == "/idea" or low.startswith("/idea ") or (low == "/done" and _idea_session.is_active()):
                user_input = _handle_idea_command(user_input, agent, log, _idea_session)
                if not user_input:
                    continue

            if write_tools is not None:
                low = user_input.lower().strip()
                is_write = low.startswith("/write") or low in {
                    "write", "write it", "go ahead and write",
                    "please write the file now", "please write the file",
                    "write the file", "write the file now",
                }
                if is_write:
                    agent.tools = write_tools
                    agent.extra_body = None
                    if low.startswith("/write"):
                        user_input = user_input[6:].strip() or "Please write the file now."
                else:
                    agent.tools = []
                    agent.extra_body = {"chat_template_kwargs": {"enable_thinking": False}}

            with open(log, "a") as f:
                f.write(f"\n> {user_input}\n")

            _stream_buf.clear()
            _got_token[0] = False
            _turn_label[0] = ui.random_label()
            _msg_snapshot = len(agent.messages)

            # Reset per-turn skill state on the agent instance (REQ-SKL-9)
            agent.active_skill_allowed_tools = None
            agent.active_skill_name = ""

            if max_ctx:
                pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
                if _compactor.should_auto_compact(pct):
                    ui.info("Context window at 80% — auto-compacting...")
                    _compactor.compact()
                    _compactor.nudged = True
                    _msg_snapshot = len(agent.messages)
                elif _compactor.should_nudge(pct):
                    agent.messages.append({
                        "role": "system",
                        "content": (
                            "Context window is over 70% full. "
                            "Remind the operator to run /compact to free space before continuing."
                        ),
                    })
                    _compactor.nudged = True
                    _msg_snapshot = len(agent.messages)

            try:
                _turn_fd: int | None = sys.stdin.fileno()
            except Exception:
                _turn_fd = None
            _turn_termios, _turn_saved = _setup_terminal(_turn_fd)
            if _turn_fd is not None and _turn_termios is not None:
                _term_holder[0] = (_turn_termios, _turn_fd, _turn_saved)

            _error = None
            _interrupted = False
            _live_start[0] = time.time()
            if style == "raw":
                try:
                    response = agent.send(user_input)
                    print(f"\n  {response}\n")
                except KeyboardInterrupt:
                    _interrupted = True
                except RuntimeError as e:
                    _error = str(e)
                finally:
                    _term_holder[0] = None
                    _restore_terminal(_turn_fd, _turn_termios, _turn_saved)
            else:
              with Live(_thinking(), console=ui._con, refresh_per_second=12) as _live:
                _live_holder[0] = _live
                try:
                    response = agent.send(user_input)
                    _live.update(ui.render_text(response))
                except KeyboardInterrupt:
                    _interrupted = True
                    _live.transient = True
                except RuntimeError as e:
                    _error = str(e)
                finally:
                    _live_holder[0] = None
                    _term_holder[0] = None
                    _restore_terminal(_turn_fd, _turn_termios, _turn_saved)

            if _interrupted:
                agent.messages = agent.messages[:_msg_snapshot]
                ui._con.print()
                ui.info("Interrupted.")
                ui._con.print()
                ui.operator_rule()
                continue

            if _error:
                ui.error(_error)
                continue

            if _stats_parts:
                ui.stats(_stats_parts)

            if style == "terse" and _tool_calls_this_turn:
                from collections import Counter
                counts = Counter(_tool_calls_this_turn)
                summary = ", ".join(f"{n}× {t}" for t, n in counts.most_common())
                ui._con.print(f"  [dim][{len(_tool_calls_this_turn)} tool calls: {summary}][/dim]")
            _tool_calls_this_turn.clear()

            if session:
                session.append_message("user", user_input)
                session.append_message("assistant", response)

            with open(log, "a") as f:
                f.write(f"\n{response}\n")
            ui._con.print()
            ui.operator_rule()
    except KeyboardInterrupt:
        ui.info("Session ended.")
    finally:
        agent.on_token = None
        agent.on_complete = None
        agent.on_tool_call = None
        agent.on_tool_result = None


@click.command()
@click.argument("model", shell_complete=_complete_model)
@click.option("--doc", help="Scope conversation to a specific .voidrift/ artifact")
@click.option("--style", type=click.Choice(["verbose", "terse", "raw"]), default="verbose", help="Output style")
@click.option("--bare", is_flag=True, default=False, help="Minimal context — no skills, git, or project state injection")
@click.option("--system-prompt", "system_prompt_path", type=click.Path(exists=True), help="Custom system prompt file (requires --bare)")
def chat(model, doc, style, bare, system_prompt_path) -> None:
    """Interactive session with CLI-native tools for requirements, planning, and refinement."""
    if system_prompt_path and not bare:
        click.echo("Error: --system-prompt requires --bare", err=True)
        sys.exit(1)
    from ..main import _check_setup
    _check_setup()
    mc = resolve_model(model)
    from ..agent import AgentLoop, build_local_tools
    from ..utils import boot_run
    from .. import prompts as _prompts
    from ..skills import find_skill

    log, run_id = boot_run("chat")

    from ..tools.filesystem import WriteContext as _WriteContext
    from ..utils import voidrift_dir as _vd
    _fs_ctx = _WriteContext(project_dir=_vd().parent, max_read_lines=mc.max_read_lines)
    _web_cache: dict = {}
    _web_fetch_kwargs = dict(
        mc=mc,
        log=log,
        web_cache=_web_cache,
    )

    def _basic_ask_fn(question: str, options: list[str] | None) -> str:
        """Basic stdin ask_fn — replaced by Live-aware version in _interactive_loop."""
        print(f"\n▸ Agent question: {question}")
        if options:
            for i, opt in enumerate(options, 1):
                print(f"  {i}. {opt}")
        try:
            return input("  > ")
        except (EOFError, KeyboardInterrupt):
            return "[No response]"

    _perm_gate = PermissionGate()
    _perm_holder: list = [None]  # populated with live-aware confirm in _interactive_loop

    tools, handlers = build_local_tools(
        cmd="chat",
        project_dir=_vd().parent,
        ctx=_fs_ctx,
        web_fetch_kwargs=_web_fetch_kwargs,
        ask_fn=_basic_ask_fn,
        permission_gate=_perm_gate,
        permission_confirm_holder=_perm_holder,
    )

    from ..utils import voidrift_dir
    if system_prompt_path:
        system = Path(system_prompt_path).read_text()
        skill = ""
    elif bare:
        system = _prompts.load_prompt("system", "CONTEXT")
        skill = ""
    else:
        skill = find_skill("ANALYSIS-REQS") or ""
        system_context = _prompts.load_prompt("system", "CONTEXT")
        system_prompt = _prompts.load_prompt("chat", "SYSTEM")

        state_file = voidrift_dir() / "STATE.md"
        project_state = ""
        if state_file.exists():
            project_state = f"**Project state:**\n\n{state_file.read_text()}"

        from ..git_context import capture_git_snapshot
        _snap = capture_git_snapshot(str(Path.cwd()))
        _git_block = _snap.to_prompt_block() if _snap else ""

        from ..memory import MemoryManager
        _mem_block = MemoryManager(str(Path.cwd())).index_prompt_block()

        system = "\n\n".join(p for p in [system_context, skill, system_prompt, project_state, _git_block, _mem_block] if p)

    if doc:
        doc_path = voidrift_dir() / doc
        if doc_path.exists():
            doc_section = _prompts.load_prompt("chat", "DOC").format(
                doc_name=doc, doc_content=doc_path.read_text()
            )
            system += f"\n\n{doc_section}"
        else:
            ui.warn(f"{doc} not found — starting fresh")
            system += f"\n\n{_prompts.load_prompt('chat', 'DOC-NEW').format(doc_name=doc)}"

    from ..config import get_max_tokens as _get_max_tokens

    agent = AgentLoop(
        model=mc,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=True,
        tool_choice="auto",
        max_tokens=_get_max_tokens(mc, "chat.session"),
        log_path=log,
    )

    import json as _json
    import re as _re
    from ..skills import make_skill_tool_guard

    _SKILL_META_RE = _re.compile(r"^<!-- SKILL_META:(.+?) -->\n", _re.MULTILINE)

    def _extract_skill_meta(result: str) -> str:
        """Extract SKILL_META from get_skill result, update agent state, return clean content."""
        m = _SKILL_META_RE.match(result)
        if m:
            try:
                meta = _json.loads(m.group(1))
                agent.active_skill_allowed_tools = meta.get("_skill_allowed_tools")
                agent.active_skill_name = meta.get("_skill_name", "")
            except (ValueError, KeyError):
                pass
            return result[m.end():]
        return result

    def _skill_after_tool_call(name: str, result: str) -> str:
        """after_tool_call hook: extract skill metadata from get_skill responses."""
        if name == "get_skill":
            return _extract_skill_meta(result)
        return result

    def _skill_guard(name: str, args: str) -> str | None:
        at = agent.active_skill_allowed_tools
        if at is None:
            return None
        guard = make_skill_tool_guard(at, agent.active_skill_name)
        return guard(name, args) if guard else None

    agent.before_tool_call = _skill_guard
    agent.after_tool_call = _skill_after_tool_call

    from ..session import ChatSession
    session = ChatSession.load_or_create(voidrift_dir())
    if session.has_messages:
        restored = session.reconstruct_messages()
        if restored:
            for m in restored:
                if m["role"] == "system":
                    agent.messages[0]["content"] += f"\n\n[Prior session context]\n{m['content']}"
                else:
                    agent.messages.append(m)
        ts = session.last_timestamp() or ""
        elapsed = ""
        if ts:
            from datetime import datetime, timezone
            try:
                last = datetime.fromisoformat(ts)
                delta = datetime.now(timezone.utc) - last
                if delta.days > 0:
                    elapsed = f", last active {delta.days}d ago"
                elif delta.seconds >= 3600:
                    elapsed = f", last active {delta.seconds // 3600}h ago"
                elif delta.seconds >= 60:
                    elapsed = f", last active {delta.seconds // 60}m ago"
            except Exception:
                pass
        ui.info(f"Resuming session ({session.message_count()} messages{elapsed})")

    title = f"VoidRift Chat — {doc}" if doc else "VoidRift Chat"
    _interactive_loop(
        agent, mc, log, title,
        web_fetch_kwargs=_web_fetch_kwargs,
        original_skill=skill,
        session=session,
        style=style,
        fs_ctx=_fs_ctx,
        permission_gate=_perm_gate,
        permission_confirm_holder=_perm_holder,
    )
