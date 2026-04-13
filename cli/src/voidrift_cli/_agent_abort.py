"""Abort mechanism — signal-based loop stop and active loop registry (REQ-D-13, REQ-ARCH-14)."""

from __future__ import annotations

import threading
import time


_abort_requested = False
_active_loops: dict[int, object] = {}
_active_loops_lock = threading.Lock()


class AbortRequested(Exception):
    """Raised when operator abort interrupts a blocking operation."""


def request_abort() -> None:
    """Set the abort flag and close HTTP clients on all active loops (REQ-D-13)."""
    global _abort_requested
    _abort_requested = True
    with _active_loops_lock:
        for loop in _active_loops.values():
            client = getattr(loop, "_active_client", None)
            if client is not None:
                try:
                    client.close()
                except Exception:
                    pass


def clear_abort() -> None:
    """Reset the abort flag — called at command start."""
    global _abort_requested
    _abort_requested = False


def is_abort_requested() -> bool:
    """Check the abort flag without side effects."""
    return _abort_requested


def register_loop(loop: object) -> None:
    """Register an active AgentLoop for abort handling."""
    with _active_loops_lock:
        _active_loops[id(loop)] = loop


def unregister_loop(loop: object) -> None:
    """Unregister an AgentLoop after send() completes."""
    with _active_loops_lock:
        _active_loops.pop(id(loop), None)


def abort_aware_sleep(seconds: float) -> None:
    """Sleep in 0.25s increments, raising AbortRequested if abort flag is set (REQ-D-13)."""
    remaining = seconds
    while remaining > 0:
        if _abort_requested:
            raise AbortRequested("Operator abort during retry sleep")
        time.sleep(min(0.25, remaining))
        remaining -= 0.25
