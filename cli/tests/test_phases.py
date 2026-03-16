"""Tests for phase commands — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


@pytest.fixture
def mock_model_ready():
    """Patch ensure_model_ready and cleanup_model to be no-ops."""
    # Import the modules first so patch targets resolve
    import voidrift_cli.phases.gather
    import voidrift_cli.phases.plan
    import voidrift_cli.phases.develop
    import voidrift_cli.phases.automate
    import voidrift_cli.phases.verify
    with patch("voidrift_cli.phases.gather.ensure_model_ready"), \
         patch("voidrift_cli.phases.gather.cleanup_model"), \
         patch("voidrift_cli.phases.plan.ensure_model_ready"), \
         patch("voidrift_cli.phases.plan.cleanup_model"), \
         patch("voidrift_cli.phases.develop.ensure_model_ready"), \
         patch("voidrift_cli.phases.develop.cleanup_model"), \
         patch("voidrift_cli.phases.automate.ensure_model_ready"), \
         patch("voidrift_cli.phases.automate.cleanup_model"), \
         patch("voidrift_cli.phases.verify.ensure_model_ready"), \
         patch("voidrift_cli.phases.verify.cleanup_model"):
        yield


# ── Gather ──────────────────────────────────────────────────────────────


class TestGatherPreflightChecks:
    def test_feature_without_requirements(self, tmp_project, cloud_model, mock_model_ready):
        from voidrift_cli.phases.gather import run_gather
        result = run_gather(cloud_model, feature="auth")
        assert result == 1

    def test_feature_with_requirements(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        from voidrift_cli.phases.gather import run_gather
        # This will try to start interactive mode — we just verify it gets past preflight
        with patch("voidrift_cli.phases.gather.AgentLoop") as MockAgent:
            with patch("builtins.input", side_effect=EOFError):
                result = run_gather(cloud_model, feature="auth")
        assert result == 0  # Exited cleanly via EOFError
        # Verify spec dir was created
        assert (tmp_project / ".voidrift" / "spec").is_dir()

    def test_from_nonexistent_dir(self, tmp_project, cloud_model, mock_model_ready):
        from voidrift_cli.phases.gather import run_gather
        result = run_gather(cloud_model, from_path="/nonexistent/path")
        assert result == 1

    def test_from_existing_target_no_force(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        from voidrift_cli.phases.gather import run_gather
        result = run_gather(cloud_model, from_path=str(tmp_project), force=False)
        assert result == 1  # Target exists, no --force


# ── Plan ────────────────────────────────────────────────────────────────


class TestPlanPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model, mock_model_ready):
        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_produces_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        """Simulate a model that creates the required artifacts via tool calls."""
        vd = tmp_project / ".voidrift"

        # When agent.send() is called, create the artifacts the plan phase expects
        def fake_send(msg):
            (vd / "ARCHITECTURE.md").write_text("# Architecture\n\n## Overview\nTest arch")
            (vd / "TASKS.md").write_text("- [ ] Create src/main.py: entry point [backend]\n")
            return "Plan complete."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "TASKS.md").exists()

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_retries_on_missing_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call: only create ARCHITECTURE.md (missing TASKS.md)
                (vd / "ARCHITECTURE.md").write_text("# Arch")
                return "Partial."
            else:
                # Retry: create TASKS.md too
                (vd / "TASKS.md").write_text("- [ ] Task [backend]\n")
                return "Fixed."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert call_count == 2

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_fails_after_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I didn't create anything."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    def test_fresh_start_clears_artifacts(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("old arch")
        (vd / "TASKS.md").write_text("old tasks")
        (vd / "spec").mkdir(exist_ok=True)
        (vd / "spec" / "auth.md").write_text("old spec")

        with patch("voidrift_cli.phases.plan.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "nothing"
            MockAgent.return_value = mock_instance

            from voidrift_cli.phases.plan import run_plan
            run_plan(cloud_model, fresh_start=True)

        assert not (vd / "ARCHITECTURE.md").exists()
        assert not (vd / "TASKS.md").exists()
        assert not (vd / "spec" / "auth.md").exists()


# ── Develop ─────────────────────────────────────────────────────────────


class TestDevelopPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model, mock_model_ready):
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_missing_tasks(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_all_tasks_complete(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [x] Done 1\n- [x] Done 2\n")
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0

    def test_workers_without_modules(self, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Task [backend]\n")
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model, workers=2)
        # Falls back to single worker, doesn't error
        assert result in (0, 1)

    def test_lock_file_stale(self, tmp_project, cloud_model, sample_requirements, sample_tasks, mock_model_ready):
        """Stale lock (dead PID) should be cleaned up."""
        lock = tmp_project / ".voidrift" / ".develop.lock"
        lock.write_text("99999999\n2020-01-01T00:00:00")  # Dead PID

        with patch("voidrift_cli.phases.develop.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "done"
            MockAgent.return_value = mock_instance

            from voidrift_cli.phases.develop import run_develop
            # Will proceed past lock check (stale PID), then try to run tasks
            result = run_develop(cloud_model)

        # Lock should be cleaned up
        assert not lock.exists()

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_develop_loop_marks_tasks(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Create src/main.py: entry [backend]\n")

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Created the file."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0
        assert "[x]" in (vd / "TASKS.md").read_text()

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_sequential_multi_module(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text(
            "## Module: backend\n- [ ] Task A [backend]\n"
            "## Module: frontend\n- [ ] Task B [frontend]\n"
        )

        mock_instance = MagicMock()
        mock_instance.send.return_value = "done"
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0
        # Both modules should be marked complete in single file
        text = (vd / "TASKS.md").read_text()
        assert text.count("[x]") == 2


# ── Automate ────────────────────────────────────────────────────────────


class TestAutomatePreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model, mock_model_ready):
        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_generate_mode(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        def fake_send(msg):
            # Simulate creating a compose file
            (tmp_project / "docker-compose.yml").write_text("version: '3'\nservices:\n  app:\n    build: .")
            return "Generated IaC."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 0

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_generate_fails_no_iac(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I described the infrastructure but didn't create files."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_review_mode(self, MockAgent, tmp_project, cloud_model, sample_requirements, mock_model_ready):
        # Pre-existing IaC
        (tmp_project / "docker-compose.yml").write_text("version: '3'")

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Reviewed and reconciled."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 0


# ── Verify ──────────────────────────────────────────────────────────────


class TestVerify:
    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_pass_verdict(self, MockAgent, mock_checks, tmp_project, cloud_model, mock_model_ready):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("All tests passed", 0)

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nPASS\nAll good.")
            return "Report written."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 0

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_fail_no_architect(self, MockAgent, mock_checks, tmp_project, cloud_model, mock_model_ready):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Tests failed", 2)

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nFAIL\nThings broke.")
            return "Report written."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_fail_with_architect_generates_fixes(self, MockAgent, mock_checks, tmp_project, cloud_model, mock_model_ready):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Tests failed", 1)
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Worker writes VERIFY.md
                (vd / "VERIFY.md").write_text("## Verdict\nFAIL\nBroken.")
                return "Report."
            elif call_count == 2:
                # Architect writes remediation plan
                (vd / "ARCHITECT_VERIFY.md").write_text("Fix task 1: do X")
                return "Fix plan."
            else:
                # Worker writes fix tasks
                (vd / "TASKS-fixes.md").write_text("- [ ] Fix X [backend]\n")
                (vd / "ARCHITECT_VERIFY.md").unlink(missing_ok=True)
                return "Fix tasks created."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        architect = ModelConfig(alias="arch", model_id="test", model_type="cloud",
                                api_base="http://localhost:19999/v1", api_key="k")

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model, architect=architect)
        assert result == 1  # Still fails, but fix tasks generated
        assert (vd / "TASKS-fixes.md").exists()

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_pass_requires_zero_failed_checks(self, MockAgent, mock_checks, tmp_project, cloud_model, mock_model_ready):
        """Even if model says PASS, failed_checks > 0 means FAIL (AC-V6)."""
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Some output", 1)  # 1 failed check

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nPASS\nLooks fine to me.")
            return "Report."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1  # FAIL because failed_checks > 0


# ── CLI Commands ────────────────────────────────────────────────────────


class TestCLICommands:
    def test_status_command(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Phase 1" in result.output
        assert "Phase 5" in result.output

    def test_status_with_requirements(self, tmp_project, sample_requirements):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert "✅" in result.output

    def test_unlock_no_lock(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["unlock"])
        assert result.exit_code == 0
        assert "No lock file" in result.output

    def test_log_no_files(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "gather"])
        assert result.exit_code == 1

    def test_log_prune(self, tmp_project, voidrift_dir):
        (voidrift_dir / "gather-20260101-000000.log").write_text("log content")
        (voidrift_dir / "plan-20260101-000000.log").write_text("log content")
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "--prune"])
        assert "Deleted 2" in result.output

    def test_log_view(self, tmp_project, voidrift_dir):
        (voidrift_dir / "gather-20260101-000000.log").write_text("line1\nline2\nline3")
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "gather"])
        assert result.exit_code == 0
        assert "line1" in result.output

    def test_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "gather" in result.output
        assert "develop" in result.output

    def test_gather_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["gather", "--help"])
        assert "--from" in result.output
        assert "--reference" in result.output
        assert "--force" in result.output

    def test_develop_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["develop", "--help"])
        assert "--workers" in result.output
