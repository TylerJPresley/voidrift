"""Tests for gather command analysis cache (REQ-CTX-5, V-CTX-2)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest


class TestAnalysisCacheHelpers:
    """Unit tests for frontmatter-based analysis cache."""

    def test_analysis_path(self, tmp_path):
        """Analysis path mirrors source file path under .voidrift/analysis/."""
        from voidrift_cli.commands.gather import _analysis_path
        p = _analysis_path(tmp_path, "src/api.py")
        assert p == tmp_path / "analysis" / "src/api.py.md"

    def test_load_miss_returns_none(self, tmp_path):
        """Returns None when no analysis file exists."""
        from voidrift_cli.commands.gather import _analysis_path, _load_cached_analysis
        result = _load_cached_analysis(_analysis_path(tmp_path, "missing.py"), "abc123")
        assert result is None

    def test_load_hit_returns_analysis(self, tmp_path):
        """Returns analysis content when hash matches frontmatter."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis, _load_cached_analysis
        af = _analysis_path(tmp_path, "src/foo.py")
        _write_analysis(af, "src/foo.py", "abc123", "- WHEN called, THE SYSTEM SHALL respond")
        result = _load_cached_analysis(af, "abc123")
        assert result == "- WHEN called, THE SYSTEM SHALL respond"

    def test_load_miss_on_hash_mismatch(self, tmp_path):
        """Returns None when hash doesn't match frontmatter."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis, _load_cached_analysis
        af = _analysis_path(tmp_path, "src/foo.py")
        _write_analysis(af, "src/foo.py", "abc123", "- analysis")
        result = _load_cached_analysis(af, "different_hash")
        assert result is None

    def test_write_creates_parent_dirs(self, tmp_path):
        """_write_analysis creates directory tree if absent."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis
        af = _analysis_path(tmp_path, "deep/nested/file.py")
        _write_analysis(af, "deep/nested/file.py", "hash123", "analysis text")
        assert af.exists()

    def test_write_includes_frontmatter(self, tmp_path):
        """Written file has YAML frontmatter with file, hash, timestamp."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis
        af = _analysis_path(tmp_path, "src/api.py")
        _write_analysis(af, "src/api.py", "deadbeef", "- analysis text")
        text = af.read_text()
        assert text.startswith("---\n")
        assert "file: src/api.py" in text
        assert "hash: deadbeef" in text
        assert "timestamp:" in text
        assert "- analysis text" in text

    def test_load_tolerates_corrupt_file(self, tmp_path):
        """Returns None for a file without valid frontmatter."""
        from voidrift_cli.commands.gather import _analysis_path, _load_cached_analysis
        af = _analysis_path(tmp_path, "bad.py")
        af.parent.mkdir(parents=True, exist_ok=True)
        af.write_text("no frontmatter here")
        result = _load_cached_analysis(af, "abc123")
        assert result is None


class TestAnalysisCacheIntegration:
    """Integration tests for cache hit/miss semantics (V-CTX-2)."""

    def test_cache_hit_skips_model(self, tmp_path):
        """Unchanged file: same hash → cached analysis returned."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis, _load_cached_analysis
        content = "def handler(): pass\n"
        file_hash = hashlib.sha256(content.encode()).hexdigest()
        vd = tmp_path / ".voidrift"
        vd.mkdir()
        af = _analysis_path(vd, "src/api.py")
        _write_analysis(af, "src/api.py", file_hash, "- Cached analysis")
        result = _load_cached_analysis(af, file_hash)
        assert result == "- Cached analysis"

    def test_cache_miss_when_content_changes(self, tmp_path):
        """Modified file: different hash → cache miss."""
        from voidrift_cli.commands.gather import _analysis_path, _write_analysis, _load_cached_analysis
        vd = tmp_path / ".voidrift"
        vd.mkdir()
        orig_hash = hashlib.sha256(b"def foo(): return 1\n").hexdigest()
        af = _analysis_path(vd, "src/foo.py")
        _write_analysis(af, "src/foo.py", orig_hash, "- Original analysis")
        new_hash = hashlib.sha256(b"def foo(): return 2\n").hexdigest()
        result = _load_cached_analysis(af, new_hash)
        assert result is None
