"""Session metadata storage via SQLite (AC-MCP5)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class SessionStore:
    """SQLite-backed session metadata: tracks what was loaded, what changed."""

    def __init__(self, db_path: Path | str = ":memory:"):
        self._conn = sqlite3.connect(str(db_path))
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                phase TEXT,
                project_dir TEXT
            );
            CREATE TABLE IF NOT EXISTS context_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_key TEXT,
                detail TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            """
        )
        self._conn.commit()

    def start_session(self, phase: str = "", project_dir: str = "") -> int:
        cur = self._conn.execute(
            "INSERT INTO sessions (started_at, phase, project_dir) VALUES (?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), phase, project_dir),
        )
        self._conn.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def log_action(
        self,
        session_id: int,
        action: str,
        resource_type: str = "",
        resource_key: str = "",
        detail: str = "",
    ) -> None:
        self._conn.execute(
            "INSERT INTO context_log (session_id, timestamp, action, resource_type, resource_key, detail) VALUES (?, ?, ?, ?, ?, ?)",
            (
                session_id,
                datetime.now(timezone.utc).isoformat(),
                action,
                resource_type,
                resource_key,
                detail,
            ),
        )
        self._conn.commit()

    def get_session_log(self, session_id: int) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM context_log WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        self._conn.close()
