"""Chat session persistence via project-scoped JSONL (REQ-U-13)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


class ChatSession:
    """Append-only JSONL session at .voidrift/chat-session.jsonl."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._entries: list[dict] = []
        self._leaf_id: str | None = None

    @classmethod
    def load_or_create(cls, voidrift_dir: Path) -> "ChatSession":
        """Load existing session or create empty one."""
        s = cls(voidrift_dir / "chat-session.jsonl")
        if s.path.exists():
            for line in s.path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    try:
                        s._entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
            # Find leaf — last message or compaction entry
            for e in reversed(s._entries):
                if e.get("type") in ("message", "compaction"):
                    s._leaf_id = e["id"]
                    break
        return s

    def append_message(self, role: str, content, **extra) -> str:
        """Append a message entry. Returns the entry id."""
        eid = _uid()
        entry = {
            "id": eid,
            "parentId": self._leaf_id,
            "type": "message",
            "timestamp": _now(),
            "role": role,
            "content": content,
            **extra,
        }
        self._write(entry)
        return eid

    def append_compaction(self, summary: str) -> str:
        """Append a compaction entry. Returns the entry id."""
        eid = _uid()
        entry = {
            "id": eid,
            "parentId": self._leaf_id,
            "type": "compaction",
            "timestamp": _now(),
            "summary": summary,
        }
        self._write(entry)
        return eid

    def _write(self, entry: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self._entries.append(entry)
        self._leaf_id = entry["id"]

    def clear(self) -> None:
        """Delete session file and reset state."""
        if self.path.exists():
            self.path.unlink()
        self._entries.clear()
        self._leaf_id = None

    def reconstruct_messages(self) -> list[dict]:
        """Walk parent chain from leaf to root, return API-format messages.

        Stops at the most recent compaction entry and uses its summary
        as a system message prefix. Sanitizes: strips empty content and
        orphaned tool calls.
        """
        if not self._entries or not self._leaf_id:
            return []

        # Build id→entry index
        by_id = {e["id"]: e for e in self._entries}

        # Walk parent chain from leaf to root
        chain: list[dict] = []
        cur = self._leaf_id
        while cur and cur in by_id:
            chain.append(by_id[cur])
            cur = by_id[cur].get("parentId")
        chain.reverse()  # chronological order

        # Find most recent compaction — use it as boundary
        messages: list[dict] = []
        for e in chain:
            if e["type"] == "compaction":
                messages = [{"role": "system", "content": e["summary"]}]
            elif e["type"] == "message":
                messages.append({"role": e["role"], "content": e["content"]})

        return _sanitize(messages)

    def message_count(self) -> int:
        return sum(1 for e in self._entries if e.get("type") == "message")

    def last_timestamp(self) -> str | None:
        for e in reversed(self._entries):
            if e.get("type") in ("message", "compaction"):
                return e.get("timestamp")
        return None

    @property
    def has_messages(self) -> bool:
        return any(e.get("type") == "message" for e in self._entries)

    def search_entries(self, query: str, limit: int = 5) -> list[dict]:
        """Search all message entries by case-insensitive substring match.

        Returns up to *limit* matching entries (newest first), each with
        timestamp, role, and content truncated to 2000 characters.
        """
        limit = max(1, min(limit, 10))
        q = query.lower()
        matches: list[dict] = []
        for e in reversed(self._entries):
            if e.get("type") != "message":
                continue
            content = e.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    c.get("text", "") if isinstance(c, dict) else str(c)
                    for c in content
                )
            if not isinstance(content, str):
                content = str(content)
            if q in content.lower():
                truncated = content[:2000]
                if len(content) > 2000:
                    truncated += "... [truncated]"
                matches.append({
                    "timestamp": e.get("timestamp", ""),
                    "role": e.get("role", ""),
                    "content": truncated,
                })
                if len(matches) >= limit:
                    break
        return matches


def _sanitize(messages: list[dict]) -> list[dict]:
    """Strip empty messages and orphaned tool calls."""
    # Collect tool_call_ids that have results
    result_ids: set[str] = set()
    for m in messages:
        if m["role"] == "tool" and isinstance(m.get("content"), str):
            tid = m.get("tool_call_id")
            if tid:
                result_ids.add(tid)

    out: list[dict] = []
    for m in messages:
        content = m.get("content")
        # Strip empty/whitespace-only content
        if isinstance(content, str) and not content.strip():
            continue
        # Strip orphaned tool_use (assistant with tool_calls but no matching result)
        if m["role"] == "assistant" and isinstance(content, list):
            # content is tool_calls list — check if all have results
            has_orphan = False
            for tc in content:
                if isinstance(tc, dict) and tc.get("id") and tc["id"] not in result_ids:
                    has_orphan = True
                    break
            if has_orphan:
                continue
        out.append(m)
    return out
