"""Interaction tools — operator questions."""

from __future__ import annotations

import sys
from typing import Callable


def make_ask_user_handler(
    ask_fn: Callable[[str, list[str] | None], str] | None = None,
) -> Callable:
    """Create an ask_user_question handler bound to the current session (REQ-TOOL-5).

    Args:
        ask_fn: Callback that displays the question and returns the operator's response.
                If None, uses a non-interactive fallback.

    Returns:
        Handler callable with a ``set_ask_fn`` method for display-layer updates.
    """
    _ask_fn_holder: list = [ask_fn]

    def handler(question: str, options: str | None = None) -> str:
        opt_list = None
        if options:
            try:
                import json as _json
                opt_list = _json.loads(options) if isinstance(options, str) else options
            except (ValueError, TypeError):
                opt_list = None

        if not sys.stdin.isatty() or _ask_fn_holder[0] is None:
            return "[No operator present. Use your best judgment and document your decision in comments.]"
        return _ask_fn_holder[0](question, opt_list)

    def set_ask_fn(fn: Callable[[str, list[str] | None], str]) -> None:
        _ask_fn_holder[0] = fn

    handler.set_ask_fn = set_ask_fn  # type: ignore[attr-defined]
    return handler
