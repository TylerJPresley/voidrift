"""Consistent console output for all phases (REQ-UI-1, REQ-UI-2).

Three output roles:
  System (▸) — dim white: phase titles, stages, progress, logs
  Model  (◆) — light blue, 2-space indent: all model-generated text
  Operator (▶) — bold white: reprinted user input
"""

from __future__ import annotations

import sys

from rich.console import Console

_con = Console()
_err = Console(stderr=True)

# ANSI for streaming (bypasses Rich for token-by-token output)
_BLUE = "\033[38;5;117m"
_RESET = "\033[0m"


# --- System role ---

def phase(title: str) -> None:
    """Phase title line."""
    _con.print(f"[bold cyan]{title}[/bold cyan]")


def info(msg: str) -> None:
    """Informational system message."""
    _con.print(f"[dim]▸ {msg}[/dim]")


def detail(msg: str) -> None:
    """Secondary detail (log path, target, etc.)."""
    _con.print(f"[dim]  {msg}[/dim]")


def stage(msg: str) -> None:
    """Stage transition."""
    _con.print(f"\n[dim]▸ {msg}[/dim]")


def progress(i: int, total: int, label: str, *, end: str = "\n") -> None:
    """Per-item progress line."""
    _con.print(f"[dim]  {i}/{total} {label}[/dim]", end=end)


def success(msg: str) -> None:
    """Green success message."""
    _con.print(f"[green]  ✓ {msg}[/green]")


def done(msg: str) -> None:
    """Final phase success."""
    _con.print(f"\n[green]  ✓ {msg}[/green]\n")


def warn(msg: str) -> None:
    """Yellow warning on stderr."""
    _err.print(f"[yellow]  ⚠ {msg}[/yellow]")


def error(msg: str) -> None:
    """Red error on stderr."""
    _err.print(f"[red]  ✗ {msg}[/red]")


def stats(parts: list[str]) -> None:
    """Dim stats line (tokens, elapsed, etc.)."""
    _con.print(f"\n[dim]  {' · '.join(parts)}[/dim]")


def tool_start(name: str) -> None:
    """Tool call starting."""
    _con.print(f"\n[dim]  ⚙ {name}()[/dim]", end="")


def tool_done(result: str) -> None:
    """Tool call result."""
    _con.print(f"\n[dim green]  ✓ {result}[/dim green]")


# --- Model role ---

def model_label(alias: str) -> None:
    """Model attribution line before response."""
    _con.print(f"\n[dim italic]  ◆ {alias}[/dim italic]\n")


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
