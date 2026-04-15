"""HTTP session tool for Verify sub-agents (REQ-VF-12).

Provides http_request with per-session cookie and auth header persistence.
Sessions are keyed by session_id string and cleared by the orchestrator after
Stage 2 completes. Multiple named sessions per sub-agent are supported.
"""

from __future__ import annotations

import json
import threading
from http.cookiejar import CookieJar
from typing import Any
from urllib import request as _urllib_request
from urllib.error import HTTPError, URLError


# Module-level session registry: session_id -> _Session
_sessions: dict[str, "_Session"] = {}
_sessions_lock = threading.Lock()


class _Session:
    """Per-session state: cookie jar and persistent auth header."""

    def __init__(self) -> None:
        self.cookies: CookieJar = CookieJar()
        self.auth_header: str | None = None
        self._opener = _urllib_request.build_opener(
            _urllib_request.HTTPCookieProcessor(self.cookies)
        )


def _get_session(session_id: str) -> "_Session":
    with _sessions_lock:
        if session_id not in _sessions:
            _sessions[session_id] = _Session()
        return _sessions[session_id]


def http_request(
    method: str,
    url: str,
    headers: str = "{}",
    body: str = "",
    session_id: str = "default",
) -> str:
    """Make an HTTP request with session-scoped cookie and auth header persistence.

    Cookies set by responses are automatically sent on subsequent requests in the
    same session. If a previous response set an Authorization header it persists
    for the session unless overridden in this call.

    Args:
        method: HTTP method (GET, POST, PUT, PATCH, DELETE, etc.).
        url: Full URL including scheme and path.
        headers: JSON object of request headers. An "Authorization" header here
                 overrides and persists as the session auth header for future calls.
        body: Request body string. For JSON APIs send the JSON-encoded string here.
        session_id: Named session for cookie/auth persistence (default "default").

    Returns:
        JSON with status_code, headers (dict), and body fields, or an error object.
    """
    try:
        req_headers: dict[str, str] = json.loads(headers) if headers.strip() else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"Invalid headers JSON: {exc}"})

    # SSRF check (REQ-SEC-3)
    from .ssrf_guard import check_url, SSRFError
    from ..config import get_ssrf_allow_list
    try:
        check_url(url, allow_list=get_ssrf_allow_list())
    except SSRFError as e:
        return json.dumps({"error": str(e)})

    session = _get_session(session_id)

    # Persist auth header from this call or inherit from session
    if "Authorization" in req_headers:
        session.auth_header = req_headers["Authorization"]
    elif session.auth_header and "Authorization" not in req_headers:
        req_headers["Authorization"] = session.auth_header

    body_bytes = body.encode("utf-8") if body else None

    req = _urllib_request.Request(
        url,
        data=body_bytes,
        headers=req_headers,
        method=method.upper(),
    )

    try:
        with session._opener.open(req, timeout=30) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            resp_headers = dict(resp.headers)
            return json.dumps({
                "status_code": resp.status,
                "headers": resp_headers,
                "body": resp_body,
            })
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return json.dumps({
            "status_code": exc.code,
            "headers": dict(exc.headers),
            "body": error_body,
        })
    except URLError as exc:
        return json.dumps({"error": f"Request failed: {exc.reason}"})
    except OSError as exc:
        return json.dumps({"error": f"Request failed: {exc}"})


def clear_sessions() -> None:
    """Discard all sessions. Called by the orchestrator after Stage 2 completes."""
    with _sessions_lock:
        _sessions.clear()
