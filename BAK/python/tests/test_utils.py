"""Tests for utils.py — pure unit tests with tmp_path fixtures."""

from pathlib import Path

import pytest

from voidrift_cli.utils import (
    truncate_task_label,
    voidrift_dir, ensure_voidrift_dir, check_requirements_exist,
    log_path, check_disk_space,
)


class TestTruncateTaskLabel:
    def test_short_label(self):
        result = truncate_task_label("- [ ] Create src/main.py: entry point [backend]")
        assert result == "Create src/main.py: entry point"

    def test_long_label_truncated(self):
        long = "- [ ] Create src/main.py: " + "x" * 100 + " [backend]"
        result = truncate_task_label(long)
        assert len(result) <= 72
        assert result.endswith("...")

    def test_strips_checkbox(self):
        result = truncate_task_label("- [x] Done task [tdd]")
        assert not result.startswith("- [")

    def test_strips_tags(self):
        result = truncate_task_label("- [ ] Task [backend, tdd]")
        assert "[backend" not in result


class TestProjectDirHelpers:
    def test_voidrift_dir(self, tmp_project):
        d = voidrift_dir()
        assert d.name == ".voidrift"

    def test_ensure_creates(self, tmp_project):
        import shutil
        vd = tmp_project / ".voidrift"
        if vd.exists():
            shutil.rmtree(vd)
        result = ensure_voidrift_dir()
        assert result.exists()

    def test_check_requirements_exist(self, tmp_project, sample_requirements):
        assert check_requirements_exist()

    def test_check_requirements_missing(self, tmp_project):
        assert not check_requirements_exist()

    def test_log_path_format(self, tmp_project):
        p = log_path("gather")
        assert "gather-" in p.name
        assert p.name.endswith(".log")
        assert p.parent.name == "logs"
        assert p.parent.parent.name == ".voidrift"

    def test_check_disk_space_no_crash(self, tmp_project):
        # Should not raise regardless of disk space
        check_disk_space()
