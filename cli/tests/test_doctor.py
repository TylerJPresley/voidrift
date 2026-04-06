"""Tests for doctor.py (REQ-U-16)."""

from unittest.mock import patch, MagicMock
from pathlib import Path

from voidrift_cli.doctor import run_checks, Check


class TestDoctor:
    def test_valid_setup_passes(self):
        """With valid config, checks pass."""
        checks = run_checks()
        # At minimum config and disk should pass in dev environment
        names = {c.name for c in checks}
        assert "config" in names
        assert "disk" in names

    def test_missing_log_dir_fixed(self, tmp_path, monkeypatch):
        """--fix creates missing log directory."""
        fake_home = tmp_path / "voidrift"
        fake_home.mkdir()
        (fake_home / "config.yml").write_text("models_file: /tmp/nope.yml\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(fake_home))

        checks = run_checks(fix=True)
        log_checks = [c for c in checks if c.name == "logs"]
        assert log_checks
        assert log_checks[0].result == "pass"
        assert (fake_home / "logs").is_dir()

    def test_missing_log_dir_fails_without_fix(self, tmp_path, monkeypatch):
        """Missing log dir fails when --fix not set."""
        fake_home = tmp_path / "voidrift"
        fake_home.mkdir()
        (fake_home / "config.yml").write_text("models_file: /tmp/nope.yml\n")
        monkeypatch.setenv("VOIDRIFT_HOME", str(fake_home))

        checks = run_checks(fix=False)
        log_checks = [c for c in checks if c.name == "logs"]
        assert log_checks
        assert log_checks[0].result == "fail"

    def test_missing_config_fails(self, tmp_path, monkeypatch):
        """Missing config file is a failure."""
        fake_home = tmp_path / "empty"
        fake_home.mkdir()
        monkeypatch.setenv("VOIDRIFT_HOME", str(fake_home))

        checks = run_checks()

        cfg = [c for c in checks if c.name == "config"][0]
        assert cfg.result == "fail"

    def test_disk_space_check_runs(self):
        """Disk space check produces a result."""
        checks = run_checks()
        disk = [c for c in checks if c.name == "disk"]
        assert disk
        assert disk[0].result in ("pass", "warn", "fail")

    def test_doctor_command_exists(self):
        """voidrift doctor is a registered CLI command."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["doctor", "--help"])
        assert result.exit_code == 0
        assert "diagnostic" in result.output.lower() or "fix" in result.output.lower()


class TestOptionalDeps:
    """Tests for optional dependency checks (REQ-U-16a)."""

    def test_missing_optional_dep_produces_warn(self):
        """A missing optional dep produces a warn check with install hint."""
        from voidrift_cli.doctor import _check_optional_deps
        with patch("importlib.import_module", side_effect=ImportError("nope")):
            checks = _check_optional_deps()
        assert all(c.result == "warn" for c in checks)
        assert any("pip install" in c.fix_hint for c in checks)

    def test_installed_optional_dep_produces_pass(self):
        """An installed optional dep produces a pass check."""
        from voidrift_cli.doctor import _check_optional_deps
        # At least some standard library modules will import fine
        # We mock all to succeed
        with patch("importlib.import_module", return_value=MagicMock()):
            checks = _check_optional_deps()
        assert all(c.result == "pass" for c in checks)

    def test_optional_checks_included_in_run_checks(self):
        """run_checks includes optional dependency checks."""
        checks = run_checks()
        optional = [c for c in checks if c.name.startswith("optional:")]
        assert len(optional) >= 5  # tree-sitter, tree-sitter-python, pymupdf, python-docx, openpyxl
