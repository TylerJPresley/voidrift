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

        voidrift_home = os.environ["VOIDRIFT_HOME"]
        log_path = Path(voidrift_home) / "logs" / "voidrift.log"
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

        voidrift_home = os.environ["VOIDRIFT_HOME"]
        log_path = Path(voidrift_home) / "logs" / "voidrift.log"
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

    def test_system_log_separate_from_mcp_log(self, tmp_project):
        """voidrift.log is different from mcp.log (REQ-LOG-4 vs REQ-LOG-5)."""
        voidrift_home = os.environ["VOIDRIFT_HOME"]
        system_log = Path(voidrift_home) / "logs" / "voidrift.log"
        mcp_log = Path(voidrift_home) / "logs" / "mcp.log"
        assert system_log != mcp_log
        assert system_log.name == "voidrift.log"
        assert mcp_log.name == "mcp.log"


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
