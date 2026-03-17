"""Textual TUI for interactive gather phase (REQ-UI-1, REQ-UI-2)."""

from __future__ import annotations

from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.widgets import Header, Markdown, Static, TextArea

from .agent import AgentLoop


class MessageBubble(Static):
    """A single message in the conversation."""

    def __init__(self, text: str, role: str = "assistant") -> None:
        super().__init__()
        self.text = text
        self.role = role

    def compose(self) -> ComposeResult:
        yield Markdown(self.text)

    def on_mount(self) -> None:
        self.add_class(self.role)


class GatherApp(App):
    """Interactive gather TUI (REQ-UI-1)."""

    CSS = """
    #chat {
        height: 1fr;
        padding: 1 2;
    }
    .user {
        background: $primary 15%;
        color: $text;
        margin: 1 0 0 20;
        padding: 0 2;
        border: round $primary 40%;
        text-align: right;
    }
    .assistant {
        background: $surface-lighten-1;
        color: $text;
        margin: 1 20 0 0;
        padding: 0 2;
        border: round $surface-lighten-2;
    }
    .assistant.streaming {
        border: round $accent 50%;
    }
    #prompt {
        dock: bottom;
        height: auto;
        min-height: 3;
        max-height: 8;
        margin: 0 2 1 2;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Exit", show=True),
    ]

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
        self._streaming_bubble: MessageBubble | None = None
        self._streaming_text = ""

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        yield VerticalScroll(id="chat")
        yield TextArea(id="prompt")

    def on_mount(self) -> None:
        self.title = "VoidRift Gather"
        self.sub_title = f"{self.model_label} · {self.target_label}"
        prompt = self.query_one("#prompt", TextArea)
        prompt.focus()
        prompt.show_line_numbers = False

    def _on_key(self, event) -> None:
        """Submit on Enter, newline on Shift+Enter."""
        prompt = self.query_one("#prompt", TextArea)
        if not prompt.has_focus:
            return
        if event.key == "enter" and not event.shift:
            event.prevent_default()
            text = prompt.text.strip()
            if not text:
                return
            prompt.clear()
            if text.lower() in ("quit", "exit", "/quit"):
                self.exit()
                return

            chat = self.query_one("#chat", VerticalScroll)
            chat.mount(MessageBubble(text, role="user"))
            chat.scroll_end(animate=False)

            with open(self.log_file, "a") as f:
                f.write(f"\n> {text}\n")

            prompt.disabled = True
            self._send_message(text)

    @work(thread=True)
    def _send_message(self, text: str) -> None:
        """Send message to agent in background thread."""
        self._streaming_text = ""

        def on_token(token: str) -> None:
            self._streaming_text += token
            self.call_from_thread(self._update_stream, self._streaming_text)

        self.agent.on_token = on_token
        try:
            response = self.agent.send(text)
        except RuntimeError as e:
            self.call_from_thread(self._show_error, str(e))
            return
        finally:
            self.agent.on_token = None

        self.call_from_thread(self._finish_stream, response)

    def _update_stream(self, text: str) -> None:
        """Update the streaming message bubble."""
        chat = self.query_one("#chat", VerticalScroll)
        if self._streaming_bubble is None:
            self._streaming_bubble = MessageBubble(text, role="assistant")
            self._streaming_bubble.add_class("streaming")
            chat.mount(self._streaming_bubble)
        else:
            md = self._streaming_bubble.query_one(Markdown)
            md.update(text)
        chat.scroll_end(animate=False)

    def _finish_stream(self, response: str) -> None:
        """Finalize the streamed response."""
        if self._streaming_bubble:
            self._streaming_bubble.remove_class("streaming")
            md = self._streaming_bubble.query_one(Markdown)
            md.update(response)
        self._streaming_bubble = None
        self._streaming_text = ""

        with open(self.log_file, "a") as f:
            f.write(f"\n{response}\n")

        prompt = self.query_one("#prompt", TextArea)
        prompt.disabled = False
        prompt.focus()
        self.query_one("#chat", VerticalScroll).scroll_end(animate=False)

    def _show_error(self, msg: str) -> None:
        """Show an error message in the chat."""
        chat = self.query_one("#chat", VerticalScroll)
        chat.mount(MessageBubble(f"**Error:** {msg}", role="assistant"))
        self._streaming_bubble = None
        self._streaming_text = ""

        prompt = self.query_one("#prompt", TextArea)
        prompt.disabled = False
        prompt.focus()
        chat.scroll_end(animate=False)
