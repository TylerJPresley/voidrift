"""Tests for verify command — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


class TestVerifyPreflight:
    """REQ-VF-P: Verify exits early when REQUIREMENTS.md is missing."""

    def test_missing_requirements_exits_with_error(self, tmp_project, cloud_model, capsys):
        """No REQUIREMENTS.md → exit 1 with 'voidrift gather' message (REQ-VF-P)."""
        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1

    def test_missing_requirements_no_model_call(self, tmp_project, cloud_model):
        """No REQUIREMENTS.md → no AgentLoop instantiation (REQ-VF-P)."""
        with patch("voidrift_cli.commands._verify_pipeline.AgentLoop") as MockAgent:
            from voidrift_cli.commands.verify import run_verify
            run_verify(cloud_model)
            MockAgent.assert_not_called()


class TestVerifyPlanParsing:
    """_parse_verify_plan correctly splits VERIFY-PLAN.md into item dicts."""

    def test_parses_testable_items(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        text = (
            "# Verify Plan\n\n---\n\n"
            "### ITEM-1\n\nTest case one.\n\n---\n\n"
            "### ITEM-2\n\nTest case two.\n"
        )
        items = _parse_verify_plan(text)
        assert len(items) == 2
        assert items[0]["item_id"] == "ITEM-1"
        assert items[0]["skip"] is False
        assert "Test case one" in items[0]["content"]

    def test_parses_skip_items(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        text = (
            "### ITEM-1\n\nNormal test.\n\n"
            "### ITEM-2 [SKIP]\n\nReason: qualitative.\n"
        )
        items = _parse_verify_plan(text)
        assert items[0]["skip"] is False
        assert items[1]["skip"] is True
        assert items[1]["item_id"] == "ITEM-2"

    def test_empty_plan_returns_empty(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        assert _parse_verify_plan("# Verify Plan\n\nNo items here.") == []


class TestVerifyOrchestrator:
    """Full orchestrator flow with mocked AgentLoop."""

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands._verify_pipeline.AgentLoop")
    def test_pass_when_no_bug_reports(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """All items pass (no bug reports written) → VERIFY.md verdict PASS, exit 0 (REQ-VF-5)."""
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                # Plan agent writes VERIFY-PLAN.md (call 1 is doc verify)
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest REQ-X.\n\n"
                    "### ITEM-2 [SKIP]\n\nReason: qualitative.\n"
                )
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 0
        assert (vd / "VERIFY.md").exists()
        content = (vd / "VERIFY.md").read_text()
        assert "PASS" in content

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands._verify_pipeline.AgentLoop")
    def test_fail_when_bug_report_written(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """Sub-agent writes bug report → VERIFY.md verdict FAIL, exit 1 (REQ-VF-4, REQ-VF-5)."""
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest REQ-Y.\n"
                )
            elif call_count > 2:
                # Sub-agent writes a bug report
                (vd / "bugs").mkdir(exist_ok=True)
                (vd / "bugs" / "ITEM-1.md").write_text("# Bug Report — ITEM-1\n\nFAIL")
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 1
        content = (vd / "VERIFY.md").read_text()
        assert "FAIL" in content
        assert "bugs/ITEM-1.md" in content

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands._verify_pipeline.AgentLoop")
    def test_stop_all_called_on_exception(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """stop_all() is called even when plan agent raises (REQ-VF-10)."""
        mock_instance = MagicMock()
        mock_instance.send.side_effect = RuntimeError("model exploded")
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 1
        mock_stop_all.assert_called()

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands._verify_pipeline.AgentLoop")
    def test_state_md_written_after_run(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """STATE.md is appended after verify completes (REQ-VF-6)."""
        vd = tmp_project / ".voidrift"

        def fake_send(msg):
            if not (vd / "VERIFY-PLAN.md").exists():
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest.\n"
                )
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        run_verify(cloud_model)

        state = vd / "STATE.md"
        assert state.exists()
        assert "verify" in state.read_text()

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands._verify_pipeline.AgentLoop")
    def test_no_source_file_tools_in_execute(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """verify-execute tool set excludes read_source_file and write_source_file (REQ-VF-7, REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-execute")
        names = {t["function"]["name"] for t in tools}
        assert "write_source_file" not in names
        assert "read_source_file" not in names

    def test_verify_plan_tool_set_includes_source_read(self, tmp_project):
        """verify-plan tool set includes read_source_file (REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-plan")
        names = {t["function"]["name"] for t in tools}
        assert "read_source_file" in names
        assert "write_source_file" not in names

    def test_verify_execute_includes_http_and_run_command(self, tmp_project):
        """verify-execute tool set includes http_request and run_command (REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-execute")
        names = {t["function"]["name"] for t in tools}
        assert "http_request" in names
        assert "run_command" in names
        assert "read_process_output" in names



class TestReadArchField:
    """Tests for _read_arch_field quote stripping."""

    def test_strips_double_quotes(self, tmp_project):
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        (d / "ARCHITECTURE.md").write_text('startup_command: "uvicorn main:app --port 8000"\n')
        from voidrift_cli.commands.verify import _read_arch_field
        assert _read_arch_field(d, "startup_command") == "uvicorn main:app --port 8000"

    def test_strips_single_quotes(self, tmp_project):
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        (d / "ARCHITECTURE.md").write_text("startup_command: 'uvicorn main:app'\n")
        from voidrift_cli.commands.verify import _read_arch_field
        assert _read_arch_field(d, "startup_command") == "uvicorn main:app"

    def test_empty_quoted_string_returns_empty(self, tmp_project):
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        (d / "ARCHITECTURE.md").write_text('test_bootstrap: ""\n')
        from voidrift_cli.commands.verify import _read_arch_field
        assert _read_arch_field(d, "test_bootstrap") == ""

    def test_unquoted_value_unchanged(self, tmp_project):
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        (d / "ARCHITECTURE.md").write_text("startup_command: uvicorn main:app\n")
        from voidrift_cli.commands.verify import _read_arch_field
        assert _read_arch_field(d, "startup_command") == "uvicorn main:app"


class TestDocVerification:
    """Tests for REQ-VF-17: documentation verification stage."""

    def test_write_verify_md_includes_doc_bugs(self, tmp_project):
        """VERIFY.md includes documentation section when doc bugs exist."""
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        from voidrift_cli.commands.verify import _write_verify_md
        verdict = _write_verify_md(d, [], "test-run", doc_bug_count=2)
        content = (d / "VERIFY.md").read_text()
        assert "Documentation" in content
        assert "2 documentation mismatch" in content
        assert verdict == "FAIL"

    def test_write_verify_md_no_doc_bugs(self, tmp_project):
        """VERIFY.md omits documentation section when no doc bugs."""
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        from voidrift_cli.commands.verify import _write_verify_md
        verdict = _write_verify_md(d, [], "test-run", doc_bug_count=0)
        content = (d / "VERIFY.md").read_text()
        assert "Documentation" not in content
        assert verdict == "PASS"

    def test_doc_bugs_cause_fail_verdict(self, tmp_project):
        """Doc bugs cause FAIL even if all test items pass."""
        d = Path.cwd() / ".voidrift"
        d.mkdir(exist_ok=True)
        from voidrift_cli.commands.verify import _write_verify_md
        results = [{"item_id": "ITEM-1", "status": "pass", "bug_report_path": None}]
        verdict = _write_verify_md(d, results, "test-run", doc_bug_count=1)
        assert verdict == "FAIL"
