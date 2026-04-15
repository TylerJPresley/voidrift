"""Chat command: Interactive session with CLI-native tools (REQ-U-1, REQ-U-2)."""

from __future__ import annotations

# Tools available to chat agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "file",
    "http",
    "shell",
    "skill",
    "memory",
    "session",
    "analyze",
    "ask",
})

# Per-command action visibility within each domain tool (REQ-TOOL-8).
AGENT_TOOL_ACTIONS: dict[str, list[str]] = {
    "file": ["read", "write", "edit", "delete", "list"],
    "http": ["get", "post", "put", "delete"],
}

import sys
import time
from pathlib import Path

import click

from .. import ui
from ..models import resolve_model
from ._chat_idea import IdeaSession, _handle_idea_command
from ._chat_display import (
    _query_max_context,
    PermissionGate,
)

from ..models import shell_complete_model as _complete_model

def _inject_session_gap_marker(messages: list[dict], elapsed: str) -> None:
    """Append a session gap marker to reorient the model after a long break (REQ-U-23)."""
    gap_label = elapsed.strip(", last active ")
    messages.append({
        "role": "user",
        "content": f"[Session resumed after {gap_label}. Treat this as a new conversation. Do not continue previous actions — wait for instructions.]",
    })
    messages.append({
        "role": "assistant",
        "content": "Understood — ready for your next request.",
    })


def _tui_loop(agent, mc, log, session=None, style="verbose", fs_ctx=None,
              original_skill=None, web_fetch_kwargs=None,
              permission_gate=None, permission_confirm_holder=None,
              max_ctx=None, idea_session=None, resume_msg=None):
    """Full-screen TUI loop for chat (REQ-UI-1)."""
    import threading
    from ._chat_tui import TUIState, build_tui_app
    from ._chat_compact import ContextCompactor

    _idea_session = idea_session or IdeaSession()

    def _estimate_tokens(messages):
        return sum(len(m.get("content") or "") for m in messages) // 4

    state = TUIState(model_name=f"{mc.alias} ({mc.model_id})", max_ctx=max_ctx)
    state.update_context_pct(_estimate_tokens, agent.messages)

    if resume_msg:
        state.add_system(resume_msg)

    _compactor = ContextCompactor(
        agent=agent, log=log, max_ctx=max_ctx, ui=ui, session=session,
        original_skill=original_skill or "", fs_ctx=fs_ctx,
        estimate_tokens=_estimate_tokens,
        setup_terminal=lambda fd: (None, None),
        restore_terminal=lambda fd, tm, saved: None,
    )

    # Abort flag for Escape cancellation
    _abort = [False]
    _msg_snapshot = [len(agent.messages)]

    # Wire agent callbacks to update TUI state
    _stream_buf: list[str] = []
    _tool_calls_this_turn: list[str] = []
    _stats_parts: list[str] = []
    _turn_start: list[float] = [0.0]
    _model_msg_idx: list[int] = [-1]  # index of the current turn's model message

    def _on_token(token: str):
        if _abort[0]:
            return
        state.thinking = False
        _stream_buf.append(token)
        text = "".join(_stream_buf)
        # Update the single model message for this turn
        idx = _model_msg_idx[0]
        if idx >= 0 and idx < len(state.messages):
            m = state.messages[idx]
            m.text = text
            m.streaming = True
            m._rendered_cache = None  # force re-render
            m._rendered_len = 0
            state._refresh()
        else:
            _model_msg_idx[0] = len(state.messages)
            state.add_model(text, streaming=True)

    def _on_tool_call(name: str, args: str = ""):
        if _abort[0]:
            return
        _tool_calls_this_turn.append(name)
        state.thinking = True
        # Finalize streaming text on the model message (hide cursor)
        idx = _model_msg_idx[0]
        if idx >= 0 and idx < len(state.messages):
            state.messages[idx].streaming = False
            state._refresh()
        if style == "verbose":
            # Extract key detail from args JSON
            detail = ""
            try:
                import json
                a = json.loads(args) if args else {}
                detail = a.get("path", "") or a.get("url", "") or a.get("cmd", "") or a.get("name", "")
            except Exception:
                pass
            state.add_tool(name, detail)

    def _on_tool_result(name: str, result: str):
        if _abort[0]:
            return
        state.thinking = True
        state.thinking_label = ui.random_label()

    def _on_complete(stats: dict):
        _stats_parts.clear()
        ct = stats.get("completion_tokens", 0)
        pt = stats.get("prompt_tokens", 0)
        tps = stats.get("tokens_per_sec")
        elapsed = stats.get("elapsed", 0)
        ctx_pct = stats.get("ctx_pct")
        parts = []
        if pt:
            parts.append(f"↑ {pt} tokens")
        if ct:
            parts.append(f"↓ {ct} tokens")
        if tps:
            parts.append(f"{tps} tok/s")
        if elapsed:
            parts.append(f"{elapsed}s")
        if ctx_pct is not None:
            parts.append(f"ctx {ctx_pct}%")
            state.context_pct = ctx_pct
        _stats_parts.extend(parts)

    agent.on_token = _on_token
    agent.on_complete = _on_complete
    agent.on_tool_call = _on_tool_call
    agent.on_tool_result = _on_tool_result

    # Wire permission gate — prompts render as system messages in TUI
    if permission_gate is not None and permission_confirm_holder is not None:
        # For now, auto-allow in TUI (permission prompts need async input handling)
        # TODO: implement TUI-native permission prompts
        permission_confirm_holder[0] = lambda cat, desc: True

    # Wire web_fetch confirm
    if web_fetch_kwargs:
        _wf = agent.tool_handlers.get("http")
        if _wf and hasattr(_wf, "set_confirm"):
            _wf.set_confirm(lambda url: True)  # TODO: TUI-native confirm

    # Single pending message — replaces queue (only one staged at a time)

    def _dispatch_turn(text: str, app):
        """Send a message to the agent in a background thread."""
        state.add_operator(text)
        with open(log, "a") as f:
            f.write(f"\n> {text}\n")

        # Reset per-turn state
        _stream_buf.clear()
        _tool_calls_this_turn.clear()
        _model_msg_idx[0] = -1
        agent.active_skill_allowed_tools = None
        agent.active_skill_name = ""
        _abort[0] = False
        _msg_snapshot[0] = len(agent.messages)

        # Auto-compact check
        if max_ctx:
            pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
            if _compactor.should_auto_compact(pct):
                state.add_system("Context at 80% — auto-compacting...")
                _compactor.compact()
            elif _compactor.should_nudge(pct):
                state.add_system("Context over 70%. Consider /compact.")

        def _bg():
            state.thinking = True
            state.thinking_label = ui.random_label()
            state.busy = True
            app.invalidate()
            try:
                response = agent.send(text)
                # Clear thinking immediately — before processing the response so the
                # spinner never renders alongside the final message.
                state.thinking = False
                app.invalidate()
                if _abort[0]:
                    return
                final_text = response or ""
                stats_str = " · ".join(_stats_parts) if _stats_parts else ""

                # Update the model message for this turn with final text
                idx = _model_msg_idx[0]
                if final_text.strip():
                    if idx >= 0 and idx < len(state.messages):
                        m = state.messages[idx]
                        m.text = final_text
                        m.stats = stats_str
                        m.streaming = False
                        m._rendered_cache = None
                        m._rendered_len = 0
                        state._refresh()
                    else:
                        state.add_model(final_text, stats=stats_str)
                elif _tool_calls_this_turn:
                    # Tool-only turn — no text response. Don't add a synthetic message;
                    # the tool dots already represent the work done.
                    if idx >= 0 and idx < len(state.messages):
                        m = state.messages[idx]
                        m.stats = stats_str
                        m.streaming = False
                        state._refresh()
                # else: truly empty — nothing to show

                if style == "terse" and _tool_calls_this_turn:
                    from collections import Counter
                    counts = Counter(_tool_calls_this_turn)
                    s = ", ".join(f"{n}× {t}" for t, n in counts.most_common())
                    state.add_system(f"[{len(_tool_calls_this_turn)} tool calls: {s}]")

                state.update_context_pct(_estimate_tokens, agent.messages)
                if session:
                    session.append_message("user", text)
                    session.append_message("assistant", response)
                with open(log, "a") as f:
                    f.write(f"\n{response}\n")
            except Exception as e:
                state.thinking = False
                if _abort[0]:
                    return
                state.update_last_model(f"Error: {e}", streaming=False)
            finally:
                state.thinking = False
                state.busy = False
                if _abort[0]:
                    # Roll back agent messages to pre-send state
                    agent.messages = agent.messages[:_msg_snapshot[0]]
                    state.add_system("Interrupted.")
                app.invalidate()
                # Pending message dispatch handled by _check_pending in tick thread

        threading.Thread(target=_bg, daemon=True).start()

    def _on_submit(text: str, app):
        """Handle operator input — slash commands or agent send."""
        if text.lower() in ("quit", "exit", "/quit"):
            app.exit()
            return

        if text.lower().strip() == "/clear":
            # Abort running agent if busy
            if state.busy:
                _abort[0] = True
                try:
                    if hasattr(agent, '_client') and agent._client:
                        agent._client.close()
                except Exception:
                    pass
            if session:
                session.clear()
            agent.messages = [agent.messages[0]]
            state.pending_message = None
            state.clear_messages()
            state.add_system("Session cleared.")
            return

        if text.lower().strip() == "/help":
            state.add_system(
                "Commands: /help /clear /quit /compact /quick <q> "
                "/idea /done /gather /plan /develop /verify /deploy /chat"
            )
            return

        if text.lower().strip() == "/compact":
            state.add_system("Compacting...")
            _compactor.compact()
            state.update_context_pct(_estimate_tokens, agent.messages)
            state.add_system(f"Compacted. Context: {state.context_pct}%")
            return

        if text.lower().startswith("/quick"):
            _qt = text[6:].strip()
            if not _qt:
                state.add_system("Usage: /quick <question>")
                return
            try:
                from ..config import get_max_tokens as _gmt
                _qc = agent._get_client()
                _qr = _qc.chat.completions.create(
                    model=agent._model_name(),
                    messages=[{"role": "system", "content": "Answer concisely."},
                              {"role": "user", "content": _qt}],
                    max_tokens=_gmt(mc, "chat.quick"),
                )
                state.add_model(_qr.choices[0].message.content or "")
            except Exception as e:
                state.add_system(f"Quick failed: {e}")
            return

        low = text.lower().strip()
        if low.startswith("/gather"):
            from ._chat_commands import wrap_command, handle_gather
            _gather_args = text[7:].strip()
            # Use a simple skip-all prompt_fn for now — TUI input integration is a follow-up
            wrap_command(handle_gather, _gather_args, mc, state, lambda f, c: "skip", log)
            return
        if low.startswith("/plan"):
            from ._chat_commands import wrap_command, handle_plan
            wrap_command(handle_plan, low[5:].strip(), mc, state, lambda f, c: "update", log)
            return
        if low in ("/develop", "/verify", "/deploy", "/idea", "/chat"):
            state.mode = low
            if low == "/chat":
                state.add_system("Back to chat.")
            else:
                state.add_system(f"Switched to {low} mode.")
            return

        if low == "/idea" or low.startswith("/idea ") or (low == "/done" and _idea_session.is_active()):
            text = _handle_idea_command(text, agent, log, _idea_session)
            if not text:
                return

        # If the agent is busy, stage as pending (replaces any existing pending)
        if state.busy:
            state.pending_message = text
            state._refresh()
            return

        state.input_history.append(text)
        _dispatch_turn(text, app)

    def _on_escape(app):
        """Cancel the active interaction — close HTTP client to unblock agent.send()."""
        _abort[0] = True
        state.pending_message = None
        state.thinking = False
        state.busy = False
        # Close the agent's HTTP client to unblock any pending API call
        try:
            if hasattr(agent, '_client') and agent._client:
                agent._client.close()
        except Exception:
            pass
        app.invalidate()

    def _on_recall_pending():
        """Pull pending message back into input for editing."""
        text = state.pending_message
        state.pending_message = None
        state._refresh()
        return text

    def _on_idle(app):
        app.invalidate()

    app = build_tui_app(state, _on_submit, on_escape=_on_escape,
                         on_recall_pending=_on_recall_pending, on_idle=_on_idle)

    try:
        app.run()
    finally:
        agent.on_token = None
        agent.on_complete = None
        agent.on_tool_call = None
        agent.on_tool_result = None


def _raw_loop(agent, mc, log, session=None):
    """Minimal stdin/stdout loop for --style raw (piping, scripting). No TUI."""
    try:
        while True:
            try:
                text = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not text:
                continue
            if text.lower() in ("quit", "exit", "/quit"):
                break
            if text.lower() == "/clear":
                if session:
                    session.clear()
                agent.messages = [agent.messages[0]]
                print("Session cleared.")
                continue

            with open(log, "a") as f:
                f.write(f"\n> {text}\n")
            try:
                response = agent.send(text)
                print(f"\n{response}\n")
                if session:
                    session.append_message("user", text)
                    session.append_message("assistant", response)
                with open(log, "a") as f:
                    f.write(f"\n{response}\n")
            except Exception as e:
                print(f"Error: {e}")
    except KeyboardInterrupt:
        pass


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
        """Basic stdin ask_fn for non-TUI contexts."""
        print(f"\n▸ Agent question: {question}")
        if options:
            for i, opt in enumerate(options, 1):
                print(f"  {i}. {opt}")
        try:
            return input("  > ")
        except (EOFError, KeyboardInterrupt):
            return "[No response]"

    _perm_gate = PermissionGate()
    _perm_holder: list = [None]  # populated with confirm callback in _tui_loop

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
            ui.warn(f"{doc} not found — starting fresh") if style == "raw" else None
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
        """after_tool_call hook: extract skill metadata from skill(action='get') responses."""
        if name == "skill":
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
    _resume_msg = ""
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
        gap_seconds = 0
        if ts:
            from datetime import datetime, timezone
            try:
                last = datetime.fromisoformat(ts)
                delta = datetime.now(timezone.utc) - last
                gap_seconds = int(delta.total_seconds())
                if delta.days > 0:
                    elapsed = f", last active {delta.days}d ago"
                elif delta.seconds >= 3600:
                    elapsed = f", last active {delta.seconds // 3600}h ago"
                elif delta.seconds >= 60:
                    elapsed = f", last active {delta.seconds // 60}m ago"
            except Exception:
                pass
        _resume_msg = f"Resuming session ({session.message_count()} messages{elapsed})"
        if style == "raw":
            print(f"· {_resume_msg}")

        # Inject session gap marker when resuming after 30+ minutes (REQ-U-23)
        if gap_seconds >= 1800:
            _inject_session_gap_marker(agent.messages, elapsed)

    if style == "raw":
        _raw_loop(agent, mc, log, session=session)
    else:
        max_ctx = _query_max_context(mc)
        _tui_loop(
            agent, mc, log,
            session=session,
            style=style,
            fs_ctx=_fs_ctx,
            original_skill=skill,
            web_fetch_kwargs=_web_fetch_kwargs,
            permission_gate=_perm_gate,
            permission_confirm_holder=_perm_holder,
            max_ctx=max_ctx,
            resume_msg=_resume_msg,
        )
