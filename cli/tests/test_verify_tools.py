"""Tests for Verify execution tools: ProcessManager, HTTPSessionManager, browser (REQ-VF-8–12)."""

from __future__ import annotations

import json
import time
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# ProcessManager tests
# ---------------------------------------------------------------------------


class TestProcessManager:
    def setup_method(self):
        """Clear the process registry before each test."""
        from voidrift_cli.tools.process_manager import _registry, _registry_lock
        with _registry_lock:
            _registry.clear()

    def test_start_process_returns_handle_id_and_pid(self):
        """start_process returns JSON with handle_id and pid (REQ-VF-8)."""
        from voidrift_cli.tools.process_manager import start_process, stop_process
        result = json.loads(start_process("sleep 10"))
        assert "handle_id" in result
        assert "pid" in result
        assert isinstance(result["pid"], int)
        stop_process(result["handle_id"])

    def test_start_process_registers_in_registry(self):
        """Started process is in the registry (REQ-VF-8)."""
        from voidrift_cli.tools.process_manager import start_process, stop_process, _registry
        result = json.loads(start_process("sleep 10"))
        assert result["handle_id"] in _registry
        stop_process(result["handle_id"])

    def test_stop_process_removes_from_registry(self):
        """stop_process removes handle from registry and terminates (REQ-VF-8)."""
        from voidrift_cli.tools.process_manager import start_process, stop_process, _registry
        result = json.loads(start_process("sleep 10"))
        handle_id = result["handle_id"]
        stop_process(handle_id)
        assert handle_id not in _registry

    def test_stop_unknown_handle_returns_error(self):
        """stop_process on nonexistent handle returns an error message."""
        from voidrift_cli.tools.process_manager import stop_process
        msg = stop_process("not-a-real-handle")
        assert "No process" in msg

    def test_read_process_output_captures_stdout(self):
        """read_process_output returns buffered output from the process (REQ-VF-11)."""
        from voidrift_cli.tools.process_manager import start_process, read_process_output, stop_process
        result = json.loads(start_process("echo hello-from-process"))
        handle_id = result["handle_id"]
        # Allow reader thread to capture output
        time.sleep(0.3)
        output = read_process_output(handle_id)
        assert "hello-from-process" in output
        stop_process(handle_id)

    def test_read_process_output_unknown_handle(self):
        """read_process_output on nonexistent handle returns error message."""
        from voidrift_cli.tools.process_manager import read_process_output
        result = read_process_output("bad-handle")
        assert "No process" in result

    def test_run_command_returns_stdout_stderr_exit_code(self):
        """run_command returns stdout, stderr, exit_code JSON (REQ-VF-11)."""
        from voidrift_cli.tools.process_manager import run_command
        result = json.loads(run_command("echo hello"))
        assert result["stdout"].strip() == "hello"
        assert result["exit_code"] == 0

    def test_run_command_captures_failure(self):
        """run_command captures nonzero exit codes (REQ-VF-11)."""
        from voidrift_cli.tools.process_manager import run_command
        result = json.loads(run_command("false"))
        assert result["exit_code"] != 0

    def test_run_command_not_found(self):
        """run_command returns error when executable not found."""
        from voidrift_cli.tools.process_manager import run_command
        result = json.loads(run_command("this-command-does-not-exist-xyz"))
        assert "error" in result
        assert result["exit_code"] == 127

    def test_stop_all_clears_registry(self):
        """stop_all() stops all tracked processes and empties the registry (REQ-VF-10)."""
        from voidrift_cli.tools.process_manager import start_process, stop_all, _registry
        start_process("sleep 10")
        start_process("sleep 10")
        assert len(_registry) == 2
        stop_all()
        assert len(_registry) == 0

    def test_wait_for_ready_port_strategy(self):
        """wait_for_ready with port strategy succeeds when port opens (REQ-VF-9)."""
        import socket
        from voidrift_cli.tools.process_manager import start_process, wait_for_ready, stop_process

        # Find a free port
        with socket.socket() as s:
            s.bind(("", 0))
            port = s.getsockname()[1]

        # Start a minimal server that opens the port
        handle = json.loads(start_process(f"python -c \"import socket,time; s=socket.socket(); s.bind(('',{port})); s.listen(1); time.sleep(5)\""))
        handle_id = handle["handle_id"]
        time.sleep(0.2)

        result = wait_for_ready(handle_id, strategy="port", target=str(port), timeout=5)
        assert result == "ready"
        stop_process(handle_id)

    def test_wait_for_ready_log_pattern_strategy(self):
        """wait_for_ready with log_pattern strategy succeeds when pattern appears (REQ-VF-9)."""
        from voidrift_cli.tools.process_manager import start_process, wait_for_ready, stop_process
        handle = json.loads(start_process("echo SERVER_STARTED_MARKER"))
        handle_id = handle["handle_id"]
        result = wait_for_ready(handle_id, strategy="log_pattern", target="SERVER_STARTED_MARKER", timeout=5)
        assert result == "ready"
        stop_process(handle_id)

    def test_wait_for_ready_timeout_stops_process(self):
        """wait_for_ready stops the process and removes from registry on timeout (REQ-VF-9)."""
        from voidrift_cli.tools.process_manager import start_process, wait_for_ready, _registry
        handle = json.loads(start_process("sleep 10"))
        handle_id = handle["handle_id"]
        result = wait_for_ready(handle_id, strategy="log_pattern", target="NEVER_APPEARS", timeout=1)
        assert "Timeout" in result
        assert handle_id not in _registry

    def test_wait_for_ready_unknown_strategy(self):
        """wait_for_ready returns error for unknown strategy."""
        from voidrift_cli.tools.process_manager import start_process, wait_for_ready, stop_process
        handle = json.loads(start_process("sleep 10"))
        handle_id = handle["handle_id"]
        result = wait_for_ready(handle_id, strategy="telepathy", target="anything", timeout=1)
        assert "Unknown strategy" in result
        stop_process(handle_id)

    def test_buffer_limits_to_500_lines(self):
        """Process output buffer holds at most 500 lines, newest on overflow (REQ-VF-11)."""
        from voidrift_cli.tools.process_manager import start_process, read_process_output, stop_process
        # Generate 600 lines
        cmd = "python -c \"import sys; [print(f'line {i}', flush=True) for i in range(600)]\""
        handle = json.loads(start_process(cmd))
        handle_id = handle["handle_id"]
        time.sleep(0.5)
        output = read_process_output(handle_id)
        lines = output.strip().split("\n")
        # Buffer is 500 max (deque maxlen=500)
        assert len(lines) <= 500
        stop_process(handle_id)


# ---------------------------------------------------------------------------
# HTTPSessionManager tests
# ---------------------------------------------------------------------------


class TestHTTPSessionManager:
    def setup_method(self):
        """Clear session state before each test."""
        from voidrift_cli.tools.http_client import _sessions, _sessions_lock
        with _sessions_lock:
            _sessions.clear()

    def test_get_request_returns_status_and_body(self, tmp_path, monkeypatch):
        """http_request returns status_code, headers, body (REQ-VF-12)."""
        from voidrift_cli.tools.http_client import http_request

        # Patch urllib opener to return a fake response
        fake_response = MagicMock()
        fake_response.__enter__ = lambda s: s
        fake_response.__exit__ = MagicMock(return_value=False)
        fake_response.status = 200
        fake_response.headers = {"Content-Type": "application/json"}
        fake_response.read.return_value = b'{"ok": true}'

        with patch("voidrift_cli.tools.http_client._Session") as MockSession:
            instance = MagicMock()
            instance._opener.open.return_value = fake_response
            MockSession.return_value = instance

            result = json.loads(http_request("GET", "http://example.com/api"))
            assert result["status_code"] == 200

    def test_auth_header_persists_across_calls(self):
        """Authorization header set in one call persists for subsequent calls in same session (REQ-VF-12)."""
        from voidrift_cli.tools.http_client import _get_session, http_request

        session = _get_session("auth-test")

        fake_response = MagicMock()
        fake_response.__enter__ = lambda s: s
        fake_response.__exit__ = MagicMock(return_value=False)
        fake_response.status = 200
        fake_response.headers = {}
        fake_response.read.return_value = b"{}"

        captured_headers = []

        def fake_open(req, timeout=None):
            captured_headers.append(dict(req.headers))
            return fake_response

        session._opener.open = fake_open

        # First call sets Authorization
        http_request("GET", "http://x.com/a", headers='{"Authorization": "Bearer token123"}', session_id="auth-test")
        assert session.auth_header == "Bearer token123"

        # Second call without Authorization header should inherit it
        http_request("GET", "http://x.com/b", session_id="auth-test")
        last_headers = captured_headers[-1]
        # Header keys may be title-cased by urllib
        auth_value = last_headers.get("Authorization") or last_headers.get("authorization")
        assert auth_value == "Bearer token123"

    def test_clear_sessions_empties_registry(self):
        """clear_sessions() discards all sessions (REQ-VF-12)."""
        from voidrift_cli.tools.http_client import _get_session, clear_sessions, _sessions
        _get_session("sess-1")
        _get_session("sess-2")
        assert len(_sessions) == 2
        clear_sessions()
        assert len(_sessions) == 0

    def test_multiple_sessions_are_isolated(self):
        """Two sessions have independent auth headers (REQ-VF-12)."""
        from voidrift_cli.tools.http_client import _get_session
        s1 = _get_session("user-a")
        s2 = _get_session("user-b")
        s1.auth_header = "Bearer tokenA"
        s2.auth_header = "Bearer tokenB"
        assert _get_session("user-a").auth_header == "Bearer tokenA"
        assert _get_session("user-b").auth_header == "Bearer tokenB"

    def test_invalid_headers_json_returns_error(self):
        """Invalid JSON in headers argument returns an error object."""
        from voidrift_cli.tools.http_client import http_request
        result = json.loads(http_request("GET", "http://x.com/", headers="not-json"))
        assert "error" in result


# ---------------------------------------------------------------------------
# Browser tools tests (unit — no real browser needed)
# ---------------------------------------------------------------------------


class TestBrowserTools:
    def setup_method(self):
        """Clear session state before each test."""
        from voidrift_cli.tools.browser import _sessions, _sessions_lock
        with _sessions_lock:
            _sessions.clear()

    def test_tools_return_error_when_playwright_missing(self, monkeypatch):
        """All browser tools return an informative error if playwright is not installed."""
        import voidrift_cli.tools.browser as browser_mod
        monkeypatch.setattr(browser_mod, "_playwright_available", lambda: False)

        for fn, kwargs in [
            (browser_mod.browser_navigate, {"url": "http://x.com"}),
            (browser_mod.browser_screenshot, {}),
            (browser_mod.browser_click, {"selector": "button"}),
            (browser_mod.browser_get_text, {}),
        ]:
            result = json.loads(fn(**kwargs))
            assert "error" in result
            assert "playwright" in result["error"].lower()

    def test_close_all_sessions_empties_registry(self, monkeypatch):
        """close_all_sessions() clears registry and calls close() on each session."""
        import voidrift_cli.tools.browser as browser_mod

        fake_session = MagicMock()
        with browser_mod._sessions_lock:
            browser_mod._sessions["test-session"] = fake_session

        browser_mod.close_all_sessions()
        assert len(browser_mod._sessions) == 0
        fake_session.close.assert_called_once()

    def test_close_session_removes_specific_session(self, monkeypatch):
        """close_session() removes only the named session."""
        import voidrift_cli.tools.browser as browser_mod

        s1 = MagicMock()
        s2 = MagicMock()
        with browser_mod._sessions_lock:
            browser_mod._sessions["s1"] = s1
            browser_mod._sessions["s2"] = s2

        browser_mod.close_session("s1")
        assert "s1" not in browser_mod._sessions
        assert "s2" in browser_mod._sessions
        s1.close.assert_called_once()
        s2.close.assert_not_called()

        # Cleanup
        with browser_mod._sessions_lock:
            browser_mod._sessions.clear()
