"""Textual TUI for interactive gather phase (REQ-UI-1, REQ-UI-2)."""

from __future__ import annotations

from pathlib import Path

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.events import Key
from textual.message import Message
from textual.widgets import Header, Markdown, Static, TextArea

from .agent import AgentLoop


class PromptInput(TextArea):
    """TextArea that sends a Submit message on Enter."""

    class Submitted(Message):
        def __init__(self, text: str) -> None:
            super().__init__()
            self.text = text

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.show_line_numbers = False

    async def _on_key(self, event: Key) -> None:
        if event.key == "enter":
            event.prevent_default()
            event.stop()
            text = self.text.strip()
            if text:
                self.clear()
                self.post_message(self.Submitted(text))


class SystemMessage(Static):
    """Dim system info line."""
    pass


class UserMessage(Static):
    """User input displayed as '> text' on a subtle background."""
    pass


class AssistantLabel(Static):
    """Dim label showing model name before response."""
    pass


class AssistantMessage(Static):
    """Model response with markdown rendering."""

    def __init__(self, text: str = "") -> None:
        super().__init__()
        self._text = text

    def compose(self) -> ComposeResult:
        yield Markdown(self._text)

    def update_content(self, text: str) -> None:
        self._text = text
        try:
            self.query_one(Markdown).update(text)
        except Exception:
            pass


class GatherApp(App):
    """Interactive gather TUI (REQ-UI-1)."""

    CSS = """
    Screen {
        background: $surface;
    }
    #chat {
        height: 1fr;
        padding: 1 1 0 1;
    }
    SystemMessage {
        color: $text-muted;
        padding: 0 2;
        margin: 0;
    }
    #thinking {
        color: $text-muted;
        padding: 0 2;
        margin: 1 0;
    }
    UserMessage {
        background: $surface-lighten-1;
        padding: 1 2;
        margin: 1 0 0 0;
        color: $text;
    }
    AssistantLabel {
        color: $text-muted;
        text-style: italic;
        padding: 0 2;
        margin: 1 0 1 0;
    }
    AssistantMessage {
        padding: 0 2;
        margin: 0 0 1 0;
    }
    #prompt {
        dock: bottom;
        height: auto;
        min-height: 3;
        max-height: 8;
        width: 100%;
        margin: 0 1;
        padding: 1 1;
        border: round $primary 40%;
    }
    #hint {
        dock: bottom;
        height: 1;
        margin: 0 1;
        color: $text-muted;
        text-align: right;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Exit"),
    ]

    def action_quit(self) -> None:
        self._shutting_down = True
        self.exit()

    def __init__(
        self,
        agent: AgentLoop,
        log_file: Path,
        model_label: str,
        target_label: str,
        feature: str | None = None,
    ) -> None:
        super().__init__()
        self.agent = agent
        self.log_file = log_file
        self.model_label = model_label
        self.target_label = target_label
        self.feature = feature
        self._streaming_msg: AssistantMessage | None = None
        self._streaming_text = ""
        self._shutting_down = False

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield VerticalScroll(id="chat")
        yield Static("Enter to send · Ctrl+C to exit", id="hint")
        yield PromptInput(id="prompt")

    def on_mount(self) -> None:
        self.theme = "dracula"
        self.title = "VoidRift Gather"
        self.sub_title = f"{self.model_label} · {self.target_label}"
        chat = self.query_one("#chat", VerticalScroll)
        title = f"Feature: {self.feature}" if self.feature else "Full Project"
        chat.mount(SystemMessage(f"VoidRift Gather — {title}"))
        chat.mount(SystemMessage(f"Log: {self.log_file}"))
        chat.mount(SystemMessage(f"Model: {self.model_label}"))
        chat.mount(SystemMessage(f"Target: {self.target_label}"))
        self.query_one("#prompt", PromptInput).focus()

    @on(PromptInput.Submitted)
    def _on_submit(self, event: PromptInput.Submitted) -> None:
        self._submit(event.text)

    def _submit(self, text: str) -> None:
        if text.lower() in ("quit", "exit", "/quit"):
            self.exit()
            return

        chat = self.query_one("#chat", VerticalScroll)
        chat.mount(UserMessage(f"> {text}"))
        chat.mount(SystemMessage("⠋ Thinking...", id="thinking"))
        self._thinking_frames = iter(__import__('itertools').cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"))
        self._thinking_timer = self.set_interval(0.1, self._animate_thinking)
        chat.scroll_end(animate=False)

        with open(self.log_file, "a") as f:
            f.write(f"\n> {text}\n")

        self.query_one("#prompt", PromptInput).disabled = True
        self._send_message(text)

    def _animate_thinking(self) -> None:
        try:
            w = self.query_one("#thinking")
            w.update(f"{next(self._thinking_frames)} Thinking...")
        except Exception:
            self._stop_thinking()

    def _stop_thinking(self) -> None:
        if hasattr(self, "_thinking_timer") and self._thinking_timer:
            self._thinking_timer.stop()
            self._thinking_timer = None
        try:
            self.query_one("#thinking").remove()
        except Exception:
            pass

    @work(thread=True)
    def _send_message(self, text: str) -> None:
        self._streaming_text = ""
        self._stats: dict = {}

        def on_token(token: str) -> None:
            self._streaming_text += token
            self.call_from_thread(self._update_stream, self._streaming_text)

        def on_complete(stats: dict) -> None:
            self._stats = stats

        self.agent.on_token = on_token
        self.agent.on_complete = on_complete
        try:
            response = self.agent.send(text)
        except RuntimeError as e:
            self.call_from_thread(self._show_error, str(e))
            return
        finally:
            self.agent.on_token = None
            self.agent.on_complete = None

        self.call_from_thread(self._finish_stream, response)

    def _update_stream(self, text: str) -> None:
        if self._shutting_down:
            return
        chat = self.query_one("#chat", VerticalScroll)
        # Remove thinking indicator on first token
        self._stop_thinking()
        if self._streaming_msg is None:
            # Add model label before first token
            chat.mount(AssistantLabel(f"Responding with {self.model_label}"))
            self._streaming_msg = AssistantMessage(f"◆ {text}")
            chat.mount(self._streaming_msg)
        else:
            self._streaming_msg.update_content(f"◆ {text}")
        chat.scroll_end(animate=False)

    def _finish_stream(self, response: str) -> None:
        if self._shutting_down:
            return
        self._stop_thinking()
        if self._streaming_msg:
            self._streaming_msg.update_content(f"◆ {response}")
        self._streaming_msg = None
        self._streaming_text = ""

        # Show stats
        stats = self._stats
        if stats:
            parts = []
            if stats.get("completion_tokens"):
                parts.append(f"{stats['completion_tokens']} tokens")
            if stats.get("tokens_per_sec"):
                parts.append(f"{stats['tokens_per_sec']} tok/s")
            if stats.get("elapsed"):
                parts.append(f"{stats['elapsed']}s")
            if parts:
                chat = self.query_one("#chat", VerticalScroll)
                chat.mount(SystemMessage(" · ".join(parts)))

        with open(self.log_file, "a") as f:
            f.write(f"\n{response}\n")

        self.query_one("#prompt", PromptInput).disabled = False
        self.query_one("#prompt", PromptInput).focus()
        self.query_one("#chat", VerticalScroll).scroll_end(animate=False)

    def _show_error(self, msg: str) -> None:
        if self._shutting_down:
            return
        chat = self.query_one("#chat", VerticalScroll)
        self._stop_thinking()
        chat.mount(AssistantLabel(f"Error: {msg}"))
        self._streaming_msg = None
        self._streaming_text = ""

        self.query_one("#prompt", PromptInput).disabled = False
        self.query_one("#prompt", PromptInput).focus()
        chat.scroll_end(animate=False)
