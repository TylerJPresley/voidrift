"""Tests for artifact_store.py — pure unit tests."""

from pathlib import Path

from voidrift_mcp.artifact_store import ArtifactStore


class TestArtifactStore:
    def test_store_and_get(self):
        store = ArtifactStore()
        store.store("analysis", "src/main.py", "Main entry point")
        assert store.get("analysis", "src/main.py") == "Main entry point"

    def test_get_missing(self):
        store = ArtifactStore()
        assert store.get("analysis", "nonexistent") is None

    def test_get_all(self):
        store = ArtifactStore()
        store.store("analysis", "a.py", "File A")
        store.store("analysis", "b.py", "File B")
        store.store("requirements", "project", "Reqs")
        all_a = store.get_all("analysis")
        assert len(all_a) == 2
        assert all_a["a.py"] == "File A"
        assert all_a["b.py"] == "File B"

    def test_get_all_empty_type(self):
        store = ArtifactStore()
        store.store("analysis", "a.py", "File A")
        assert store.get_all("requirements") == {}

    def test_overwrite(self):
        store = ArtifactStore()
        store.store("analysis", "a.py", "v1")
        store.store("analysis", "a.py", "v2")
        assert store.get("analysis", "a.py") == "v2"
        assert store.count == 1

    def test_count(self):
        store = ArtifactStore()
        assert store.count == 0
        store.store("a", "1", "x")
        store.store("b", "2", "y")
        assert store.count == 2

    def test_export_to_file(self, tmp_path):
        store = ArtifactStore()
        store.store("analysis", "main", "content here")
        out = tmp_path / "sub" / "output.md"
        assert store.export_to_file("analysis", "main", out)
        assert out.read_text() == "content here"

    def test_export_to_file_missing(self, tmp_path):
        store = ArtifactStore()
        out = tmp_path / "output.md"
        assert not store.export_to_file("analysis", "missing", out)
        assert not out.exists()

    def test_export_all(self, tmp_path):
        store = ArtifactStore()
        store.store("analysis", "a.py", "A content")
        store.store("analysis", "b.py", "B content")
        count = store.export_all("analysis", tmp_path)
        assert count == 2
        assert (tmp_path / "a.py.md").read_text() == "A content"
        assert (tmp_path / "b.py.md").read_text() == "B content"

    def test_export_all_sanitizes_paths(self, tmp_path):
        store = ArtifactStore()
        store.store("analysis", "src/deep/file.py", "content")
        count = store.export_all("analysis", tmp_path)
        assert count == 1
        # Slashes replaced with underscores
        assert (tmp_path / "src_deep_file.py.md").exists()
