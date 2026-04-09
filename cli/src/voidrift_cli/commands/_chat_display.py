"""Display utilities and callbacks for the interactive chat loop (REQ-U-21).

Extracted from commands/chat.py to enable independent unit testing of:
  - Terminal setup/restore helpers
  - Key binding configuration
  - Web-fetch and ask-user confirm handlers
  - Rich Live display callbacks
  - ChatDisplay lifecycle class
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Permission gate (REQ-U-22)
# ---------------------------------------------------------------------------

@dataclass
class PermissionGate:
    """Session-scoped permission grants for chat write/run/read-outside actions (REQ-U-22).

    Zero I/O — tracks whether the operator has granted always-allow for each
    action category. Independently testable without a running terminal.
    """
    writes: bool = False        # always-allow granted for write tools this session
    runs: bool = False          # always-allow granted for run_command this session
    reads_outside: bool = False # always-allow granted for reads outside project dir


def _handle_permission_prompt(
    category: str,
    description: str,
    gate: "PermissionGate",
    console,
    input_fn,
) -> bool:
    """Display a permission prompt and return True (allow) or False (deny).

    Independently testable: console and input_fn are injected.

    Args:
        category: Gate attribute to set on always-allow ("writes", "runs", "reads_outside").
        description: Human-readable description of the action (tool name + target).
        gate: Session-scoped PermissionGate — updated in place on always-allow.
        console: Rich Console for display.
        input_fn: Callable returning the operator's input string.

    Returns:
        True if the action should proceed, False if denied.
    """
    console.print(f"\n[yellow]▸ Permission required:[/yellow] {description}")
    console.print("  [1] Allow once  [2] Always allow this session  [3] Deny")
    try:
        choice = input_fn().strip()
    except (EOFError, KeyboardInterrupt):
        choice = "3"
    if choice == "1":
        return True
    if choice == "2":
        setattr(gate, category, True)
        return True
    return False


# ---------------------------------------------------------------------------
# Model context query
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Terminal helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Key bindings
# ---------------------------------------------------------------------------

def _build_key_bindings():
    """Return configured KeyBindings for the interactive prompt (REQ-UI-1).

    Registers enter (submit or extend multiline) and Ctrl-J (explicit newline).
    Independently testable: no terminal or agent required.
    """
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

    @kb.add("c-j")
    def _newline(event):
        event.current_buffer.insert_text("\n")

    return kb


# ---------------------------------------------------------------------------
# Confirm / ask handlers (independently testable I/O-free cores)
# ---------------------------------------------------------------------------

def _handle_web_fetch_confirm(url: str, console, confirm_fn) -> bool:
    """Print the URL and delegate confirmation to confirm_fn() → bool (REQ-U-8).

    Independently testable: no terminal, Live, or agent required.
    """
    console.print(f"\n[dim]web_fetch →[/dim] [cyan]{url}[/cyan]")
    return confirm_fn()


def _handle_ask_user(question: str, options: list | None, console, input_fn) -> str:
    """Print the agent question and collect the operator response (REQ-U-3).

    Independently testable: no terminal, Live, or agent required.
    """
    console.print(f"\n[bold yellow]▸ Agent question:[/bold yellow] {question}")
    if options:
        for i, opt in enumerate(options, 1):
            console.print(f"  [cyan]{i}.[/cyan] {opt}")
    return input_fn()


# ---------------------------------------------------------------------------
# Display callbacks
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# ChatDisplay lifecycle class
# ---------------------------------------------------------------------------

class ChatDisplay:
    """Manages the Rich Live display lifecycle for a single agent turn (REQ-U-21).

    Independently testable: console is injected; no live TTY required.
    """

    def __init__(self, console) -> None:
        self._console = console
        self._live = None

    def __enter__(self) -> "ChatDisplay":
        from rich.live import Live
        from rich.spinner import Spinner as _RSpinner
        self._live = Live(
            _RSpinner("dots", text="  …", style="dim"),
            console=self._console,
            refresh_per_second=12,
        )
        self._live.__enter__()
        return self

    def __exit__(self, *args) -> None:
        if self._live is not None:
            self._live.__exit__(*args)
            self._live = None

    def update_spinner(self, renderable) -> None:
        """Update the live display with a new renderable."""
        if self._live is not None:
            self._live.update(renderable)

    def print_assistant(self, text: str) -> None:
        """Print the final assistant response."""
        self._console.print(text)

    def print_tool_call(self, name: str, args: dict) -> None:
        """Print a tool call in dim style."""
        self._console.print(f"[dim]→ {name}({args})[/dim]")
