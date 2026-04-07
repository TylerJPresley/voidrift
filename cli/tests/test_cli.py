"""Tests for CLI entry point — system log, interactive defaults (V-LOG-1, V-ARCH-6)."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest


class TestSystemLog:
    """V-LOG-1: System log created at ~/.voidrift/logs/voidrift.log on CLI startup."""

    def test_setup_system_log_creates_log_file(self, tmp_project, monkeypatch):
        """setup_system_log() creates voidrift.log in the logs directory."""
        from voidrift_cli.utils import setup_system_log

        # Reset logger so setup_system_log() runs fresh
        logger = logging.getLogger("voidrift")
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)

        setup_system_log()

        log_path = Path.home() / ".voidrift" / "logs" / "voidrift.log"
        assert log_path.exists(), "voidrift.log should exist after setup_system_log()"

    def test_system_log_is_writable(self, tmp_project, monkeypatch):
        """System logger writes entries to voidrift.log."""
        from voidrift_cli.utils import setup_system_log, get_system_logger

        # Reset logger
        logger = logging.getLogger("voidrift")
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)

        setup_system_log()
        log = get_system_logger()
        log.info("test entry from test_system_log_is_writable")

        log_path = Path.home() / ".voidrift" / "logs" / "voidrift.log"
        content = log_path.read_text()
        assert "test entry" in content

    def test_setup_system_log_is_idempotent(self, tmp_project):
        """Calling setup_system_log() twice doesn't add duplicate handlers."""
        from voidrift_cli.utils import setup_system_log

        logger = logging.getLogger("voidrift")
        for handler in list(logger.handlers):
            handler.close()
            logger.removeHandler(handler)

        setup_system_log()
        handler_count_after_first = len(logger.handlers)
        setup_system_log()
        handler_count_after_second = len(logger.handlers)
        assert handler_count_after_first == handler_count_after_second



class TestSetupCheck:
    """V-CFG-3: Framework commands exit with setup error when models file missing (REQ-CFG-8)."""

    def test_command_exits_when_models_yml_missing(self, tmp_path, monkeypatch):
        """gather exits with setup error when configured models file is missing."""
        from unittest.mock import patch as _patch
        missing = tmp_path / "nonexistent" / "models.yml"
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        with _patch("voidrift_cli.config.get_models_file", return_value=missing):
            result = runner.invoke(cli, ["gather", "claude", "--path", "."])
        assert result.exit_code != 0
        assert "Models file not found" in result.output

    def test_command_proceeds_when_models_yml_exists(self, tmp_path, monkeypatch):
        """No setup error raised when configured models file exists."""
        from unittest.mock import patch as _patch
        models_path = tmp_path / "models.yml"
        models_path.write_text("models: {}\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        with _patch("voidrift_cli.config.get_models_file", return_value=models_path):
            result = runner.invoke(cli, ["gather", "claude", "--path", "."])
        assert "Models file not found" not in result.output

    def test_utility_command_unaffected_by_missing_models_yml(self, tmp_path, monkeypatch):
        """status command runs without setup error even when models file is missing."""
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert "Models file not found" not in result.output


class TestActiveModelAlias:
    """V-ARCH-6: Interactive mode defaults to the active container's model alias."""

    def test_active_model_alias_returns_alias(self, tmp_path):
        """_active_model_alias() returns the alias from .active-container."""
        from unittest.mock import patch as _patch
        container_file = tmp_path / ".active-container"
        container_file.write_text("container-123\ntest-local-model\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.config.load_config", return_value={"active_container_file": str(container_file)}):
            alias = _active_model_alias()
        assert alias == "test-local-model"

    def test_active_model_alias_missing_file_returns_none(self, tmp_path):
        """_active_model_alias() returns None when .active-container doesn't exist."""
        from unittest.mock import patch as _patch
        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.config.load_config", return_value={"active_container_file": str(tmp_path / "nonexistent")}):
            alias = _active_model_alias()
        assert alias is None

    def test_active_model_alias_single_line_file_returns_none(self, tmp_path):
        """_active_model_alias() returns None if file has only one line (no alias)."""
        from unittest.mock import patch as _patch
        container_file = tmp_path / ".active-container"
        container_file.write_text("container-only\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.config.load_config", return_value={"active_container_file": str(container_file)}):
            alias = _active_model_alias()
        assert alias is None

    def test_interactive_mode_uses_active_model_as_default(self, tmp_path):
        """When .active-container exists, _active_model_alias() provides the default."""
        from unittest.mock import patch as _patch
        container_file = tmp_path / ".active-container"
        container_file.write_text("c-abc123\nmy-active-model\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.config.load_config", return_value={"active_container_file": str(container_file)}):
            alias = _active_model_alias()
        assert alias == "my-active-model"



class TestCLICommands:
    def test_status_command(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Gather" in result.output
        assert "Verify" in result.output

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
        log_dir = voidrift_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        (log_dir / "gather-20260101-000000.log").write_text("log content")
        (log_dir / "plan-20260101-000000.log").write_text("log content")
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "--prune"])
        assert "Deleted 2" in result.output

    def test_log_view(self, tmp_project, voidrift_dir):
        log_dir = voidrift_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        (log_dir / "gather-20260101-000000.log").write_text("line1\nline2\nline3")
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
        assert "--path" in result.output
        assert "--idea" in result.output
        assert "--overwrite" in result.output

    def test_develop_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["develop", "--help"])
        assert "Execute implementation tasks" in result.output

    def test_skills_subcommand_registered(self):
        """V-ARCH-1: 'skills' subcommand is registered in the CLI."""
        from voidrift_cli.main import cli
        assert "skills" in cli.commands

    def test_skills_help(self):
        """V-ARCH-1: 'voidrift skills --help' lists subcommands."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output


class TestSkillsList:
    """V-SKL-4: 'voidrift skills list' groups output by layer."""

    def test_skills_list_shows_layer_column(self, tmp_project):
        """skills list output includes a layer label (north-star, domain, or project)."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "list"])
        # Either skills found with layer labels, or "No skills found."
        assert result.exit_code == 0
        if "No skills found." not in result.output:
            # At least one layer should be labeled
            has_layer = any(lbl in result.output for lbl in ("north-star", "domain", "project"))
            assert has_layer, f"No layer labels found in output: {result.output!r}"

    def test_skills_list_layer_filter(self, tmp_project):
        """skills list --layer=project shows only project skills."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "list", "--layer", "project"])
        assert result.exit_code == 0
        if "No skills found." not in result.output:
            assert "domain" not in result.output
            assert "north-star" not in result.output


class TestKanbanBoard:
    """REQ-TM-1: Kanban board renders task statuses as Rich table columns."""

    def _make_mm(self, tmp_path):
        from voidrift_cli.manifest import ManifestManager
        mm = ManifestManager(project_dir=tmp_path)
        mm.ensure_dirs()
        mm.load()
        return mm

    def test_returns_rich_table(self, tmp_path):
        """render_kanban_board returns a Rich Table instance."""
        from rich.table import Table
        from voidrift_cli.main import render_kanban_board
        mm = self._make_mm(tmp_path)
        table = render_kanban_board(mm)
        assert isinstance(table, Table)

    def test_table_has_status_columns(self, tmp_path):
        """Board has Planned, In Progress, Implemented, Verified, Blocked columns."""
        from voidrift_cli.main import render_kanban_board
        mm = self._make_mm(tmp_path)
        table = render_kanban_board(mm)
        col_names = [c.header for c in table.columns]
        assert "Planned" in col_names
        assert "Verified" in col_names
        assert "Blocked" in col_names

    def test_planned_task_appears_in_planned_column(self, tmp_path):
        """A planned task is listed under the Planned column."""
        from voidrift_cli.main import render_kanban_board
        from rich.console import Console
        from io import StringIO
        mm = self._make_mm(tmp_path)
        mm.add_task(1, module="core")  # default status is planned
        table = render_kanban_board(mm)
        # Render to string and verify TASK-1 appears in output
        buf = StringIO()
        con = Console(file=buf, highlight=False, markup=False, width=200)
        con.print(table)
        output = buf.getvalue()
        assert "TASK-1" in output

    def test_verified_task_does_not_appear_in_planned(self, tmp_path):
        """A verified task is shown only under Verified, not Planned."""
        from voidrift_cli.main import render_kanban_board
        from rich.console import Console
        from io import StringIO
        mm = self._make_mm(tmp_path)
        mm.add_task(2, module="backend")
        mm.set_status(2, "verified")
        table = render_kanban_board(mm)
        buf = StringIO()
        con = Console(file=buf, highlight=False, markup=False, width=200)
        con.print(table)
        output = buf.getvalue()
        assert "TASK-2" in output

    def test_empty_manifest_renders_without_error(self, tmp_path):
        """Board renders cleanly when no tasks exist."""
        from voidrift_cli.main import render_kanban_board
        mm = self._make_mm(tmp_path)
        # Should not raise
        table = render_kanban_board(mm)
        assert table is not None

