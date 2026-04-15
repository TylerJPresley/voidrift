"""Agent context management — message history snipping, trimming, and compaction.

These strategies reduce the context window usage of an agent loop without
modifying the agent's core send/receive logic.
"""

from __future__ import annotations

import logging
from typing import Callable

_SNIP_READ_TOOLS = {"file"}
_SNIP_MIN_CHARS = 500
_REACTIVE_COMPACT_MAX = 2


def snip_old_tool_results(messages: list[dict], max_age_turns: int = 2) -> list[dict]:
    """Replace old read-tool results with placeholders to free context (TASK-FW-008).

    A tool result is snipped when:
    - It's from a read tool (file with action="read")
    - At least max_age_turns assistant messages have appeared after it
    - Its content exceeds 500 characters

    Returns a new list — the input is not modified.
    """
    if max_age_turns <= 0:
        return messages

    # Map tool_call_id → function name from assistant messages
    tc_names: dict[str, str] = {}
    tc_args: dict[str, str] = {}
    for m in messages:
        for tc in m.get("tool_calls") or []:
            fn = tc.get("function", {})
            tc_names[tc["id"]] = fn.get("name", "")
            tc_args[tc["id"]] = fn.get("arguments", "")

    # Count assistant messages (turns) from the end
    assistant_count = 0
    turn_index: dict[int, int] = {}  # message index → turns remaining after it
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "assistant" and messages[i].get("tool_calls"):
            turn_index[i] = assistant_count
            assistant_count += 1

    # Build result — snip eligible tool results
    result = []
    for i, m in enumerate(messages):
        if m.get("role") == "tool":
            tc_id = m.get("tool_call_id", "")
            name = tc_names.get(tc_id, "")
            content = m.get("content", "")
            # Find the assistant message that contained this tool call
            age = None
            for j in range(i - 1, -1, -1):
                if j in turn_index and any(
                    tc.get("id") == tc_id for tc in (messages[j].get("tool_calls") or [])
                ):
                    age = turn_index[j]
                    break
            if (
                name in _SNIP_READ_TOOLS
                and age is not None
                and age >= max_age_turns
                and len(content) > _SNIP_MIN_CHARS
            ):
                # For domain 'file' tool, only snip read actions
                if name == "file":
                    import json as _json
                    try:
                        _a = _json.loads(tc_args.get(tc_id, "{}")).get("action")
                    except (ValueError, KeyError):
                        _a = None
                    if _a != "read":
                        result.append(m)
                        continue
                lines = content.count("\n") + 1
                placeholder = f"[result from {name}({tc_args.get(tc_id, '')[:80]}) — {lines} lines snipped]"
                result.append({**m, "content": placeholder})
                continue
        result.append(m)
    return result


def trim_messages(messages: list[dict]) -> tuple[list[dict], bool]:
    """Drop the oldest tool call / tool result block to reduce context size.

    Returns (new_messages, did_trim).
    """
    system_msgs = [m for m in messages if m.get("role") == "system"]
    other_msgs = [m for m in messages if m.get("role") != "system"]

    if len(other_msgs) < 4:
        return messages, False

    for i, msg in enumerate(other_msgs):
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            j = i + 1
            while j < len(other_msgs) and other_msgs[j].get("role") == "tool":
                j += 1
            if j < len(other_msgs):
                removed = j - i
                other_msgs = other_msgs[:i] + other_msgs[j:]
                return system_msgs + other_msgs, True

    return messages, False


def reactive_compact(
    messages: list[dict],
    compact_fn: Callable[[str], str],
    compact_count: int,
) -> tuple[list[dict], int, bool]:
    """Summarize old messages to free context (REQ-ARCH-12).

    compact_fn receives the full message content (instruction + conversation text)
    and returns the summary string.

    Returns (new_messages, new_compact_count, did_compact).
    """
    if compact_count >= _REACTIVE_COMPACT_MAX:
        return messages, compact_count, False

    system_msgs = [m for m in messages if m.get("role") == "system"]
    other_msgs = [m for m in messages if m.get("role") != "system"]

    if len(other_msgs) <= 4:
        return messages, compact_count, False
    to_compact = other_msgs[:-4]
    keep = other_msgs[-4:]

    summary_parts = []
    for m in to_compact:
        role = m.get("role", "?")
        content = m.get("content") or ""
        if content:
            summary_parts.append(f"[{role}] {content[:500]}")
    summary_input = "\n".join(summary_parts)

    full_content = (
        "Summarize this conversation history concisely. "
        "Preserve: file paths, decisions, current task state.\n\n"
        + summary_input
    )

    try:
        summary = compact_fn(full_content)
    except Exception as exc:
        logging.getLogger(__name__).debug(
            "reactive_compact: summarization call failed — skipping compaction: %s", exc
        )
        return messages, compact_count, False

    freed = len(to_compact)
    new_count = compact_count + 1
    new_messages = system_msgs + [
        {"role": "assistant", "content": f"[Context summary]\n{summary}"},
    ] + keep
    return new_messages, new_count, True
