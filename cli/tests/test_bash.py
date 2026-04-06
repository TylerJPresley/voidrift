"""Tests for bash tool factory and config (REQ-SEC-4, REQ-CFG-9)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from voidrift_cli.tools.bash import BashConfig, create_run_command, _truncate


# ── BashConfig defaults (REQ-CFG-9) ────────────────────────────────────────


class TestBashConfig:
    def test_defaults(self):
        """BashConfig has sensible defaults."""
        cfg = BashConfig()
        assert cfg.enabled is True
        assert cfg.allowed_patterns == []
        assert cfg.timeout == 120
        assert cfg.max_output_lines == 500
        assert cfg.cwd is None
        assert cfg.spawn_hook is None

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_get_bash_config_defaults_when_absent(self, _mock):
        """get_bash_config returns defaults when bash section is absent (REQ-CFG-9)."""
        from voidrift_cli.config import get_bash_config
        cfg = get_bash_config("develop")
        assert cfg.enabled is True
        assert cfg.allowed_patterns == []
        assert cfg.timeout == 120
        assert cfg.max_output_lines == 500

    @patch("voidrift_cli.config.load_config", return_value={
        "bash": {
            "timeout": 200,
            "develop": {"timeout": 60, "allowed_patterns": ["pytest *"]},
        }
    })
    def test_get_bash_config_per_command_override(self, _mock):
        """Per-command overrides merge with global defaults (REQ-CFG-9)."""
        from voidrift_cli.config import get_bash_config
        cfg = get_bash_config("develop")
        assert cfg.timeout == 60
        assert cfg.allowed_patterns == ["pytest *"]
        # Chat inherits global timeout
        cfg_chat = get_bash_config("chat")
        assert cfg_chat.timeout == 200
        assert cfg_chat.allowed_patterns == []

    @patch("voidrift_cli.config.load_config", return_value={
        "bash": {"chat": {"enabled": False}}
    })
    def test_get_bash_config_enabled_false(self, _mock):
        """enabled: false is respected (REQ-CFG-9)."""
        from voidrift_cli.config import get_bash_config
        cfg = get_bash_config("chat")
        assert cfg.enabled is False


# ── Factory: create_run_command (REQ-SEC-4) ─────────────────────────────────


class TestBashFactory:
    def test_enabled_runs_command(self):
        """Enabled config executes the command and returns JSON (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True))
        result = json.loads(run("echo hello"))
        assert result["stdout"].strip() == "hello"
        assert result["exit_code"] == 0

    def test_disabled_rejects(self):
        """Disabled config rejects all commands (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=False))
        result = json.loads(run("echo hello"))
        assert "error" in result
        assert "disabled" in result["error"].lower()
        assert result["exit_code"] == -1

    def test_allowed_patterns_permits_match(self):
        """Command matching allowed_patterns executes (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True, allowed_patterns=["echo *"]))
        result = json.loads(run("echo test"))
        assert result["exit_code"] == 0

    def test_allowed_patterns_rejects_non_match(self):
        """Command not matching allowed_patterns is rejected (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True, allowed_patterns=["pytest *"]))
        result = json.loads(run("git push --force"))
        assert "error" in result
        assert "allowed patterns" in result["error"].lower()
        assert result["exit_code"] == -1

    def test_classify_command_blocks_dangerous(self):
        """Global classify_command blocks dangerous commands regardless of patterns (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True))
        result = json.loads(run("rm -rf /"))
        assert "error" in result
        assert "blocked" in result["error"].lower()

    def test_classify_command_after_pattern_check(self):
        """Even with matching patterns, classify_command still blocks (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True, allowed_patterns=["rm *"]))
        result = json.loads(run("rm -rf /"))
        assert "error" in result
        assert "blocked" in result["error"].lower()

    def test_output_truncation(self):
        """Output exceeding max_output_lines is truncated (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True, max_output_lines=5))
        result = json.loads(run("python3 -c \"[print(f'line {i}') for i in range(20)]\""))
        assert result["exit_code"] == 0
        lines = result["stdout"].strip().split("\n")
        assert "truncated" in lines[-1].lower()
        # 5 content lines + 1 truncation message
        assert len(lines) == 6

    def test_timeout_error(self):
        """Command exceeding timeout returns error (REQ-SEC-4)."""
        run = create_run_command(BashConfig(enabled=True, timeout=1))
        result = json.loads(run("sleep 10"))
        assert "error" in result
        assert "timed out" in result["error"].lower()

    def test_command_not_found(self):
        """Nonexistent command returns exit_code 127."""
        run = create_run_command(BashConfig(enabled=True))
        result = json.loads(run("this-command-does-not-exist-xyz"))
        assert "error" in result
        assert result["exit_code"] == 127

    def test_spawn_hook_transforms_command(self):
        """Spawn hook modifies command before execution (REQ-SEC-4)."""
        def hook(cmd, cwd):
            return f"echo hooked-{cmd.split()[-1]}", cwd

        run = create_run_command(BashConfig(enabled=True, spawn_hook=hook))
        result = json.loads(run("echo original"))
        assert "hooked-original" in result["stdout"]

    def test_cwd_from_config(self, tmp_path):
        """BashConfig.cwd is used as default working directory."""
        run = create_run_command(BashConfig(enabled=True, cwd=str(tmp_path)))
        result = json.loads(run("pwd"))
        assert result["stdout"].strip() == str(tmp_path)

    def test_cwd_argument_overrides_config(self, tmp_path):
        """Explicit cwd argument overrides BashConfig.cwd."""
        other = tmp_path / "sub"
        other.mkdir()
        run = create_run_command(BashConfig(enabled=True, cwd=str(tmp_path)))
        result = json.loads(run("pwd", cwd=str(other)))
        assert result["stdout"].strip() == str(other)

    def test_global_allowed_overrides_classification(self):
        """Global allowed_commands overrides classify_command to safe."""
        run = create_run_command(
            BashConfig(enabled=True),
            global_allowed=["git push *"],
        )
        result = json.loads(run("git push --force origin main"))
        # Would normally warn, but global allowlist overrides to safe
        # The command will fail (no git repo) but should not be blocked
        assert "blocked" not in result.get("error", "").lower()

    def test_logging(self, tmp_path):
        """Command execution is logged to log_path."""
        log_file = tmp_path / "cmd.log"
        run = create_run_command(
            BashConfig(enabled=True),
            log_path=str(log_file),
        )
        run("echo logged")
        content = log_file.read_text()
        assert "CMD_EXEC" in content
        assert "echo logged" in content


# ── _truncate helper ────────────────────────────────────────────────────────


class TestTruncate:
    def test_no_truncation_within_limit(self):
        text = "line1\nline2\nline3"
        assert _truncate(text, 5) == text

    def test_truncation_over_limit(self):
        text = "\n".join(f"line {i}" for i in range(10))
        result = _truncate(text, 3)
        assert "line 0" in result
        assert "line 2" in result
        assert "line 3" not in result
        assert "7 lines truncated" in result

    def test_exact_limit(self):
        text = "a\nb\nc"
        assert _truncate(text, 3) == text


# ── Tool registration in build_local_tools (REQ-ARCH-9) ────────────────────


class TestBashToolRegistration:
    @patch("voidrift_cli.config.load_config", return_value={})
    def test_develop_has_run_command(self, _mock):
        """Develop tool set includes run_command (REQ-ARCH-9)."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools("develop")
        names = {t["function"]["name"] for t in tools}
        assert "run_command" in names
        assert "run_command" in handlers

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_chat_has_run_command(self, _mock):
        """Chat tool set includes run_command (REQ-ARCH-9)."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools("chat")
        names = {t["function"]["name"] for t in tools}
        assert "run_command" in names
        assert "run_command" in handlers

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_gather_no_run_command(self, _mock):
        """Gather tool set does not include run_command."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools("gather")
        names = {t["function"]["name"] for t in tools}
        assert "run_command" not in names

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_plan_no_run_command(self, _mock):
        """Plan tool set does not include run_command."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools("plan")
        names = {t["function"]["name"] for t in tools}
        assert "run_command" not in names

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_verify_execute_has_run_command(self, _mock):
        """Verify-execute tool set includes run_command (REQ-VF-11)."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools("verify-execute")
        names = {t["function"]["name"] for t in tools}
        assert "run_command" in names
        assert "run_command" in handlers

    @patch("voidrift_cli.config.load_config", return_value={})
    def test_develop_description_mentions_validate(self, _mock):
        """Develop run_command description emphasizes validation."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("develop")
        rc_tool = next(t for t in tools if t["function"]["name"] == "run_command")
        assert "validate" in rc_tool["function"]["description"].lower()
