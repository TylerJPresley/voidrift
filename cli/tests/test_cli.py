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
        worker_home = tmp_path / ".worker-cli"
        worker_home.mkdir()
        (worker_home / ".active-container").write_text("container-123\ntest-local-model\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.main.Path") as MockPath:
            MockPath.home.return_value = tmp_path
            alias = _active_model_alias()
        assert alias == "test-local-model"

    def test_active_model_alias_missing_file_returns_none(self, tmp_path):
        """_active_model_alias() returns None when .active-container doesn't exist."""
        from unittest.mock import patch as _patch
        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.main.Path") as MockPath:
            MockPath.home.return_value = tmp_path
            alias = _active_model_alias()
        assert alias is None

    def test_active_model_alias_single_line_file_returns_none(self, tmp_path):
        """_active_model_alias() returns None if file has only one line (no alias)."""
        from unittest.mock import patch as _patch
        worker_home = tmp_path / ".worker-cli"
        worker_home.mkdir()
        (worker_home / ".active-container").write_text("container-only\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.main.Path") as MockPath:
            MockPath.home.return_value = tmp_path
            alias = _active_model_alias()
        assert alias is None

    def test_interactive_mode_uses_active_model_as_default(self, tmp_path):
        """When .active-container exists, _active_model_alias() provides the default."""
        from unittest.mock import patch as _patch
        worker_home = tmp_path / ".worker-cli"
        worker_home.mkdir()
        (worker_home / ".active-container").write_text("c-abc123\nmy-active-model\n")

        from voidrift_cli.main import _active_model_alias
        with _patch("voidrift_cli.main.Path") as MockPath:
            MockPath.home.return_value = tmp_path
            alias = _active_model_alias()
        assert alias == "my-active-model"
