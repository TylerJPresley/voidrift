"""Full-screen TUI for the chat command (REQ-UI-1).

Replaces the Rich Live + PromptSession display layer with a prompt_toolkit
Application(full_screen=True) providing: scrollable conversation with colored
left-margin bars, persistent footer, inline placeholder input, progressive
streaming markdown rendering, and a thinking spinner.

Keeps: agent loop interaction, slash command handling, session persistence,
permission gate logic, skill guard — all driven by chat.py.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from io import StringIO
from pathlib import Path
from prompt_toolkit import Application
from prompt_toolkit.cursor_shapes import CursorShape
from prompt_toolkit.formatted_text import ANSI, FormattedText, to_formatted_text
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import (
    Dimension,
    FormattedTextControl,
    HSplit,
    Layout,
    Window,
)
from prompt_toolkit.mouse_events import MouseEvent, MouseEventType
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import TextArea
from rich.console import Console
from rich.markdown import Markdown

# ── Scrollable control — intercepts mouse wheel before Window handles it ──

class _ScrollableControl(FormattedTextControl):
    """FormattedTextControl that intercepts SCROLL_UP/DOWN mouse events.

    Returning None (handled) instead of NotImplemented prevents the parent
    Window from calling its own _mouse_handler, which would modify
    Window.vertical_scroll and conflict with manual line-slicing scroll.
    """

    def __init__(self, *args, on_scroll_up=None, on_scroll_down=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._on_scroll_up = on_scroll_up
        self._on_scroll_down = on_scroll_down

    def mouse_handler(self, mouse_event: MouseEvent):
        if mouse_event.event_type == MouseEventType.SCROLL_UP:
            if self._on_scroll_up:
                self._on_scroll_up()
            return None
        if mouse_event.event_type == MouseEventType.SCROLL_DOWN:
            if self._on_scroll_down:
                self._on_scroll_down()
            return None
        return super().mouse_handler(mouse_event)


# ── Rich → prompt_toolkit ANSI bridge ────────────────────────────────

def _rich_render(text: str, width: int = 100) -> ANSI:
    buf = StringIO()
    c = Console(file=buf, force_terminal=True, color_system="truecolor",
                width=width, highlight=False)
    c.print(Markdown(text), soft_wrap=False)
    return ANSI(buf.getvalue().rstrip("\n"))


def _has_markdown(text: str) -> bool:
    markers = ("```", "**", "## ", "# ", "| ", "- ", "* ", "1. ", "> ", "[")
    return any(m in text for m in markers)


# ── Git helper ───────────────────────────────────────────────────────

def _git_branch() -> str:
    try:
        r = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True, text=True, timeout=3,
        )
        return r.stdout.strip() or ""
    except Exception:
        return ""


def _short_cwd() -> str:
    home = Path.home()
    cwd = Path.cwd()
    try:
        return "~/" + str(cwd.relative_to(home))
    except ValueError:
        return str(cwd)


# ── Conversation model ───────────────────────────────────────────────

class Message:
    __slots__ = ("role", "text", "tool_name", "stats", "streaming",
                 "_rendered_cache", "_rendered_len")

    def __init__(self, role: str, text: str, tool_name: str = "",
                 stats: str = "", streaming: bool = False):
        self.role = role
        self.text = text
        self.tool_name = tool_name
        self.stats = stats
        self.streaming = streaming
        self._rendered_cache: list[tuple[str, str]] | None = None
        self._rendered_len = 0


class TUIState:
    """Observable state for the TUI. All mutations trigger a redraw."""

    def __init__(self, model_name: str = "auto", max_ctx: int | None = None):
        self.messages: list[Message] = []
        self.model_name = model_name
        self.context_pct = 0
        self.max_ctx = max_ctx
        self.mode = "/chat"
        self.cwd = _short_cwd()
        self.branch = _git_branch()
        self.thinking = False
        self.thinking_label = "thinking..."
        self.busy = False
        self.pending_message: str | None = None  # staged message waiting to send
        self.input_history: list[str] = []
        self._history_idx: int = -1  # -1 = not browsing history
        self._saved_input: str = ""  # saved current input when entering history
        self._invalidate = None
        self._scroll_to_end = None

    def add_operator(self, text: str):
        self.messages.append(Message("operator", text))
        self._refresh()

    def add_model(self, text: str, stats: str = "", streaming: bool = False):
        self.messages.append(Message("model", text, stats=stats, streaming=streaming))
        self._refresh()

    def add_tool(self, tool_name: str, detail: str = ""):
        self.messages.append(Message("tool", detail, tool_name=tool_name))
        self._refresh()

    def add_system(self, text: str):
        self.messages.append(Message("system", text))
        self._refresh()

    def update_last_model(self, text: str, stats: str = "", streaming: bool = True):
        if self.messages and self.messages[-1].role == "model":
            m = self.messages[-1]
            m.text = text
            m.stats = stats
            m.streaming = streaming
            if not streaming:
                m._rendered_cache = None
                m._rendered_len = 0
            self._refresh()

    def clear_messages(self):
        self.messages.clear()
        self.context_pct = 0
        self._refresh()

    def update_context_pct(self, estimate_tokens, agent_messages):
        if self.max_ctx:
            toks = estimate_tokens(agent_messages)
            self.context_pct = min(100, toks * 100 // self.max_ctx)

    def _refresh(self):
        if self._invalidate:
            self._invalidate()
        if self._scroll_to_end:
            self._scroll_to_end()


# ── Spinner ──────────────────────────────────────────────────────────

SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
_spinner_idx = 0


# ── Header ───────────────────────────────────────────────────────────

HEADER_TEXT = (
    "  ██╗   ██╗ ██████╗ ██╗██████╗ ██████╗ ██╗███████╗████████╗\n"
    "  ██║   ██║██╔═══██╗██║██╔══██╗██╔══██╗██║██╔════╝╚══██╔══╝\n"
    "  ██║   ██║██║   ██║██║██║  ██║██████╔╝██║█████╗     ██║   \n"
    "  ╚██╗ ██╔╝██║   ██║██║██║  ██║██╔══██╗██║██╔══╝     ██║   \n"
    "   ╚████╔╝ ╚██████╔╝██║██████╔╝██║  ██║██║██║        ██║   \n"
    "    ╚═══╝   ╚═════╝ ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   \n"
)


def _render_to_lines(state: TUIState, width: int) -> list[list[tuple[str, str]]]:
    """Render conversation as a list of styled lines for fragment-slicing scroll."""
    global _spinner_idx
    lines: list[list[tuple[str, str]]] = []
    usable = max(width - 4, 40)

    # Header
    lines.append([("", "")])
    for l in HEADER_TEXT.splitlines():
        lines.append([("class:header-art", l)])
    lines.append([("class:header-tagline", "  Agentic Software Engineering Framework")])
    lines.append([("", "")])

    # Welcome callout — always shown; full when fresh, compact when history exists
    box_w = min(66, usable - 2)
    inner_w = box_w - 4  # 2 border chars + 1 space each side
    indent = "  "

    def _bline(frags=None):
        frags = frags or []
        used = sum(len(t) for _, t in frags)
        pad = " " * max(0, inner_w - used)
        row = [("class:callout-border", indent + "│ ")]
        row.extend(frags)
        row.append(("class:callout-bg", pad))
        row.append(("class:callout-border", " │"))
        return row

    top = indent + "╭" + "─" * (box_w - 2) + "╮"
    bot = indent + "╰" + "─" * (box_w - 2) + "╯"

    lines.append([("class:callout-border", top)])
    lines.append(_bline())
    lines.append(_bline([("class:callout-label", "  Model  "), ("class:callout-model", state.model_name)]))
    lines.append(_bline())
    lines.append(_bline([("class:callout-text", "  I can help you with requirements, planning,")]))
    lines.append(_bline([("class:callout-text", "  implementation, and verification.")]))
    lines.append(_bline([("class:callout-text", "  I have access to your project files, shell, web, and memory.")]))
    lines.append(_bline())
    lines.append(_bline([("class:callout-cmd", "  /help"), ("class:callout-hint", "     list commands")]))
    lines.append(_bline([("class:callout-cmd", "  /clear"), ("class:callout-hint", "    reset conversation")]))
    lines.append(_bline([("class:callout-cmd", "  /compact"), ("class:callout-hint", "  compress context")]))
    lines.append(_bline([("class:callout-cmd", "  /quick"), ("class:callout-hint", "   <question>  fast one-shot answer")]))
    lines.append(_bline([("class:callout-cmd", "  /plan · /develop · /verify"), ("class:callout-hint", "  workflow modes")]))
    if state.messages:
        lines.append(_bline())
        lines.append(_bline([("class:callout-hint", "  Resuming previous conversation. /clear to start fresh.")]))
    lines.append(_bline())
    lines.append([("class:callout-border", bot)])
    lines.append([("", "")])
    if not state.messages:
        lines.append([("class:header-tagline", "  PgUp/PgDn or scroll to navigate  ·  Ctrl+C to cancel  ·  /quit to exit")])
        lines.append([("", "")])

    for msg in state.messages:
        if msg.role == "operator":
            lines.append([("", "")])
            lines.append([("class:rule", "─" * usable)])
            for l in msg.text.splitlines():
                lines.append([("class:operator-bar", "┃ "), ("class:operator", l)])
            lines.append([("", "")])
        elif msg.role == "tool":
            d = f"  {msg.text}" if msg.text else ""
            lines.append([("class:tool-dot", "● "), ("class:tool-name", msg.tool_name), ("class:tool-detail", d)])
        elif msg.role == "system":
            lines.append([("class:system-msg", f"  {msg.text}")])
        elif msg.role == "model":
            text = msg.text
            if text.strip() and _has_markdown(text):
                # Use cached render when text hasn't grown since last render
                if msg._rendered_cache is not None and msg._rendered_len == len(text):
                    rendered_lines = msg._rendered_cache
                else:
                    ansi = _rich_render(text, width=usable - 2)
                    rendered = to_formatted_text(ansi)
                    rendered_lines = []
                    cur = []
                    for st, chunk in rendered:
                        parts = chunk.split("\n")
                        for i, part in enumerate(parts):
                            if i > 0:
                                rendered_lines.append([("class:model-bar", "┃ ")] + cur)
                                cur = []
                            if part:
                                cur.append((st, part))
                    if cur:
                        rendered_lines.append([("class:model-bar", "┃ ")] + cur)
                    msg._rendered_cache = rendered_lines
                    msg._rendered_len = len(text)
                lines.extend(rendered_lines)
                if msg.streaming:
                    lines.append([("class:model-bar", "┃ "), ("class:streaming-cursor", "█")])
            else:
                for l in text.splitlines():
                    lines.append([("class:model-bar", "┃ "), ("class:model-text", l)])
                if msg.streaming:
                    lines.append([("class:model-bar", "┃ "), ("class:streaming-cursor", "█")])
            if msg.stats:
                lines.append([("", "")])
                lines.append([("class:stats", f"  · {msg.stats}")])
            lines.append([("", "")])

    if state.thinking:
        _spinner_idx = (_spinner_idx + 1) % len(SPINNER)
        lines.append([("class:thinking", f"  {SPINNER[_spinner_idx]} {state.thinking_label}")])

    if state.pending_message:
        lines.append([("", "")])
        lines.append([("class:pending-rule", "┄" * usable)])
        for l in state.pending_message.splitlines():
            lines.append([("class:pending-bar", "┃ "), ("class:pending-text", l)])
        lines.append([("class:pending-hint", "  ↑ to edit · esc to cancel")])

    return lines


def _render_footer(state: TUIState, width: int) -> FormattedText:
    pct = state.context_pct
    ctx_cls = (
        "class:ctx-ok" if pct <= 60
        else "class:ctx-warn" if pct <= 80
        else "class:ctx-crit"
    )
    left: list[tuple[str, str]] = [
        ("class:ft-name", "voidrift"),
        ("class:ft-dim", " · "),
        ("class:ft-name", state.model_name),
        ("class:ft-dim", " · "),
        (ctx_cls, f"◎ {pct}%"),
        ("class:ft-dim", " · "),
        ("class:ft-mode", state.mode),
    ]
    right: list[tuple[str, str]] = [("class:ft-path", state.cwd)]
    if state.branch:
        right.append(("class:ft-dim", " · "))
        right.append(("class:ft-branch", f"({state.branch})"))
    right.append(("", " "))

    left_len = sum(len(t) for _, t in left)
    right_len = sum(len(t) for _, t in right)
    pad = max(1, width - left_len - right_len)
    return FormattedText(left + [("", " " * pad)] + right)


# ── Style ────────────────────────────────────────────────────────────

TUI_STYLE = Style.from_dict({
    "header-art": "#5c8cc8",
    "header-tagline": "#888888 italic",
    "callout-border": "#5a6aa8",
    "callout-bg": "bg:#13132a",
    "callout-label": "bg:#13132a #666666",
    "callout-model": "bg:#13132a #4ec9b0 bold",
    "callout-text": "bg:#13132a #888888",
    "callout-cmd": "bg:#13132a #5c8cc8 bold",
    "callout-hint": "bg:#13132a #555555",
    "rule": "#444444",
    "operator": "bold #e0e0e0",
    "operator-bar": "#4ec9b0",
    "tool-dot": "#5c8cc8 bold",
    "tool-name": "#61afef",
    "tool-detail": "#888888",
    "model-bar": "#6a7ec8",
    "model-text": "#d4d4d4",
    "streaming-cursor": "#6a7ec8",
    "stats": "#555555",
    "thinking": "#e5c07b",
    "system-msg": "#888888 italic",
    "pending-rule": "#555555",
    "pending-bar": "#e5c07b",
    "pending-text": "#e5c07b italic",
    "pending-hint": "#555555 italic",
    "footer-bg": "bg:#1a1a2e #aaaaaa",
    "ft-name": "#4ec9b0",
    "ft-mode": "#e5c07b",
    "ft-dim": "#555555",
    "ctx-ok": "#4ec9b0",
    "ctx-warn": "#e5c07b",
    "ctx-crit": "#e06c75",
    "ft-path": "#61afef",
    "ft-branch": "#5c8cc8",
    "input-text": "#e0e0e0",
    "input-placeholder": "#555555 italic",
})


# ── Build TUI Application ───────────────────────────────────────────

def build_tui_app(
    state: TUIState,
    on_submit: "callable",
    on_escape: "callable | None" = None,
    on_recall_pending: "callable | None" = None,
    on_idle: "callable | None" = None,
) -> Application:
    """Build the full-screen prompt_toolkit Application.

    Args:
        state: TUIState instance — the app reads from and the agent thread writes to.
        on_submit: Callback(text: str, app: Application) called when the operator submits.
    """
    def _get_width():
        try:
            return os.get_terminal_size().columns
        except OSError:
            return 120

    # Conversation — fragment slicing for scroll with full FormattedText colors
    _all_lines: list[list[tuple[str, str]]] = [[]]
    _scroll_bottom = [True]
    _scroll_top = [0]

    def _h():
        try: return os.get_terminal_size().lines - 4
        except: return 40

    def _render_lines():
        return _render_to_lines(state, _get_width())

    def _get_conv():
        lines = _render_lines()
        _all_lines[0] = lines
        vh = _h()
        total = len(lines)
        if _scroll_bottom[0] or total <= vh:
            start = max(0, total - vh)
        else:
            start = max(0, min(_scroll_top[0], total - vh))
        frags = []
        for line_frags in lines[start:start + vh]:
            frags.extend(line_frags)
            frags.append(("", "\n"))
        return FormattedText(frags)

    scrollable = Window(
        content=_ScrollableControl(
            _get_conv, focusable=False, show_cursor=False,
            on_scroll_up=lambda: _scroll_up_n(3),
            on_scroll_down=lambda: _scroll_down_n(3),
        ),
        wrap_lines=True,
        height=Dimension(weight=1),
    )

    def _scroll_to_end():
        _scroll_bottom[0] = True

    state._scroll_to_end = _scroll_to_end

    # Footer
    sep = Window(
        content=FormattedTextControl(
            lambda: FormattedText([("class:rule", "─" * _get_width())])
        ),
        height=1,
    )
    footer = Window(
        content=FormattedTextControl(lambda: _render_footer(state, _get_width())),
        height=1,
        style="class:footer-bg",
    )

    # Input
    def _get_prompt():
        if input_area.text:
            return FormattedText([("class:input-text", "")])
        if state.pending_message and not state.busy:
            return FormattedText([("class:input-placeholder",
                                   "press enter to send · ↑ to edit · esc to cancel ")])
        if state.busy:
            return FormattedText([("class:input-placeholder",
                                   "voidrift is working · type to queue a message ")])
        return FormattedText([("class:input-placeholder",
                               "ask a question or describe a task ↵ ")])

    input_area = TextArea(
        height=1, multiline=False, style="class:input-text", prompt=_get_prompt,
    )

    root = HSplit([
        scrollable,
        sep,
        footer,
        Window(height=1),
        input_area,
    ])
    layout = Layout(root, focused_element=input_area)

    # Key bindings
    kb = KeyBindings()

    @kb.add("enter")
    def _submit(event):
        text = input_area.text.strip()
        if not text:
            # Empty Enter with pending message and idle agent → dispatch pending
            if state.pending_message and not state.busy:
                t = state.pending_message
                state.pending_message = None
                state._consecutive_interrupt = 0
                on_submit(t, event.app)
            return
        input_area.text = ""
        input_area.buffer.reset()
        state._consecutive_interrupt = 0
        state._history_idx = -1
        on_submit(text, event.app)

    @kb.add("c-j")
    def _newline(event):
        input_area.buffer.insert_text("\n")

    @kb.add("up")
    def _recall(event):
        # Pending recall takes priority
        if on_recall_pending and state.pending_message and not input_area.text:
            text = on_recall_pending()
            if text:
                input_area.text = text
                input_area.buffer.cursor_position = len(text)
            return
        # Input history
        if not state.input_history:
            return
        if state._history_idx == -1:
            state._saved_input = input_area.text
            state._history_idx = len(state.input_history) - 1
        elif state._history_idx > 0:
            state._history_idx -= 1
        else:
            return
        input_area.text = state.input_history[state._history_idx]
        input_area.buffer.cursor_position = len(input_area.text)

    @kb.add("down")
    def _history_fwd(event):
        if state._history_idx == -1:
            return
        if state._history_idx < len(state.input_history) - 1:
            state._history_idx += 1
            input_area.text = state.input_history[state._history_idx]
            input_area.buffer.cursor_position = len(input_area.text)
        else:
            # Past newest — restore saved input
            state._history_idx = -1
            input_area.text = state._saved_input
            input_area.buffer.cursor_position = len(input_area.text)

    def _scroll_up_n(n):
        cur = _scroll_top[0] if not _scroll_bottom[0] else max(0, len(_all_lines[0]) - _h())
        _scroll_bottom[0] = False
        _scroll_top[0] = max(0, cur - n)

    def _scroll_down_n(n):
        total = len(_all_lines[0]); vh = _h()
        _scroll_top[0] = min(max(0, total - vh), _scroll_top[0] + n)
        if _scroll_top[0] >= total - vh:
            _scroll_bottom[0] = True

    @kb.add("pageup")
    def _pgup(event): _scroll_up_n(20)

    @kb.add("pagedown")
    def _pgdn(event): _scroll_down_n(20)

    @kb.add("c-c")
    def _interrupt(event):
        if state.busy:
            # First Ctrl+C while busy — cancel like Escape
            if on_escape:
                on_escape(event.app)
            state._consecutive_interrupt = 1
        elif getattr(state, '_consecutive_interrupt', 0) >= 1:
            # Second Ctrl+C — exit
            event.app.exit()
        else:
            state._consecutive_interrupt = 1
            state.add_system("Press Ctrl+C again to exit.")

    @kb.add("escape")
    def _cancel(event):
        if state.pending_message:
            state.pending_message = None
            state._refresh()
        if on_escape and state.busy:
            on_escape(event.app)

    app = Application(
        layout=layout,
        key_bindings=kb,
        style=TUI_STYLE,
        full_screen=True,
        mouse_support=True,
        cursor=CursorShape.BLOCK,
    )

    state._invalidate = lambda: app.invalidate()

    # Spinner refresh thread
    def _tick(a):
        _was_busy = [False]
        while True:
            time.sleep(0.1)
            try:
                if state.thinking or any(m.streaming for m in state.messages):
                    a.invalidate()
                # Detect busy→idle transition for pending dispatch
                if _was_busy[0] and not state.busy:
                    if on_idle:
                        on_idle(a)
                _was_busy[0] = state.busy
            except Exception:
                break

    threading.Thread(target=_tick, args=(app,), daemon=True).start()

    return app
