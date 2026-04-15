"""Tests for chat slash command harness and handlers (REQ-U-2b)."""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

import pytest

from voidrift_cli.commands._chat_commands import wrap_command


class _FakeState:
    """Minimal state mock for wrap_command tests."""
    def __init__(self):
        self.busy = False
        self.mode = "/chat"
        self.messages = []
    def add_system(self, msg):
        self.messages.append(msg)
    def _refresh(self):
        pass


class TestWrapCommand:
    def test_sets_busy_and_mode(self):
        state = _FakeState()
        done = threading.Event()

        def handle_test(args, mc, state, prompt_fn, log):
            assert state.busy is True
            assert state.mode == "/test"
            done.set()

        wrap_command(handle_test, "", None, state, None, None)
        done.wait(timeout=2)
        # After completion, busy is reset
        time.sleep(0.1)
        assert state.busy is False
        assert state.mode == "/chat"

    def test_catches_exception(self):
        state = _FakeState()
        done = threading.Event()

        def handle_boom(args, mc, state, prompt_fn, log):
            done.set()
            raise RuntimeError("kaboom")

        wrap_command(handle_boom, "", None, state, None, None)
        done.wait(timeout=2)
        time.sleep(0.1)
        assert state.busy is False
        assert any("kaboom" in m for m in state.messages)

    def test_mode_derived_from_function_name(self):
        state = _FakeState()
        done = threading.Event()

        def handle_gather(args, mc, state, prompt_fn, log):
            assert state.mode == "/gather"
            done.set()

        wrap_command(handle_gather, "", None, state, None, None)
        done.wait(timeout=2)

    def test_resets_mode_on_error(self):
        state = _FakeState()
        done = threading.Event()

        def handle_plan(args, mc, state, prompt_fn, log):
            done.set()
            raise ValueError("bad plan")

        wrap_command(handle_plan, "", None, state, None, None)
        done.wait(timeout=2)
        time.sleep(0.1)
        assert state.mode == "/chat"


class TestHandleGatherValidation:
    def test_invalid_path_shows_error(self):
        from voidrift_cli.commands._chat_commands import handle_gather
        state = _FakeState()
        handle_gather("/nonexistent/path", None, state, None, None)
        assert any("not a directory" in m for m in state.messages)

    def test_default_path_uses_cwd(self, tmp_path, monkeypatch):
        """Empty args defaults to cwd — validates it's a directory (passes)."""
        from voidrift_cli.commands._chat_commands import handle_gather
        monkeypatch.chdir(tmp_path)
        state = _FakeState()
        # Will fail at _build_file_tree (no files) or triage, but path validation passes
        try:
            handle_gather("", MagicMock(), state, lambda f, c: "skip", None)
        except Exception:
            pass
        # Should NOT have "not a directory" error
        assert not any("not a directory" in m for m in state.messages)


class TestHandlePlanValidation:
    def test_missing_requirements_shows_error(self, tmp_path, monkeypatch):
        from voidrift_cli.commands._chat_commands import handle_plan
        monkeypatch.chdir(tmp_path)
        # No .voidrift/REQUIREMENTS.md
        state = _FakeState()
        handle_plan("", None, state, lambda f, c: "skip", None)
        assert any("REQUIREMENTS.md not found" in m for m in state.messages)

    def test_overwrite_prompt_called_when_artifacts_exist(self, tmp_path, monkeypatch):
        from voidrift_cli.commands._chat_commands import handle_plan
        monkeypatch.chdir(tmp_path)
        d = tmp_path / ".voidrift"
        d.mkdir()
        (d / "REQUIREMENTS.md").write_text("# Reqs\n")
        (d / "ARCHITECTURE.md").write_text("# Arch\n")
        (d / "tasks").mkdir()
        (d / "tasks" / "manifest.yml").write_text("tasks: []\n")

        calls = []
        def _prompt(name, choices):
            calls.append(name)
            return "update"

        state = _FakeState()
        # Will fail at Stage 1 (no model), but prompt should fire first
        try:
            handle_plan("", MagicMock(), state, _prompt, None)
        except Exception:
            pass
        assert "plan_overwrite" in calls

    def test_fresh_plan_skips_overwrite_prompt(self, tmp_path, monkeypatch):
        from voidrift_cli.commands._chat_commands import handle_plan
        monkeypatch.chdir(tmp_path)
        d = tmp_path / ".voidrift"
        d.mkdir()
        (d / "REQUIREMENTS.md").write_text("# Reqs\n")

        calls = []
        def _prompt(name, choices):
            calls.append(name)
            return "skip"

        state = _FakeState()
        try:
            handle_plan("", MagicMock(), state, _prompt, None)
        except Exception:
            pass
        # No overwrite prompt for fresh plan
        assert "plan_overwrite" not in calls


class TestHandleVerifyValidation:
    def test_missing_requirements_shows_error(self, tmp_path, monkeypatch):
        from voidrift_cli.commands._chat_commands import handle_verify
        monkeypatch.chdir(tmp_path)
        state = _FakeState()
        handle_verify("", None, state, None, None)
        assert any("REQUIREMENTS.md not found" in m for m in state.messages)

    def test_cleanup_called_on_success(self, tmp_path, monkeypatch):
        """finally block calls stop_all, clear_sessions, close_all_sessions."""
        from voidrift_cli.commands._chat_commands import handle_verify
        from unittest.mock import patch
        monkeypatch.chdir(tmp_path)
        d = tmp_path / ".voidrift"
        d.mkdir()
        (d / "REQUIREMENTS.md").write_text("# Reqs\n")

        state = _FakeState()
        cleanup_calls = []
        with patch("voidrift_cli.tools.process_manager.stop_all", lambda: cleanup_calls.append("stop")), \
             patch("voidrift_cli.tools.http_client.clear_sessions", lambda: cleanup_calls.append("clear")), \
             patch("voidrift_cli.tools.browser.close_all_sessions", lambda: cleanup_calls.append("close")):
            try:
                handle_verify("", MagicMock(), state, None, None)
            except Exception:
                pass
        assert "stop" in cleanup_calls
        assert "clear" in cleanup_calls
        assert "close" in cleanup_calls
