"""Tests for utils.py — pure unit tests with tmp_path fixtures."""

from pathlib import Path

import pytest

from voidrift_cli.utils import (
    count_tasks, extract_skill_tags,
    truncate_task_label,
    voidrift_dir, ensure_voidrift_dir, check_requirements_exist,
    check_task_files, log_path, check_disk_space,
)


class TestCountTasks:
    def test_mixed_states(self, sample_tasks):
        done, blocked, total = count_tasks(sample_tasks)
        assert done == 1
        assert blocked == 1
        assert total == 4

    def test_all_done(self, voidrift_dir):
        tf = voidrift_dir / "TASKS.md"
        tf.write_text("- [x] Task 1\n- [x] Task 2\n")
        done, blocked, total = count_tasks(tf)
        assert done == 2 and blocked == 0 and total == 2

    def test_empty_file(self, voidrift_dir):
        tf = voidrift_dir / "TASKS.md"
        tf.write_text("# No tasks here\n")
        assert count_tasks(tf) == (0, 0, 0)

    def test_missing_file(self, voidrift_dir):
        assert count_tasks(voidrift_dir / "NOPE.md") == (0, 0, 0)


class TestExtractSkillTags:
    def test_single_tag(self):
        assert extract_skill_tags("- [ ] Create file [backend]") == ["backend"]

    def test_multiple_tags(self):
        assert extract_skill_tags("- [ ] Create file [backend, tdd]") == ["backend", "tdd"]

    def test_no_tags(self):
        assert extract_skill_tags("- [ ] Create file without tags") == []

    def test_tags_with_spaces(self):
        assert extract_skill_tags("- [ ] Task [ backend , tdd , infra ]") == ["backend", "tdd", "infra"]

    def test_empty_string(self):
        assert extract_skill_tags("") == []


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

    def test_check_task_files_single(self, tmp_project, sample_tasks):
        result, is_multi = check_task_files()
        assert result is not None
        assert not is_multi

    def test_check_task_files_multi(self, tmp_project, voidrift_dir):
        (voidrift_dir / "TASKS.md").write_text(
            "## Module: backend\n- [ ] Task 1 [backend]\n"
            "## Module: frontend\n- [ ] Task 2 [frontend]\n"
        )
        result, is_multi = check_task_files()
        assert result is not None
        assert is_multi

    def test_check_task_files_none(self, tmp_project):
        result, is_multi = check_task_files()
        assert result is None
        assert not is_multi

    def test_log_path_format(self, tmp_project):
        p = log_path("gather")
        assert "gather-" in p.name
        assert p.name.endswith(".log")
        assert p.parent.name == "logs"
        assert p.parent.parent.name == ".voidrift"

    def test_check_disk_space_no_crash(self, tmp_project):
        # Should not raise regardless of disk space
        check_disk_space()
