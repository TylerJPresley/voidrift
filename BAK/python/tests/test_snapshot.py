"""Tests for snapshot/rollback and diff stats (REQ-D-15)."""

from voidrift_cli.tools.filesystem import (
    WriteContext, set_snapshots, get_snapshots, clear_snapshots,
    rollback_snapshots, compute_diff_stats,
)


class TestSnapshots:
    def test_rollback_restores_modified(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        f = tmp_path / "src" / "api.py"
        f.parent.mkdir(parents=True)
        f.write_text("original")
        set_snapshots()
        ctx.write_source_file("src/api.py", "modified")
        assert f.read_text() == "modified"
        rollback_snapshots(project_dir=tmp_path)
        assert f.read_text() == "original"

    def test_rollback_deletes_new_file(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        set_snapshots()
        ctx.write_source_file("src/new.py", "content")
        assert (tmp_path / "src" / "new.py").exists()
        rollback_snapshots(project_dir=tmp_path)
        assert not (tmp_path / "src" / "new.py").exists()

    def test_clear_after_success(self, tmp_path):
        set_snapshots()
        assert get_snapshots() is not None
        clear_snapshots()
        assert get_snapshots() is None

    def test_compute_diff_stats_created(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        set_snapshots()
        ctx.write_source_file("src/new.py", "line1\nline2\nline3")
        stats = compute_diff_stats(project_dir=tmp_path)
        assert len(stats) == 1
        assert stats[0]["status"] == "created"
        assert stats[0]["lines_added"] == 3
        clear_snapshots()

    def test_compute_diff_stats_modified(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        f = tmp_path / "src" / "api.py"
        f.parent.mkdir(parents=True)
        f.write_text("old line\n")
        set_snapshots()
        ctx.write_source_file("src/api.py", "new line\nextra\n")
        stats = compute_diff_stats(project_dir=tmp_path)
        assert len(stats) == 1
        assert stats[0]["status"] == "modified"
        assert stats[0]["lines_added"] > 0
        clear_snapshots()
