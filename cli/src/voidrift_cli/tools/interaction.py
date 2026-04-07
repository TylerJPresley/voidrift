"""Interaction tools — operator questions and web fetch placeholders."""

from __future__ import annotations

import sys
from typing import Callable


def web_fetch(url: str) -> str:
    """Fetch a URL and return a summary of its content (chat command only).

    The real handler is injected by the chat command via make_web_fetch_handler().
    This placeholder is registered so the agent tool schema is available at build time.
    """
    return "web_fetch is only available during an active chat session."


def ask_user_question(question: str, options: str | None = None) -> str:
    """Ask the operator a clarifying question (chat command only).

    The real handler is injected by the chat command via make_ask_user_handler().
    This placeholder is registered so the agent tool schema is available at build time.
    """
    if not sys.stdin.isatty():
        return "[No operator present. Use your best judgment and document your decision in comments.]"
    return "ask_user_question is only available during an active chat session."


def make_ask_user_handler(
    ask_fn: Callable[[str, list[str] | None], str] | None = None,
) -> Callable:
    """Create an ask_user_question handler bound to the current session (TASK-FW-011).

    Args:
        ask_fn: Callback that displays the question and returns the operator's response.
                If None, uses a non-interactive fallback.
    """
    def handler(question: str, options: str | None = None) -> str:
        opt_list = None
        if options:
            try:
                import json as _json
                opt_list = _json.loads(options) if isinstance(options, str) else options
            except (ValueError, TypeError):
                opt_list = None

        if not sys.stdin.isatty() or ask_fn is None:
            return "[No operator present. Use your best judgment and document your decision in comments.]"
        return ask_fn(question, opt_list)

    return handler
