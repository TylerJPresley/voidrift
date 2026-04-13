"""Tests for filesystem tool size guards (REQ-FSZ-1, REQ-FSZ-2)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from voidrift_cli.tools import WriteContext


def _make_lines(n: int) -> str:
    """Return a string with n lines."""
    return "\n".join(f"line {i}" for i in range(1, n + 1)) + "\n"


@pytest.fixture
def ctx(tmp_path):
    """WriteContext with default limit (2000) and a tmp project dir."""
    (tmp_path / ".voidrift").mkdir()
    return WriteContext(project_dir=tmp_path, max_read_lines=2000)


@pytest.fixture
def ctx_cloud(tmp_path):
    """WriteContext with higher limit (4000)."""
    (tmp_path / ".voidrift").mkdir()
    return WriteContext(project_dir=tmp_path, max_read_lines=4000)


class TestReadGuard:
    """V-FSZ-1: Pagination warning returned when file exceeds limit (REQ-FSZ-1)."""

    def test_small_file_no_warning(self, ctx, tmp_path):
        """Files within the limit are returned with no warning header."""
        f = tmp_path / "small.py"
        f.write_text(_make_lines(100))
        result = ctx.read_source_file("small.py")
        assert "WARNING" not in result
        assert "line 1" in result

    def test_large_file_triggers_warning(self, ctx, tmp_path):
        """Files exceeding max_read_lines return a WARNING header."""
        f = tmp_path / "big.py"
        f.write_text(_make_lines(2500))
        result = ctx.read_source_file("big.py")
        assert "WARNING" in result
        assert "2500 lines" in result
        assert "offset=2000" in result

    def test_large_file_returns_first_chunk(self, ctx, tmp_path):
        """Without explicit limit, only the first max_read_lines lines are returned."""
        f = tmp_path / "big.py"
        f.write_text(_make_lines(2500))
        result = ctx.read_source_file("big.py")
        assert "line 2000" in result
        assert "line 2001" not in result

    def test_explicit_limit_suppresses_warning(self, ctx, tmp_path):
        """An explicit limit returns exactly those lines with no warning."""
        f = tmp_path / "big.py"
        f.write_text(_make_lines(2500))
        result = ctx.read_source_file("big.py", limit=500)
        assert "WARNING" not in result
        assert "line 500" in result
        assert "line 501" not in result

    def test_offset_suppresses_warning(self, ctx, tmp_path):
        """An explicit offset (pagination in progress) suppresses the warning."""
        f = tmp_path / "big.py"
        f.write_text(_make_lines(2500))
        result = ctx.read_source_file("big.py", offset=2000)
        assert "WARNING" not in result
        assert "line 2001" in result

    def test_framework_file_large_triggers_warning(self, ctx, tmp_path):
        """read_framework_file applies the same guard."""
        f = tmp_path / ".voidrift" / "TASKS.md"
        f.write_text(_make_lines(2500))
        result = ctx.read_framework_file("TASKS.md")
        assert "WARNING" in result
        assert "2500 lines" in result

    def test_framework_file_small_no_warning(self, ctx, tmp_path):
        """Small framework files return cleanly."""
        f = tmp_path / ".voidrift" / "REQUIREMENTS.md"
        f.write_text(_make_lines(50))
        result = ctx.read_framework_file("REQUIREMENTS.md")
        assert "WARNING" not in result

    def test_warning_contains_correct_next_offset(self, ctx, tmp_path):
        """Warning message shows the correct next offset value."""
        f = tmp_path / "big.py"
        content = _make_lines(3000)
        f.write_text(content)
        result = ctx.read_source_file("big.py")
        assert "offset=2000" in result

    def test_configurable_limit_respected(self, tmp_path):
        """Custom max_read_lines is respected."""
        (tmp_path / ".voidrift").mkdir()
        ctx = WriteContext(project_dir=tmp_path, max_read_lines=500)
        f = tmp_path / "medium.py"
        f.write_text(_make_lines(600))
        result = ctx.read_source_file("medium.py")
        assert "WARNING" in result
        assert "600 lines" in result


class TestWriteGuard:
    """V-FSZ-2: Write rejected when content exceeds max_read_lines (REQ-FSZ-2)."""

    def test_small_write_succeeds(self, ctx):
        """Files within the limit are written successfully."""
        result = ctx.write_source_file("src/main.py", _make_lines(100))
        assert "Wrote" in result
        assert "Error" not in result

    def test_large_write_rejected(self, ctx):
        """Files exceeding max_read_lines are rejected with a decomposition directive."""
        result = ctx.write_source_file("src/main.py", _make_lines(2500))
        assert "Error" in result
        assert "exceeds the max_read_lines limit" in result
        assert "Decompose" in result

    def test_large_write_does_not_create_file(self, ctx, tmp_path):
        """Rejected writes leave no file on disk."""
        ctx.write_source_file("src/big.py", _make_lines(2500))
        assert not (tmp_path / "src" / "big.py").exists()

    def test_write_error_includes_line_count(self, ctx):
        """Error message contains actual line count and the limit."""
        result = ctx.write_source_file("src/main.py", _make_lines(2500))
        assert "2500" in result
        assert "2000" in result

    def test_framework_write_large_rejected(self, ctx):
        """write_framework_file applies the same guard."""
        result = ctx.write_framework_file("TASKS.md", _make_lines(2500))
        assert "Error" in result
        assert "exceeds the max_read_lines limit" in result

    def test_framework_write_small_succeeds(self, ctx):
        """Small framework writes are not blocked."""
        result = ctx.write_framework_file("REQUIREMENTS.md", _make_lines(100))
        assert "Wrote" in result

    def test_cloud_model_uses_cloud_limit(self, ctx_cloud, tmp_path):
        """Higher max_read_lines allows larger writes."""
        # 3500 lines — within limit of 4000
        result = ctx_cloud.write_source_file("src/main.py", _make_lines(3500))
        assert "Wrote" in result

    def test_boundary_at_limit_succeeds(self, ctx):
        """Writing exactly max_read_lines lines is allowed."""
        result = ctx.write_source_file("src/main.py", _make_lines(2000))
        assert "Wrote" in result

    def test_boundary_one_over_limit_rejected(self, ctx):
        """Writing max_read_lines + 1 lines is rejected."""
        result = ctx.write_source_file("src/main.py", _make_lines(2001))
        assert "Error" in result
        assert "exceeds the max_read_lines limit" in result


class TestDuplicateWriteGuard:
    """V-FSZ-4: Duplicate write guard uses content comparison, not path tracking (REQ-FSZ-4)."""

    def test_identical_content_blocked(self, ctx):
        """Writing the exact same content a second time is rejected."""
        ctx.write_source_file("src/main.py", "content A")
        result = ctx.write_source_file("src/main.py", "content A")
        assert "Already written" in result

    def test_different_content_allowed(self, ctx):
        """Writing different content to an already-written path is allowed (correction)."""
        ctx.write_source_file("src/main.py", "stub")
        result = ctx.write_source_file("src/main.py", "full content replacing the stub")
        assert "Wrote" in result
        assert "Already written" not in result

    def test_same_length_different_content_allowed(self, ctx):
        """Same byte length but different text is not a duplicate — allowed."""
        ctx.write_source_file("src/main.py", "aaa")
        result = ctx.write_source_file("src/main.py", "bbb")
        assert "Wrote" in result

    def test_stub_correction_allowed_framework_file(self, ctx):
        """A stub framework file (e.g. TASKS.md written with filename as content) can be corrected."""
        ctx.write_framework_file("TASKS.md", "TASKS.md")
        result = ctx.write_framework_file("TASKS.md", "# Tasks\n\n- [ ] Do something real\n")
        assert "Wrote" in result
        assert "Already written" not in result

    def test_first_write_never_blocked(self, ctx):
        """First write to any path is always allowed."""
        result = ctx.write_source_file("src/new.py", "content")
        assert "Wrote" in result


class TestWriteContextHandlers:
    def test_get_handlers_includes_edit_source_file(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        handlers = ctx.get_handlers()
        assert "edit_source_file" in handlers
        assert callable(handlers["edit_source_file"])


class TestStripHtml:
    def test_strip_html_logs_parse_error(self, caplog):
        """HTML parse error is logged at DEBUG, partial content returned."""
        import logging
        from voidrift_cli.tools import _strip_html

        with patch("html.parser.HTMLParser.feed", side_effect=Exception("bad html")):
            with caplog.at_level(logging.DEBUG, logger="voidrift_cli.tools.web"):
                result = _strip_html("<div>hello</div>")
        assert isinstance(result, str)
        assert "HTML parse error" in caplog.text


class TestSnapshotImport:
    def test_snapshot_importable_from_new_location(self):
        from voidrift_cli.tools.snapshot import set_snapshots, rollback_snapshots
        assert callable(set_snapshots)
        assert callable(rollback_snapshots)


class TestWebImport:
    def test_make_web_fetch_handler_importable_from_web(self):
        from voidrift_cli.tools.web import make_web_fetch_handler
        assert callable(make_web_fetch_handler)


class TestDeleteSourceFile:
    """Tests for REQ-D-24: delete_source_file tool."""

    def test_delete_existing_file(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        (tmp_path / "src").mkdir()
        target = tmp_path / "src" / "old.py"
        target.write_text("old content")
        ctx = WriteContext(project_dir=tmp_path)
        result = ctx.delete_source_file("src/old.py")
        assert "Deleted" in result
        assert not target.exists()

    def test_delete_nonexistent_file(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        ctx = WriteContext(project_dir=tmp_path)
        result = ctx.delete_source_file("src/missing.py")
        assert "does not exist" in result

    def test_delete_directory_rejected(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        (tmp_path / "src").mkdir()
        ctx = WriteContext(project_dir=tmp_path)
        result = ctx.delete_source_file("src")
        assert "directory" in result.lower()

    def test_delete_protected_path_rejected(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        (tmp_path / "Makefile").write_text("all:")
        ctx = WriteContext(project_dir=tmp_path)
        ctx._protected_paths.add("Makefile")
        result = ctx.delete_source_file("Makefile")
        assert "protected" in result.lower()

    def test_delete_outside_root_rejected(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        ctx = WriteContext(project_dir=tmp_path)
        result = ctx.delete_source_file("../../etc/passwd")
        assert "outside" in result.lower()

    def test_delete_snapshots_for_rollback(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        from voidrift_cli.tools.snapshot import set_snapshots, get_snapshots, rollback_snapshots
        (tmp_path / "src").mkdir()
        target = tmp_path / "src" / "old.py"
        target.write_text("original content")
        ctx = WriteContext(project_dir=tmp_path)
        set_snapshots()
        ctx.delete_source_file("src/old.py")
        assert not target.exists()
        rollback_snapshots(project_dir=tmp_path)
        assert target.exists()
        assert target.read_text() == "original content"
