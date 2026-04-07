"""Tests for deploy command — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


class TestDeployPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 1

    def test_missing_architecture(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 1

    def test_no_history_exits_cleanly(self, tmp_project, cloud_model, sample_requirements):
        """No verified tasks since last release → nothing to deploy."""
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("# Architecture\n")
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0  # clean exit, nothing to do


class TestDeployPipeline:
    """Deploy pipeline stages: version bump, changelog, git tag, IaC (REQ-DPL-1..4)."""

    def _setup_deploy(self, tmp_project, sample_requirements, arch_text="# Architecture\nA simple CLI tool.\n"):
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text(arch_text)
        tasks_dir = vd / "tasks"
        tasks_dir.mkdir(parents=True, exist_ok=True)
        (tasks_dir / "history.log").write_text(
            "2026-04-01T10:00:00 TASK-1 verified module=backend\n"
            "2026-04-01T11:00:00 TASK-2 verified module=backend\n"
        )

    @patch("voidrift_cli.commands.deploy.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr=""))
    @patch("click.prompt", return_value="0.0.1")
    @patch("voidrift_cli.commands.deploy.AgentLoop")
    def test_version_bump_patch(self, MockAgent, mock_prompt, mock_subproc, tmp_project, cloud_model, sample_requirements):
        self._setup_deploy(tmp_project, sample_requirements)
        mock_instance = MagicMock()
        mock_instance.send.return_value = "patch"
        MockAgent.return_value = mock_instance
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0
        cl = (tmp_project / "CHANGELOG.md")
        assert cl.exists()
        assert "v0.0.1" in cl.read_text()

    @patch("voidrift_cli.commands.deploy.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr=""))
    @patch("click.prompt", return_value="0.1.0")
    @patch("voidrift_cli.commands.deploy.AgentLoop")
    def test_version_bump_minor(self, MockAgent, mock_prompt, mock_subproc, tmp_project, cloud_model, sample_requirements):
        self._setup_deploy(tmp_project, sample_requirements)
        mock_instance = MagicMock()
        mock_instance.send.return_value = "minor"
        MockAgent.return_value = mock_instance
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0
        assert "v0.1.0" in (tmp_project / "CHANGELOG.md").read_text()

    @patch("voidrift_cli.commands.deploy.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr=""))
    @patch("click.prompt", return_value="0.1.0")
    @patch("voidrift_cli.commands.deploy.AgentLoop")
    def test_version_bump_invalid_response_defaults_to_minor(self, MockAgent, mock_prompt, mock_subproc, tmp_project, cloud_model, sample_requirements):
        self._setup_deploy(tmp_project, sample_requirements)
        mock_instance = MagicMock()
        mock_instance.send.return_value = "something-invalid"
        MockAgent.return_value = mock_instance
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0

    @patch("voidrift_cli.commands.deploy.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr=""))
    @patch("click.prompt", return_value="0.0.1")
    @patch("voidrift_cli.commands.deploy.AgentLoop")
    def test_iac_stage_skipped_when_no_infra_keywords(self, MockAgent, mock_prompt, mock_subproc, tmp_project, cloud_model, sample_requirements):
        self._setup_deploy(tmp_project, sample_requirements, arch_text="# Architecture\n\nThis is a simple CLI tool.\n")
        mock_instance = MagicMock()
        mock_instance.send.return_value = "patch"
        MockAgent.return_value = mock_instance
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0
        # Only one AgentLoop instantiated (version classify), not two (no IaC)
        assert MockAgent.call_count == 1
        # No IaC files written
        assert not list(tmp_project.glob("*.tf"))
        assert not (tmp_project / "Dockerfile").exists()

    @patch("voidrift_cli.commands.deploy.subprocess.run", return_value=MagicMock(returncode=0, stdout="", stderr=""))
    @patch("click.prompt", return_value="0.0.1")
    @patch("voidrift_cli.commands.deploy.AgentLoop")
    def test_iac_stage_runs_when_infra_keywords_present(self, MockAgent, mock_prompt, mock_subproc, tmp_project, cloud_model, sample_requirements):
        self._setup_deploy(tmp_project, sample_requirements, arch_text="# Architecture\nDocker deployment on AWS infrastructure.\n")
        mock_instance = MagicMock()
        mock_instance.send.return_value = "patch"
        MockAgent.return_value = mock_instance
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0
        # Two AgentLoop instances: version classify + IaC agent
        assert MockAgent.call_count == 2

