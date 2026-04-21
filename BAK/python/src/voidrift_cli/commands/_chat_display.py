"""Shared chat utilities — PermissionGate and model context query.

Kept separate from _chat_tui.py for independent testability.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PermissionGate:
    """Session-scoped permission grants for chat write/run/read-outside actions (REQ-U-22).

    Zero I/O — tracks whether the operator has granted always-allow for each
    action category. Independently testable without a running terminal.
    """
    writes: bool = False
    runs: bool = False
    reads_outside: bool = False


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
        import logging
        logging.getLogger(__name__).debug(
            "max_context query failed for %s: %s", mc.alias, exc
        )
    return mc.max_context
