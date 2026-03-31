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
    """V-CFG-3: Framework commands exit with setup error when models.yml missing (REQ-CFG-8)."""

    def test_command_exits_when_models_yml_missing(self, tmp_path, monkeypatch):
        """gather exits with setup error when VOIDRIFT_HOME has no models.yml."""
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["gather", "claude", "."])
        assert result.exit_code != 0
        assert "make setup" in result.output

    def test_command_proceeds_when_models_yml_exists(self, tmp_path, monkeypatch):
        """No setup error raised when models.yml exists at VOIDRIFT_HOME."""
        (tmp_path / "models.yml").write_text("models: {}\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        # Will fail past the setup check (model not found), but not with setup error
        result = runner.invoke(cli, ["gather", "claude", "."])
        assert "make setup" not in result.output

    def test_utility_command_unaffected_by_missing_models_yml(self, tmp_path, monkeypatch):
        """status command runs without setup error even when models.yml is missing."""
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()

        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert "make setup" not in result.output


class TestActiveModelAlias:
    """V-ARCH-6: Interactive mode defaults to the active container's model alias."""

    def test_active_model_alias_returns_alias(self, tmp_project, monkeypatch):
        """_active_model_alias() returns the alias from .active-container."""
        from voidrift_cli.config import voidrift_home as get_home
        home = get_home()
        active_file = home / ".active-container"
        active_file.parent.mkdir(parents=True, exist_ok=True)
        active_file.write_text("container-123\ntest-local-model\n")

        from voidrift_cli.main import _active_model_alias
        alias = _active_model_alias()
        assert alias == "test-local-model"

    def test_active_model_alias_missing_file_returns_none(self, tmp_project):
        """_active_model_alias() returns None when .active-container doesn't exist."""
        from voidrift_cli.config import voidrift_home as get_home
        home = get_home()
        active_file = home / ".active-container"
        if active_file.exists():
            active_file.unlink()

        from voidrift_cli.main import _active_model_alias
        alias = _active_model_alias()
        assert alias is None

    def test_active_model_alias_single_line_file_returns_none(self, tmp_project):
        """_active_model_alias() returns None if file has only one line (no alias)."""
        from voidrift_cli.config import voidrift_home as get_home
        home = get_home()
        active_file = home / ".active-container"
        active_file.parent.mkdir(parents=True, exist_ok=True)
        active_file.write_text("container-only\n")

        from voidrift_cli.main import _active_model_alias
        alias = _active_model_alias()
        assert alias is None

    def test_interactive_mode_uses_active_model_as_default(self, tmp_project, monkeypatch):
        """When .active-container exists, _active_model_alias() provides the default."""
        from voidrift_cli.config import voidrift_home as get_home
        home = get_home()
        active_file = home / ".active-container"
        active_file.parent.mkdir(parents=True, exist_ok=True)
        active_file.write_text("c-abc123\nmy-active-model\n")

        from voidrift_cli.main import _active_model_alias
        alias = _active_model_alias()
        assert alias == "my-active-model"
