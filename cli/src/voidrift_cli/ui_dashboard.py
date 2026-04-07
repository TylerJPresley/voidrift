"""Live develop dashboard — Rich table rendering concurrent task progress (REQ-UI-11)."""

from __future__ import annotations

import threading
import time

from rich.console import Console

_err = Console(stderr=True)

TaskStatus = str  # "queued" | "running" | "done" | "failed"


class DevelopDashboard:
    """Rich Live table showing one row per concurrent task (REQ-UI-11)."""

    def __init__(self) -> None:
        self._rows: dict[str, dict] = {}  # key → state dict
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._live = None

    def add_task(self, key: str, label: str) -> None:
        """Register a task row and return its on_progress callback."""
        with self._lock:
            self._rows[key] = {
                "label": label, "status": "queued", "turn": 0,
                "pt": 0, "ct": 0, "ctx": None, "elapsed": 0.0,
                "last_tool": "", "start": None,
            }

    def tracker(self, key: str):
        """Return an on_progress callback for the given task key."""
        def _cb(data: dict) -> None:
            with self._lock:
                r = self._rows.get(key)
                if not r:
                    return
                if r["start"] is None:
                    r["start"] = time.time()
                    r["status"] = "running"
                if data.get("prompt_tokens"):
                    r["pt"] = data["prompt_tokens"]
                if data.get("completion_tokens"):
                    r["ct"] += data["completion_tokens"]
                if data.get("ctx_pct") is not None:
                    r["ctx"] = data["ctx_pct"]
                if data.get("turn"):
                    r["turn"] = data["turn"]
                if data.get("last_tool"):
                    r["last_tool"] = data["last_tool"]
                if r["start"]:
                    r["elapsed"] = time.time() - r["start"]
        return _cb

    def mark_done(self, key: str, *, failed: bool = False) -> None:
        with self._lock:
            r = self._rows.get(key)
            if r:
                r["status"] = "failed" if failed else "done"
                if r["start"]:
                    r["elapsed"] = time.time() - r["start"]

    def _render(self):
        from rich.table import Table
        table = Table(box=None, padding=(0, 1), show_header=True, header_style="bold dim")
        table.add_column("Task", min_width=16)
        table.add_column("Status", min_width=7)
        table.add_column("Turn", min_width=4, justify="right")
        table.add_column("Tokens", min_width=12)
        table.add_column("Ctx%", min_width=5, justify="right")
        table.add_column("Elapsed", min_width=7, justify="right")
        table.add_column("Last Tool", min_width=20)

        _STYLES = {"queued": "dim", "running": "green", "done": "blue", "failed": "red bold"}

        with self._lock:
            rows = sorted(self._rows.items())

        for key, r in rows:
            style = _STYLES.get(r["status"], "")
            tokens = f"{r['pt'] // 1000}K↓ {r['ct'] // 1000}K↑" if r["pt"] or r["ct"] else "—"
            ctx = f"{r['ctx']:.0f}%" if r["ctx"] is not None else "—"
            elapsed = f"{r['elapsed']:.0f}s" if r["elapsed"] else "—"
            tool = r["last_tool"][:24] if r["last_tool"] else "—"
            table.add_row(
                r["label"], r["status"],
                str(r["turn"]) if r["turn"] else "—",
                tokens, ctx, elapsed, tool,
                style=style,
            )
        return table

    def _run(self) -> None:
        while not self._stop.wait(0.25):
            if self._live:
                try:
                    self._live.update(self._render())
                except Exception:
                    pass

    def __enter__(self) -> "DevelopDashboard":
        from rich.live import Live as _Live
        self._live = _Live(self._render(), console=_err, refresh_per_second=4)
        self._live.__enter__()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=0.5)
        if self._live:
            try:
                self._live.update(self._render())
            except Exception:
                pass
            self._live.__exit__(exc_type, exc_val, exc_tb)
