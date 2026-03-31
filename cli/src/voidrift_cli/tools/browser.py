"""Browser automation tools for Verify sub-agents.

Uses Playwright (Python) for browser control. Playwright is a soft dependency —
if not installed, each tool returns an informative error rather than crashing.
Browser sessions are scoped by session_id and cleaned up by the orchestrator.

Install Playwright: pip install playwright && playwright install chromium
"""

from __future__ import annotations

import base64
import json
import threading
from pathlib import Path


# Module-level browser session registry: session_id -> _BrowserSession
_sessions: dict[str, "_BrowserSession"] = {}
_sessions_lock = threading.Lock()


def _playwright_available() -> bool:
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        return False


class _BrowserSession:
    """Wraps a Playwright browser context for one sub-agent session."""

    def __init__(self) -> None:
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._context = self._browser.new_context()
        self._page = self._context.new_page()

    def close(self) -> None:
        try:
            self._context.close()
            self._browser.close()
            self._pw.stop()
        except Exception:
            pass

    @property
    def page(self):
        return self._page


def _get_session(session_id: str) -> "_BrowserSession":
    with _sessions_lock:
        if session_id not in _sessions:
            _sessions[session_id] = _BrowserSession()
        return _sessions[session_id]


def _no_playwright() -> str:
    return json.dumps({
        "error": (
            "Playwright is not installed. "
            "Run: pip install playwright && playwright install chromium"
        )
    })


def browser_navigate(url: str, session_id: str = "default") -> str:
    """Navigate the browser to a URL.

    Args:
        url: The URL to navigate to.
        session_id: Browser session ID (default "default").

    Returns:
        JSON with status and final_url, or error.
    """
    if not _playwright_available():
        return _no_playwright()
    try:
        session = _get_session(session_id)
        response = session.page.goto(url, wait_until="networkidle", timeout=30000)
        return json.dumps({
            "status": response.status if response else None,
            "final_url": session.page.url,
        })
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def browser_screenshot(
    session_id: str = "default",
    save_path: str = "",
) -> str:
    """Take a screenshot of the current page.

    Args:
        session_id: Browser session ID.
        save_path: Optional path relative to .voidrift/ to save the PNG.
                   If omitted, returns the image as a base64-encoded string.

    Returns:
        JSON with base64_png or saved_path field, or error.
    """
    if not _playwright_available():
        return _no_playwright()
    try:
        from ..utils import voidrift_dir

        session = _get_session(session_id)
        png_bytes = session.page.screenshot(full_page=True)

        if save_path:
            dest = voidrift_dir() / save_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(png_bytes)
            return json.dumps({"saved_path": str(dest)})

        return json.dumps({"base64_png": base64.b64encode(png_bytes).decode("ascii")})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def browser_click(selector: str, session_id: str = "default") -> str:
    """Click an element on the current page.

    Args:
        selector: CSS selector or text selector (e.g. "button.submit" or "text=Login").
        session_id: Browser session ID.

    Returns:
        JSON with "ok": true, or error.
    """
    if not _playwright_available():
        return _no_playwright()
    try:
        session = _get_session(session_id)
        session.page.click(selector, timeout=10000)
        return json.dumps({"ok": True})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def browser_get_text(selector: str = "body", session_id: str = "default") -> str:
    """Get the visible text content of an element (default: full page body).

    Args:
        selector: CSS selector of the element to read (default "body").
        session_id: Browser session ID.

    Returns:
        JSON with text field, or error.
    """
    if not _playwright_available():
        return _no_playwright()
    try:
        session = _get_session(session_id)
        text = session.page.inner_text(selector, timeout=10000)
        return json.dumps({"text": text})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def close_session(session_id: str) -> None:
    """Close and remove a browser session."""
    with _sessions_lock:
        session = _sessions.pop(session_id, None)
    if session is not None:
        session.close()


def close_all_sessions() -> None:
    """Close all browser sessions. Called by the orchestrator after Stage 2."""
    with _sessions_lock:
        sessions = list(_sessions.items())
        _sessions.clear()
    for _, session in sessions:
        session.close()
