"""Structured error tracking for command runs (REQ-LOG-6)."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

ErrorCategory = Literal["api", "tool", "filesystem", "parse", "timeout", "budget", "context"]


@dataclass
class ErrorEvent:
    category: ErrorCategory
    error_type: str
    message: str
    task: str | None = None
    tool: str | None = None
    recoverable: bool = True
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()


class ErrorTracker:
    """Accumulates errors during a command run."""

    def __init__(self) -> None:
        self._events: list[ErrorEvent] = []

    def record(self, category: ErrorCategory, error_type: str, message: str, **kw) -> None:
        self._events.append(ErrorEvent(category=category, error_type=error_type, message=message, **kw))

    def has_errors(self) -> bool:
        return bool(self._events)

    def summary_by_category(self) -> dict[str, int]:
        counts: dict[str, int] = defaultdict(int)
        for e in self._events:
            counts[e.category] += 1
        return dict(counts)

    def to_state_dict(self) -> list[dict]:
        """Compact representation for STATE.md."""
        by_cat: dict[str, list[ErrorEvent]] = defaultdict(list)
        for e in self._events:
            by_cat[e.category].append(e)
        return [
            {"category": k, "count": len(v), "examples": [
                {"type": e.error_type, "task": e.task, "msg": e.message[:120], "recoverable": e.recoverable}
                for e in v[:3]
            ]}
            for k, v in sorted(by_cat.items())
        ]

    def render_summary_table(self):
        """Return a Rich Table summarizing errors by category."""
        from rich.table import Table
        table = Table(title="Errors", box=None, show_header=True, header_style="bold")
        table.add_column("Category")
        table.add_column("Count", justify="right")
        table.add_column("Type")
        table.add_column("Recoverable")
        table.add_column("Sample")
        by_cat: dict[str, list[ErrorEvent]] = defaultdict(list)
        for e in self._events:
            by_cat[e.category].append(e)
        for cat, events in sorted(by_cat.items()):
            table.add_row(
                cat, str(len(events)), events[0].error_type,
                "yes" if all(e.recoverable for e in events) else "NO",
                events[0].message[:60],
            )
        return table

    def write_jsonl(self, log_path: Path) -> None:
        """Write errors to .errors.jsonl alongside the command log."""
        jsonl_path = log_path.with_suffix(".errors.jsonl")
        with open(jsonl_path, "w", encoding="utf-8") as f:
            for e in self._events:
                f.write(json.dumps({
                    "category": e.category, "error_type": e.error_type,
                    "message": e.message, "task": e.task, "tool": e.tool,
                    "recoverable": e.recoverable, "timestamp": e.timestamp,
                }, ensure_ascii=False) + "\n")
