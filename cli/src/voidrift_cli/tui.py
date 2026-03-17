"""Textual TUI for interactive gather phase (REQ-UI-1, REQ-UI-2)."""

from __future__ import annotations

from pathlib import Path

from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.events import Key
from textual.message import Message
from textual.widgets import Button, Header, Markdown, Static, TextArea

from .agent import AgentLoop


class PromptInput(TextArea):
    """TextArea that sends a Submit message on Enter."""

    class Submitted(Message):
        """Fired when user presses Enter."""
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
    #input-bar {
        dock: bottom;
        height: auto;
        min-height: 3;
        max-height: 8;
        margin: 0 2 0 2;
    }
    #prompt {
        width: 1fr;
    }
    #send {
        width: 8;
        min-width: 8;
        height: 3;
        dock: right;
    }
    #hint {
        dock: bottom;
        height: 1;
        margin: 0 2;
        color: $text-muted;
        text-align: center;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Exit"),
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
        yield Static("Enter to send · Ctrl+C to exit", id="hint")
        with Horizontal(id="input-bar"):
            yield PromptInput(id="prompt")
            yield Button("Send", id="send", variant="primary")

    def on_mount(self) -> None:
        self.title = "VoidRift Gather"
        self.sub_title = f"{self.model_label} · {self.target_label}"
        self.query_one("#prompt", PromptInput).focus()

    @on(PromptInput.Submitted)
    def _on_submit(self, event: PromptInput.Submitted) -> None:
        """Handle submitted text from prompt."""
        self._submit(event.text)

    @on(Button.Pressed, "#send")
    def _on_send_pressed(self, event: Button.Pressed) -> None:
        """Handle send button click."""
        prompt = self.query_one("#prompt", PromptInput)
        text = prompt.text.strip()
        if text:
            prompt.clear()
            self._submit(text)

    def _submit(self, text: str) -> None:
        """Process user input."""
        if text.lower() in ("quit", "exit", "/quit"):
            self.exit()
            return

        chat = self.query_one("#chat", VerticalScroll)
        chat.mount(MessageBubble(text, role="user"))
        chat.scroll_end(animate=False)

        with open(self.log_file, "a") as f:
            f.write(f"\n> {text}\n")

        self.query_one("#prompt", PromptInput).disabled = True
        self.query_one("#send", Button).disabled = True
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

        self.query_one("#prompt", PromptInput).disabled = False
        self.query_one("#send", Button).disabled = False
        self.query_one("#prompt", PromptInput).focus()
        self.query_one("#chat", VerticalScroll).scroll_end(animate=False)

    def _show_error(self, msg: str) -> None:
        """Show an error message in the chat."""
        chat = self.query_one("#chat", VerticalScroll)
        chat.mount(MessageBubble(f"**Error:** {msg}", role="assistant"))
        self._streaming_bubble = None
        self._streaming_text = ""

        self.query_one("#prompt", PromptInput).disabled = False
        self.query_one("#send", Button).disabled = False
        self.query_one("#prompt", PromptInput).focus()
        chat.scroll_end(animate=False)
