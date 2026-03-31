"""Consistent console output for all commands (REQ-UI-1, REQ-UI-2).

Three output roles:
  System (▸) — dim white: command titles, stages, progress, logs
  Model  (◆) — light blue, 2-space indent: all model-generated text
  Operator (▶) — bold white: reprinted user input
"""

from __future__ import annotations

import random
import sys
import threading
import time

from rich.console import Console
from rich.markup import escape as _esc
from rich.status import Status as _Status

_SPINNER_LABELS_DEFAULT = [
    "Thinking", "Pondering", "Ruminating", "Cogitating", "Deliberating",
    "Contemplating", "Percolating", "Musing", "Tinkering", "Divining",
]


def _load_spinner_labels() -> list[str]:
    """Load labels from ~/.voidrift/spinner-labels.txt, falling back to defaults."""
    import os
    path = os.path.join(os.path.expanduser("~"), ".voidrift", "spinner-labels.txt")
    try:
        with open(path) as f:
            labels = [
                line.strip() for line in f
                if line.strip() and not line.startswith("#")
            ]
        return labels if labels else _SPINNER_LABELS_DEFAULT
    except OSError:
        return _SPINNER_LABELS_DEFAULT


def random_label() -> str:
    """Return a random spinner label with trailing ellipsis."""
    return f"{random.choice(_load_spinner_labels())}..."


def elapsed_str(seconds: float) -> str:
    """Format elapsed seconds as '3s' or '1m 3s'."""
    s = int(seconds)
    if s < 60:
        return f"{s}s"
    return f"{s // 60}m {s % 60}s"


def token_str(n: int) -> str:
    """Format token count with 'k' suffix for thousands."""
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def stats_str(
    elapsed: float,
    tokens_in: int,
    tokens_out: int,
    ctx_pct: int | None,
    status: str,
) -> str:
    """Format a stats segment: (elapsed [· tkns: ↓ Nk - ↑ Nk] [· ctx N%] · status)."""
    parts = []
    if elapsed >= 1:
        parts.append(elapsed_str(elapsed))
    if tokens_in or tokens_out:
        tkns = "tkns:"
        if tokens_in:
            tkns += f" ↓ {token_str(tokens_in)}"
        if tokens_in and tokens_out:
            tkns += " -"
        if tokens_out:
            tkns += f" ↑ {token_str(tokens_out)}"
        parts.append(tkns)
    if ctx_pct is not None:
        parts.append(f"ctx {ctx_pct}%")
    parts.append(status)
    return f"({' · '.join(parts)})"


class _Spinner:
    """Thread-driven Rich Status with live elapsed time, token telemetry, and ctx%.

    Usage::

        with spinner(random_label(), "operation-name") as spin:
            agent.on_progress = spin.on_progress
            response = agent.send(...)
    """

    def __init__(self, label: str, summary: str) -> None:
        self._label = label      # random label shown during live spinner
        self._summary = summary  # meaningful name shown in persisted summary line
        self._start = 0.0
        self._tokens_in = 0
        self._tokens_out = 0
        self._ctx_pct: int | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._status: _Status | None = None

    def _format(self, *, status: str = "thinking") -> str:
        with self._lock:
            elapsed = time.time() - self._start
            tokens_in = self._tokens_in
            tokens_out = self._tokens_out
            ctx_pct = self._ctx_pct
        return f"  {self._label} {stats_str(elapsed, tokens_in, tokens_out, ctx_pct, status)}"

    def _summary_line(self, *, status: str = "✓ complete") -> str:
        with self._lock:
            elapsed = time.time() - self._start
            tokens_in = self._tokens_in
            tokens_out = self._tokens_out
            ctx_pct = self._ctx_pct
        return f"  ▸ {self._summary} {stats_str(elapsed, tokens_in, tokens_out, ctx_pct, status)}"

    def on_progress(self, data: dict) -> None:
        """Receive token/ctx data from agent. Elapsed is managed by internal timer.

        prompt_tokens is updated to the latest value (grows as context accumulates).
        completion_tokens accumulates across all API calls in the spinner block.
        """
        with self._lock:
            if data.get("prompt_tokens"):
                self._tokens_in = data["prompt_tokens"]
            if data.get("completion_tokens"):
                self._tokens_out += data["completion_tokens"]
            if data.get("ctx_pct") is not None:
                self._ctx_pct = data["ctx_pct"]
        if self._status is not None:
            try:
                self._status.update(status=self._format(status="thinking"))
            except Exception:
                pass

    def _run(self) -> None:
        while not self._stop.wait(0.25):
            if self._status is not None:
                try:
                    self._status.update(status=self._format(status="thinking"))
                except Exception:
                    pass

    def __enter__(self) -> "_Spinner":
        self._start = time.time()
        self._status = _Status(self._format(status="thinking"), console=_con)
        self._status.__enter__()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=0.5)
        status = "✓ complete" if exc_type is None else "⚠ failed"
        final = self._summary_line(status=status)
        if self._status:
            try:
                self._status._live.transient = True  # clear spinner cleanly
            except Exception:
                pass
            self._status.__exit__(exc_type, exc_val, exc_tb)
        style = "dim" if exc_type is None else "yellow"
        _con.print(f"[{style}]{final}[/{style}]")


def spinner(label: str, summary: str) -> _Spinner:
    """Return a _Spinner context manager for automated command model calls.

    Args:
        label: Random/fun label shown in the live spinner during execution.
        summary: Meaningful operation name shown in the persisted summary line on exit.
    """
    return _Spinner(label, summary)


class _MultiSpinner:
    """Live block showing concurrent agent progress, optionally grouped.

    Ungrouped (gather): flat list of active/completed rows.
    Grouped (develop): rows organized under named group headers.

    Usage::

        # Ungrouped (gather-style)
        with multi_spinner("42 source files") as ms:
            futures = {pool.submit(task, fp, ms.track(fp)): fp for fp in files}

        # Grouped (develop-style)
        with multi_spinner("3 modules") as ms:
            ms.track("task-desc", group="backend")
    """

    def __init__(self, header: str) -> None:
        self._header = header
        self._groups: dict[str, dict] = {}  # group -> {active: {}, completed: []}
        self._DEFAULT = ""
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._live = None

    def _ensure_group(self, group: str) -> dict:
        if group not in self._groups:
            self._groups[group] = {"active": {}, "completed": []}
        return self._groups[group]

    def track(self, descriptor: str, group: str = ""):
        """Register a descriptor and return its on_progress callback."""
        with self._lock:
            g = self._ensure_group(group or self._DEFAULT)
            g["active"][descriptor] = {"start": None, "pt": 0, "ct": 0, "ctx": None}

        def _cb(data: dict) -> None:
            with self._lock:
                grp = self._groups.get(group or self._DEFAULT, {})
                s = grp.get("active", {}).get(descriptor)
                if not s:
                    return
                if s["start"] is None:
                    s["start"] = time.time()
                if data.get("prompt_tokens"):
                    s["pt"] = data["prompt_tokens"]
                if data.get("completion_tokens"):
                    s["ct"] += data["completion_tokens"]
                if data.get("ctx_pct") is not None:
                    s["ctx"] = data["ctx_pct"]

        return _cb

    def done(
        self,
        descriptor: str,
        label: str,
        elapsed: float,
        tokens_in: int = 0,
        tokens_out: int = 0,
        ctx_pct: int | None = None,
        *,
        failed: bool = False,
        group: str = "",
    ) -> None:
        """Mark a descriptor done and append a completed stats row."""
        from rich.text import Text as _RText
        status = "⚠ failed" if failed else "✓ complete"
        style = "yellow" if failed else "dim"
        row = _RText(
            f"  {label} {stats_str(elapsed, tokens_in, tokens_out, ctx_pct, status)}",
            style=style,
        )
        with self._lock:
            g = self._ensure_group(group or self._DEFAULT)
            g["active"].pop(descriptor, None)
            g["completed"].append(row)

    def _render(self):
        from rich.console import Group as _RGroup
        from rich.spinner import Spinner as _RSpinner
        from rich.text import Text as _RText
        with self._lock:
            groups_snap = {
                name: {"active": {d: dict(s) for d, s in g["active"].items()},
                       "completed": list(g["completed"])}
                for name, g in self._groups.items()
            }
        now = time.time()
        rows = []
        for name, g in groups_snap.items():
            # Group header (skip for unnamed default group)
            if name:
                total_done = len(g["completed"])
                total_active = len(g["active"])
                total = total_done + total_active
                if total_active == 0:
                    rows.append(_RText(f"▸ {name} ✓ complete ({total}/{total})", style="bold"))
                else:
                    rows.append(_RText(f"▸ {name} ({total_done}/{total})", style="bold"))
            # Completed rows
            rows.extend(g["completed"])
            # Active rows
            for desc, state in g["active"].items():
                if state["start"] is None:
                    rows.append(_RText(f"  {desc} (queued)", style="dim"))
                else:
                    elapsed = now - state["start"]
                    s = stats_str(elapsed, state["pt"], state["ct"], state["ctx"], "thinking")
                    rows.append(_RSpinner("dots", text=f"  {desc} {s}", style="dim"))
            # Blank line between groups (only for named groups)
            if name and rows:
                rows.append(_RText(""))
        if rows:
            return _RGroup(*rows)
        return _RSpinner("dots", text=f"  {self._header}", style="dim")

    def _run(self) -> None:
        while not self._stop.wait(0.25):
            if self._live is not None:
                try:
                    self._live.update(self._render())
                except Exception:
                    pass

    def __enter__(self) -> "_MultiSpinner":
        from rich.live import Live as _Live
        from rich.spinner import Spinner as _RSpinner
        self._live = _Live(
            _RSpinner("dots", text=f"  {self._header}", style="dim"),
            console=_con,
            refresh_per_second=10,
        )
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


def multi_spinner(header: str) -> _MultiSpinner:
    """Return a _MultiSpinner for concurrent agent display."""
    return _MultiSpinner(header)


_con = Console()
_err = Console(stderr=True)

# ANSI for streaming (bypasses Rich for token-by-token output)
_BLUE = "\033[38;5;117m"
_RESET = "\033[0m"


# --- System role ---

def header(title: str) -> None:
    """Command title line."""
    _con.print(f"[bold cyan]{title}[/bold cyan]")


def info(msg: str) -> None:
    """Informational system message."""
    _con.print(f"[dim]▸ {_esc(msg)}[/dim]")


def detail(msg: str) -> None:
    """Secondary detail (log path, target, etc.)."""
    _con.print(f"[dim]  {_esc(msg)}[/dim]")


def stage(msg: str) -> None:
    """Stage transition."""
    _con.print(f"\n[dim]▸ {_esc(msg)}[/dim]")


def progress(i: int, total: int, label: str, *, end: str = "\n") -> None:
    """Per-item progress line."""
    _con.print(f"[dim]  {i}/{total} {_esc(label)}[/dim]", end=end)


def success(msg: str) -> None:
    """Green success message."""
    _con.print(f"[green]  ✓ {_esc(msg)}[/green]")


def done(msg: str) -> None:
    """Final command success."""
    _con.print(f"\n\n[green]  ✓ {_esc(msg)}[/green]\n")


def warn(msg: str) -> None:
    """Yellow warning on stderr."""
    _err.print(f"[yellow]  ⚠ {_esc(msg)}[/yellow]")


def error(msg: str) -> None:
    """Red error on stderr."""
    _err.print(f"[red]  ✗ {_esc(msg)}[/red]")


def stats(parts: list[str]) -> None:
    """Dim stats line (tokens, elapsed, etc.)."""
    _con.print(f"\n[dim]  {' · '.join(_esc(p) for p in parts)}[/dim]")


def tool_start(name: str) -> None:
    """Tool call starting."""
    _con.print(f"\n[dim]  ⚙ {_esc(name)}()[/dim]")


def tool_done(result: str) -> None:
    """Tool call result."""
    _con.print(f"\n[dim green]  ✓ {_esc(result)}[/dim green]")


# --- Model role ---

def model_label(alias: str) -> None:
    """Model attribution line before response."""
    _con.print(f"\n[dim italic]  ◆ {alias}[/dim italic]\n")


def render_text(text: str):
    """Return a Rich renderable for a model response without printing it."""
    if _has_markdown(text):
        from rich.markdown import Markdown
        from rich.padding import Padding
        return Padding(Markdown(text), (1, 0, 0, 2))
    from rich.text import Text
    from rich.padding import Padding
    return Padding(Text("\n".join(f"  {line}" for line in text.splitlines())), (1, 0, 0, 0))


def model_text(text: str) -> None:
    """Print a complete model response (non-streaming)."""
    _con.print(render_text(text))


def _has_markdown(text: str) -> bool:
    """Quick check for common markdown formatting."""
    import re
    for p in (r'^#{1,6}\s', r'\*\*\w', r'```', r'^\|', r'^[-*+]\s', r'`\w',
              r'^\d+\.\s', r'^>\s', r'\[.+\]\('):
        if re.search(p, text, re.MULTILINE):
            return True
    return False


def model_token(token: str) -> None:
    """Stream a single model token (light blue, 2-space indent)."""
    sys.stdout.write(f"{_BLUE}{token}{_RESET}")
    sys.stdout.flush()


# --- Operator role ---

def operator_rule() -> None:
    """Horizontal rule before operator input."""
    _con.print()
    _con.rule(style="bright_black")


def operator_input(text: str) -> None:
    """Reprint operator input bold."""
    _con.print(f"[bold]{text}[/bold]")


# --- Streaming helper ---

def make_token_handler():
    """Create an on_token callback with indent and blank-line suppression.

    Returns:
        Callable that writes model tokens with 2-space indent, light blue,
        and suppresses consecutive blank lines.
    """
    at_line_start = True
    blank_lines = 0

    def _on_token(token: str) -> None:
        nonlocal at_line_start, blank_lines
        out = ""
        for ch in token:
            if ch == "\n":
                if at_line_start:
                    blank_lines += 1
                    if blank_lines > 1:
                        continue
                else:
                    blank_lines = 0
                at_line_start = True
                out += ch
            else:
                if at_line_start:
                    out += "  "
                    at_line_start = False
                    blank_lines = 0
                out += ch
        if out:
            sys.stdout.write(f"{_BLUE}{out}{_RESET}")
            sys.stdout.flush()

    return _on_token
