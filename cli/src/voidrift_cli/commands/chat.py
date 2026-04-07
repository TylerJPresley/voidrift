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


from ..models import shell_complete_model as _complete_model


def _query_max_context(mc) -> int | None:
    """Query max_model_len from the model's /v1/models endpoint (REQ-MC-3).

    Falls back to mc.max_context (from models.yml) for models that don't
    expose max_model_len on their endpoint.
    """
    try:
        from openai import OpenAI
        kwargs: dict = {"timeout": 5}
        if mc.api_base:
            kwargs["base_url"] = mc.api_base
        if mc.api_key:
            kwargs["api_key"] = mc.api_key
        else:
            kwargs["api_key"] = "no-key"
        client = OpenAI(**kwargs)
        models = client.models.list()
        for m in models.data:
            if hasattr(m, "max_model_len"):
                return m.max_model_len
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).debug(
            "max_context query failed for %s: %s", mc.alias, exc
        )
    return mc.max_context


def _setup_terminal(fd: int | None) -> tuple[object | None, object | None]:
    """Save current terminal settings and switch to raw mode.

    Args:
        fd: File descriptor for stdin, or None for non-TTY environments.

    Returns:
        Tuple of (termios_module, saved_attr). Both are None when the terminal
        is unavailable (e.g. non-TTY, Windows).
    """
    if fd is None:
        return None, None
    try:
        import termios as _termios
        saved = _termios.tcgetattr(fd)
        raw = _termios.tcgetattr(fd)
        raw[3] &= ~(_termios.ECHO | _termios.ICANON)
        _termios.tcsetattr(fd, _termios.TCSANOW, raw)
        return _termios, saved
    except Exception:
        return None, None


def _restore_terminal(fd: int | None, termios_mod: object | None, saved_attr: object | None) -> None:
    """Restore previously saved terminal settings.

    Args:
        fd: File descriptor used in _setup_terminal.
        termios_mod: The termios module returned by _setup_terminal.
        saved_attr: The saved terminal attributes returned by _setup_terminal.
    """
    if fd is None or termios_mod is None or saved_attr is None:
        return
    try:
        termios_mod.tcsetattr(fd, termios_mod.TCSANOW, saved_attr)
        termios_mod.tcflush(fd, termios_mod.TCIFLUSH)
    except Exception:
        pass


def _make_display_callbacks(
    agent: object,
    style: str,
    live_holder: list,
    live_start: list,
    turn_label: list,
    got_token: list,
    stream_buf: list,
    stats_parts: list,
    tool_calls_this_turn: list,
    thinking_fn: "object | None" = None,
) -> dict:
    """Build before_tool_call and display event callbacks for the interactive loop.

    Args:
        agent: AgentLoop instance.
        style: Output style ("verbose", "terse", or "raw").
        live_holder: Single-element list holding the current Rich Live instance.
        live_start: Single-element list holding the loop start time.
        turn_label: Single-element list holding the current turn label.
        got_token: Single-element list flag for whether a token has been received.
        stream_buf: Accumulation buffer for streamed tokens.
        stats_parts: Mutable list written by on_complete.
        tool_calls_this_turn: Mutable list of tool names called this turn.
        thinking_fn: Callable that returns a Rich renderable for the thinking state.

    Returns:
        Dict with keys "on_token", "on_complete", "on_progress",
        "on_tool_call", "on_tool_result".
    """
    import time as _time

    from rich.padding import Padding as _RPadding
    from rich.spinner import Spinner as _RSpinner
    from rich.text import Text as _RText
    from .. import ui as _ui

    def on_token(token: str) -> None:
        got_token[0] = True
        stream_buf.append(token)
        live = live_holder[0]
        if live is not None:
            text = "".join(stream_buf)
            lines = text.splitlines()
            tail = "\n".join(lines[-5:]) if len(lines) > 5 else text
            live.update(_RPadding(_RText("  " + tail, style="dim"), pad=(1, 0, 0, 0)))

    def on_complete(stats: dict) -> None:
        stats_parts.clear()
        elapsed = stats.get("elapsed", 0)
        completion_tokens = stats.get("completion_tokens", 0)
        prompt_tokens = stats.get("prompt_tokens", 0)
        ctx_pct = stats.get("ctx_pct")
        if completion_tokens:
            stats_parts.append(f"↑ {_ui.token_str(completion_tokens)} tokens")
        if prompt_tokens:
            stats_parts.append(f"↓ {_ui.token_str(prompt_tokens)} tokens")
        if stats.get("tokens_per_sec"):
            stats_parts.append(f"{stats['tokens_per_sec']} tok/s")
        if elapsed:
            stats_parts.append(f"{elapsed}s")
        if ctx_pct is not None:
            stats_parts.append(f"ctx {ctx_pct}%")

    def _thinking_widget():
        if thinking_fn is not None:
            return thinking_fn()
        return _RPadding(_RSpinner("dots", text=f"  {turn_label[0]}", style="dim"), pad=(1, 0, 0, 0))

    def on_progress(data: dict) -> None:
        if got_token[0]:
            return
        live = live_holder[0]
        if live is not None and data.get("state") == "thinking":
            elapsed = _time.time() - live_start[0]
            tokens_in = data.get("prompt_tokens", 0)
            ctx_pct = data.get("ctx_pct")
            parts = [_ui.elapsed_str(elapsed)] if elapsed >= 1 else []
            if tokens_in:
                parts.append(f"↓ {_ui.token_str(tokens_in)} tokens")
            if ctx_pct is not None:
                parts.append(f"ctx {ctx_pct}%")
            if parts:
                parts.append("thinking")
                text = f"  {turn_label[0]} ({' · '.join(parts)})"
            else:
                text = f"  {turn_label[0]}"
            live.update(_RPadding(
                _RSpinner("dots", text=text, style="dim"),
                pad=(1, 0, 0, 0),
            ))

    def on_tool_call(name: str) -> None:
        got_token[0] = False
        tool_calls_this_turn.append(name)
        if style == "verbose":
            live = live_holder[0]
            if live is not None:
                live.update(_RPadding(
                    _RText(f"  → {name}", style="dim"), pad=(1, 0, 0, 0),
                ))
                return
        live = live_holder[0]
        if live is not None:
            live.update(_thinking_widget())

    def on_tool_result(name: str, result: str) -> None:
        got_token[0] = False
        live = live_holder[0]
        if live is not None:
            live.update(_thinking_widget())

    return {
        "on_token": on_token,
        "on_complete": on_complete,
        "on_progress": on_progress,
        "on_tool_call": on_tool_call,
        "on_tool_result": on_tool_result,
    }


def _handle_idea_command(
    line: str,
    agent: object,
    log: "Path",
    idea_state: dict,
) -> str:
    """Handle /idea and /done slash commands in the chat loop.

    Args:
        line: Raw user input line.
        agent: AgentLoop instance for message injection.
        log: Path to the session log file.
        idea_state: Mutable dict tracking active idea refinement state.

    Returns:
        Replacement user message to send to the agent, or "" to skip the turn.
    """
    from ..manifest import ManifestManager
    from .. import prompts as _prompts

    low = line.lower().strip()

    if low == "/done" and idea_state.get("active"):
        # Finish the idea flow
        mm = ManifestManager()
        if mm.exists():
            mm.load()
        mm.ensure_dirs()

        idea_id = idea_state.get("id")
        is_new = idea_id is None
        if is_new:
            idea_id = mm.next_idea_id

        from .. import ui as _ui
        _ui.info("Categorize this idea:")
        _ui._con.print("  [bold]now[/bold] — high priority, work on it soon")
        _ui._con.print("  [bold]next[/bold] — upcoming, after current work")
        _ui._con.print("  [bold]later[/bold] — parked for future consideration")

        from prompt_toolkit import prompt as _pt_prompt
        while True:
            cat = _pt_prompt("\nCategory (now/next/later): ").strip().lower()
            if cat in ("now", "next", "later"):
                break
            _ui.warn("Choose: now, next, or later")

        if is_new:
            mm.add_idea(idea_id, status=cat)
        else:
            mm.set_idea_status(idea_id, cat)

        _ui.info(f"IDEA-{idea_id} saved as {cat}.")
        with open(log, "a") as f:
            f.write(f"\n[IDEA] IDEA-{idea_id} saved as {cat}\n")

        msg = (
            f"Write the final structured idea to "
            f"ideas/IDEA-{idea_id}.md using write_framework_file. "
            f"Include: title, user story, context, acceptance criteria, "
            f"affected modules, and affected files (if modifying existing behavior)."
        )
        idea_state.clear()
        return msg

    if low == "/idea" or low.startswith("/idea "):
        arg = line.strip()[5:].strip()
        if arg:
            try:
                idea_id = int(arg)
            except ValueError:
                from .. import ui as _ui
                _ui.error(f"Invalid idea ID: {arg}")
                return ""
            mm = ManifestManager()
            if mm.exists():
                mm.load()
            content = mm.read_idea(idea_id)
            if not content:
                from .. import ui as _ui
                _ui.error(f"IDEA-{idea_id} not found.")
                return ""
            idea_context = f"Existing idea:\n\n{content}"
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            idea_state.update(active=True, id=idea_id, mm=mm)
            from .. import ui as _ui
            _ui.info(f"Loaded IDEA-{idea_id}. Type /done when finished.")
            return f"I've loaded IDEA-{idea_id}. Summarize where we left off and ask what I'd like to refine."
        else:
            idea_context = "This is a new idea. Start with Stage 1 — Intake."
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            idea_state.update(active=True, id=None)
            from .. import ui as _ui
            _ui.info("Starting idea refinement. Type /done when finished.")
            return "I want to develop a new idea."

    return line  # not an idea command — return unmodified


def _interactive_loop(agent, mc, log, title, write_tools=None, extra_header=None, web_fetch_kwargs=None, original_skill=None, session=None, style="verbose"):
    """Shared interactive terminal loop (REQ-UI-1, REQ-UI-2, REQ-UI-4)."""
    from ..agent import AgentLoop

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
        if _idea_state.get("active"):
            idea_id = _idea_state.get("id")
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
        from ..tools import make_web_fetch_handler as _make_wf

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
            ui._con.print(f"\n[dim]web_fetch →[/dim] [cyan]{url}[/cyan]")
            try:
                allowed = _click.confirm("  Allow fetch?", default=False)
            except _click.Abort:
                allowed = False
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

        agent.tool_handlers["web_fetch"] = _make_wf(
            **web_fetch_kwargs, confirm_fn=_live_confirm
        )

    from ..tools import make_ask_user_handler as _make_auh

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
        ui._con.print(f"\n[bold yellow]▸ Agent question:[/bold yellow] {question}")
        if options:
            for i, opt in enumerate(options, 1):
                ui._con.print(f"  [cyan]{i}.[/cyan] {opt}")
        try:
            response = input("  > ")
        except (EOFError, KeyboardInterrupt):
            response = "[No response]"
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

    agent.tool_handlers["ask_user_question"] = _make_auh(ask_fn=_live_ask)

    agent.on_token = on_token
    agent.on_complete = on_complete
    agent.on_tool_call = on_tool_call
    agent.on_tool_result = on_tool_result
    agent.on_progress = on_progress

    from prompt_toolkit import PromptSession
    from prompt_toolkit.key_binding import KeyBindings

    kb = KeyBindings()

    @kb.add("enter")
    def _submit(event):
        buf = event.current_buffer
        if buf.document.current_line.endswith("\\"):
            buf.delete_before_cursor()
            buf.insert_text("\n")
        else:
            buf.validate_and_handle()

    _prompt_session = PromptSession(key_bindings=kb, multiline=True)

    _consecutive_interrupt = 0
    _compact_nudged = False
    _compact_failures = 0
    _auto_compact_disabled = False

    def _do_compact() -> bool:
        """Summarize history to free context (REQ-U-7, REQ-U-10, REQ-U-11)."""
        nonlocal _compact_nudged, _compact_failures, _auto_compact_disabled
        ui._con.print()
        if len(agent.messages) <= 1:
            ui.info("Nothing to compact.")
            return True

        target = max_ctx // 10 if max_ctx else 8000
        from .. import prompts as _prompts
        compact_prompt = _prompts.load_prompt("chat", "COMPACT").format(
            target_tokens=target,
        )

        original_system = agent.messages[0]["content"]

        try:
            _compact_fd: int | None = sys.stdin.fileno()
        except Exception:
            _compact_fd = None
        _compact_termios, _compact_saved = _setup_terminal(_compact_fd)

        summary = ""
        try:
            _compact_spinner = _RSpinner("dots", text=f"  {ui.random_label()}", style="dim")
            with Live(_compact_spinner, console=ui._con, refresh_per_second=12, transient=True):
                client = agent._get_client()
                resp = client.chat.completions.create(
                    model=agent._model_name(),
                    messages=agent.messages + [{"role": "user", "content": compact_prompt}],
                    max_tokens=target,
                )
                summary = resp.choices[0].message.content or ""
        except Exception as e:
            ui.error(f"Compact failed: {e}")
            _compact_failures += 1
            if _compact_failures >= 3:
                _auto_compact_disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            return False
        finally:
            _restore_terminal(_compact_fd, _compact_termios, _compact_saved)

        sys_content = original_system + f"\n\n[Conversation summary]\n{summary}"
        agent.messages = [{"role": "system", "content": sys_content}]

        result_tokens = _estimate_tokens(agent.messages)
        if max_ctx and result_tokens > max_ctx // 10:
            _compact_failures += 1
            if _compact_failures >= 3:
                _auto_compact_disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            ui.warn(f"Compact result still {result_tokens * 100 // max_ctx}% of context.")
            return False

        _compact_failures = 0

        restore_parts: list[str] = []
        restore_budget = max_ctx // 5 if max_ctx else 50000
        restore_used = 0

        recent = _fs_ctx.get_read_files()
        seen: set[str] = set()
        newest_3: list[str] = []
        for p in reversed(recent):
            if p not in seen:
                seen.add(p)
                newest_3.append(p)
                if len(newest_3) == 3:
                    break

        for fpath in newest_3:
            try:
                from pathlib import Path as _Path
                if fpath.startswith(".voidrift/"):
                    full = _Path.cwd() / fpath
                else:
                    full = _Path.cwd() / fpath
                if not full.exists():
                    continue
                content = full.read_text(encoding="utf-8", errors="replace")
                cost = len(content) // 4
                if restore_used + cost > restore_budget:
                    break
                restore_parts.append(f"[File: {fpath}]\n{content}")
                restore_used += cost
            except Exception:
                continue

        if _original_skill and restore_used + len(_original_skill) // 4 <= restore_budget:
            restore_parts.append(f"[Skills]\n{_original_skill}")

        if restore_parts:
            agent.messages.append({
                "role": "system",
                "content": "[Restored context]\n\n" + "\n\n".join(restore_parts),
            })

        pct = _estimate_tokens(agent.messages) * 100 // max_ctx if max_ctx else 0
        ui.info(f"Compacted to {pct}% of context window.")
        ui._con.print(ui.render_text(summary), style="dim")
        with open(log, "a") as f:
            f.write(f"\n[COMPACT] {summary}\n")
        if session:
            session.append_compaction(summary)
        _compact_nudged = False
        return True

    _idea_state: dict = {}

    def _handle_idea(agent, log, user_input: str) -> str:
        """Start or resume an idea refinement flow."""
        from ..manifest import ManifestManager
        from .. import prompts as _prompts

        arg = user_input.strip()[5:].strip()

        if arg:
            try:
                idea_id = int(arg)
            except ValueError:
                ui.error(f"Invalid idea ID: {arg}")
                return ""
            mm = ManifestManager()
            if mm.exists():
                mm.load()
            content = mm.read_idea(idea_id)
            if not content:
                ui.error(f"IDEA-{idea_id} not found.")
                return ""
            idea_context = f"Existing idea:\n\n{content}"
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            _idea_state.update(active=True, id=idea_id, mm=mm)
            ui.info(f"Loaded IDEA-{idea_id}. Type /done when finished.")
            return f"I've loaded IDEA-{idea_id}. Summarize where we left off and ask what I'd like to refine."
        else:
            idea_context = "This is a new idea. Start with Stage 1 — Intake."
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            _idea_state.update(active=True, id=None)
            ui.info("Starting idea refinement. Type /done when finished.")
            return "I want to develop a new idea."

    def _finish_idea(agent, log) -> str:
        """Save the idea and return to normal chat."""
        from ..manifest import ManifestManager

        mm = ManifestManager()
        if mm.exists():
            mm.load()
        mm.ensure_dirs()

        idea_id = _idea_state.get("id")
        is_new = idea_id is None
        if is_new:
            idea_id = mm.next_idea_id

        ui.info("Categorize this idea:")
        ui._con.print("  [bold]now[/bold] — high priority, work on it soon")
        ui._con.print("  [bold]next[/bold] — upcoming, after current work")
        ui._con.print("  [bold]later[/bold] — parked for future consideration")

        from prompt_toolkit import prompt as _pt_prompt
        while True:
            cat = _pt_prompt("\nCategory (now/next/later): ").strip().lower()
            if cat in ("now", "next", "later"):
                break
            ui.warn("Choose: now, next, or later")

        if is_new:
            mm.add_idea(idea_id, status=cat)
        else:
            mm.set_idea_status(idea_id, cat)

        ui.info(f"IDEA-{idea_id} saved as {cat}.")
        with open(log, "a") as f:
            f.write(f"\n[IDEA] IDEA-{idea_id} saved as {cat}\n")

        msg = (
            f"Write the final structured idea to "
            f"ideas/IDEA-{idea_id}.md using write_framework_file. "
            f"Include: title, user story, context, acceptance criteria, "
            f"affected modules, and affected files (if modifying existing behavior)."
        )
        _idea_state.clear()
        return msg

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
                _do_compact()
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
                        max_tokens=2048,
                    )
                    _quick_answer = _quick_resp.choices[0].message.content or ""
                    ui._con.print()
                    ui._con.print(ui.render_text(_quick_answer) if style != "raw" else f"  {_quick_answer}")
                except Exception as _qe:
                    ui.error(f"Quick answer failed: {_qe}")
                continue

            low = user_input.lower().strip()
            if low == "/idea" or low.startswith("/idea ") or (low == "/done" and _idea_state.get("active")):
                user_input = _handle_idea_command(user_input, agent, log, _idea_state)
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
                if pct >= 80 and not _auto_compact_disabled:
                    ui.info("Context window at 80% — auto-compacting...")
                    _do_compact()
                    _compact_nudged = True
                    _msg_snapshot = len(agent.messages)
                elif pct >= 70 and not _compact_nudged:
                    agent.messages.append({
                        "role": "system",
                        "content": (
                            "Context window is over 70% full. "
                            "Remind the operator to run /compact to free space before continuing."
                        ),
                    })
                    _compact_nudged = True
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
    tools, handlers = build_local_tools(cmd="chat", project_dir=_vd().parent, ctx=_fs_ctx)

    from ..tools import make_web_fetch_handler
    _web_cache: dict = {}
    _web_fetch_kwargs = dict(
        mc=mc,
        log=log,
        web_cache=_web_cache,
    )
    handlers["web_fetch"] = make_web_fetch_handler(**_web_fetch_kwargs)

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

    agent = AgentLoop(
        model=mc,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=True,
        tool_choice="auto",
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
    _interactive_loop(agent, mc, log, title, web_fetch_kwargs=_web_fetch_kwargs, original_skill=skill, session=session, style=style)
