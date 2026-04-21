"""Idea refinement state machine for the chat command (REQ-U-21)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class IdeaState(Enum):
    IDLE = "idle"
    COLLECTING = "collecting"
    CONFIRM_PENDING = "confirm_pending"


@dataclass
class IdeaSession:
    """Tracks the state of an active idea refinement flow.

    Zero I/O — transitions state and accumulates lines without any terminal or
    model interaction.  The ``idea_id`` attribute carries the manifest ID
    between ``/idea`` activation and ``/done`` finalisation.
    """

    state: IdeaState = IdeaState.IDLE
    lines: list[str] = field(default_factory=list)
    idea_id: int | None = None

    def start(self) -> None:
        """Begin collecting an idea."""
        self.state = IdeaState.COLLECTING
        self.lines = []

    def add_line(self, line: str) -> None:
        """Append a line to the current idea. Only valid in COLLECTING state."""
        if self.state != IdeaState.COLLECTING:
            raise ValueError(f"Cannot add line in state {self.state}")
        self.lines.append(line)

    def confirm(self) -> str:
        """Confirm and return the collected idea text. Resets state to IDLE."""
        if self.state not in (IdeaState.COLLECTING, IdeaState.CONFIRM_PENDING):
            raise ValueError(f"Nothing to confirm in state {self.state}")
        text = "\n".join(self.lines)
        self.state = IdeaState.IDLE
        self.lines = []
        return text

    def cancel(self) -> None:
        """Discard the current idea and return to IDLE."""
        self.state = IdeaState.IDLE
        self.lines = []
        self.idea_id = None

    def is_active(self) -> bool:
        """Return True when an idea refinement flow is in progress."""
        return self.state != IdeaState.IDLE


def _handle_idea_command(
    line: str,
    agent: object,
    log: "str | Path",
    idea_session: IdeaSession,
) -> str:
    """Handle /idea and /done slash commands in the chat loop.

    Args:
        line: Raw user input line.
        agent: AgentLoop instance for message injection.
        log: Path to the session log file.
        idea_session: Active IdeaSession tracking refinement state.

    Returns:
        Replacement user message to send to the agent, or "" to skip the turn.
    """
    from ..manifest import ManifestManager
    from .. import prompts as _prompts

    low = line.lower().strip()

    if low == "/done" and idea_session.is_active():
        mm = ManifestManager()
        if mm.exists():
            mm.load()
        mm.ensure_dirs()

        idea_id = idea_session.idea_id
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
            f"ideas/IDEA-{idea_id}.md using file(action='write'). "
            f"Include: title, user story, context, acceptance criteria, "
            f"affected modules, and affected files (if modifying existing behavior)."
        )
        idea_session.cancel()
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
            idea_session.start()
            idea_session.idea_id = idea_id
            from .. import ui as _ui
            _ui.info(f"Loaded IDEA-{idea_id}. Type /done when finished.")
            return f"I've loaded IDEA-{idea_id}. Summarize where we left off and ask what I'd like to refine."
        else:
            idea_context = "This is a new idea. Start with Stage 1 — Intake."
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            idea_session.start()
            from .. import ui as _ui
            _ui.info("Starting idea refinement. Type /done when finished.")
            return "I want to develop a new idea."

    return line  # not an idea command — return unmodified
