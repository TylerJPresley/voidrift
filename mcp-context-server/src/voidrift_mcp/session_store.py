"""Session metadata and ephemeral run data via SQLite (REQ-MCP-10)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class SessionStore:
    """SQLite-backed session metadata and ephemeral run-scoped data."""

    def __init__(self, db_path: Path | str = ":memory:"):
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
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
            CREATE TABLE IF NOT EXISTS ephemeral (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_ephemeral_run_kind_key
                ON ephemeral(run_id, kind, key);
            """
        )
        self._conn.commit()

    def start_session(self, run_id: str, phase: str = "", project_dir: str = "") -> int:
        """Start a new session and return its ID."""
        cur = self._conn.execute(
            "INSERT INTO sessions (run_id, started_at, phase, project_dir) VALUES (?, ?, ?, ?)",
            (run_id, datetime.now(timezone.utc).isoformat(), phase, project_dir),
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
        """Record an action in the context log for a session."""
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

    def put(self, run_id: str, kind: str, key: str, value: str) -> None:
        """Store ephemeral data scoped to a run."""
        self._conn.execute(
            "INSERT OR REPLACE INTO ephemeral (run_id, kind, key, value) VALUES (?, ?, ?, ?)",
            (run_id, kind, key, value),
        )
        self._conn.commit()

    def get(self, run_id: str, kind: str, key: str) -> str | None:
        """Get a single ephemeral value."""
        row = self._conn.execute(
            "SELECT value FROM ephemeral WHERE run_id = ? AND kind = ? AND key = ?",
            (run_id, kind, key),
        ).fetchone()
        return row["value"] if row else None

    def get_all(self, run_id: str, kind: str) -> dict[str, str]:
        """Get all ephemeral values of a kind for a run."""
        rows = self._conn.execute(
            "SELECT key, value FROM ephemeral WHERE run_id = ? AND kind = ?",
            (run_id, kind),
        ).fetchall()
        return {r["key"]: r["value"] for r in rows}

    def get_session_log(self, session_id: int) -> list[dict]:
        """Return all context log entries for a session."""
        rows = self._conn.execute(
            "SELECT * FROM context_log WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def close(self) -> None:
        """Close the database connection."""
        self._conn.close()
