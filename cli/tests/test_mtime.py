"""Tests for external file modification detection (REQ-D-19)."""

import os
import time

from voidrift_cli.tools.filesystem import WriteContext


class TestMtimeGuard:
    def test_external_mod_returns_warning(self, tmp_path):
        """Write, externally modify mtime, write again → warning."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "original")
        # Simulate external modification by changing mtime
        f = tmp_path / "src" / "api.py"
        os.utime(f, (time.time() + 10, time.time() + 10))
        result = ctx.write_source_file("src/api.py", "updated")
        assert "WARNING" in result
        assert "modified externally" in result

    def test_no_external_mod_proceeds(self, tmp_path):
        """Write, no external change, write again → succeeds."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "v1")
        result = ctx.write_source_file("src/api.py", "v2")
        assert "Wrote" in result
        assert (tmp_path / "src" / "api.py").read_text() == "v2"

    def test_force_write_overrides(self, tmp_path):
        """force_write=True bypasses the mtime check."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "original")
        f = tmp_path / "src" / "api.py"
        os.utime(f, (time.time() + 10, time.time() + 10))
        result = ctx.write_source_file("src/api.py", "forced", force_write=True)
        assert "Wrote" in result
        assert f.read_text() == "forced"

    def test_first_write_no_check(self, tmp_path):
        """First write to a path never triggers mtime check."""
        ctx = WriteContext(project_dir=tmp_path)
        # Pre-create file with old mtime
        f = tmp_path / "src" / "new.py"
        f.parent.mkdir(parents=True)
        f.write_text("pre-existing")
        os.utime(f, (time.time() - 100, time.time() - 100))
        result = ctx.write_source_file("src/new.py", "agent content")
        assert "Wrote" in result

    def test_cleared_between_tasks(self, tmp_path):
        """Mtime registry clears on reset_write_count."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "v1")
        f = tmp_path / "src" / "api.py"
        os.utime(f, (time.time() + 10, time.time() + 10))
        # Reset simulates new task
        ctx.reset_write_count()
        # Now the file is not tracked — first write should succeed
        result = ctx.write_source_file("src/api.py", "v2")
        assert "Wrote" in result

    def test_edit_external_mod_returns_warning(self, tmp_path):
        """edit_source_file also checks mtime."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "x = 1\n")
        f = tmp_path / "src" / "api.py"
        os.utime(f, (time.time() + 10, time.time() + 10))
        result = ctx.edit_source_file("src/api.py", "x = 1", "x = 2")
        assert "WARNING" in result

    def test_edit_force_write_overrides(self, tmp_path):
        """edit_source_file with force_write bypasses check."""
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/api.py", "x = 1\n")
        f = tmp_path / "src" / "api.py"
        os.utime(f, (time.time() + 10, time.time() + 10))
        result = ctx.edit_source_file("src/api.py", "x = 1", "x = 2", force_write=True)
        assert "Edited" in result
