"""Tests for gather command analysis cache (REQ-CTX-5, V-CTX-2)."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import pytest


class TestAnalysisCacheHelpers:
    """Unit tests for cache helper functions."""

    def test_req_ctx5_cache_path_keyed_by_hash(self, tmp_path):
        """Cache path is under .voidrift/cache/analyses/ and keyed by hash."""
        from voidrift_cli.commands.gather import _cache_path

        p = _cache_path(tmp_path, "abc123def456")
        assert p == tmp_path / "cache" / "analyses" / "abc123def456.json"

    def test_req_ctx5_load_cache_miss_returns_none(self, tmp_path):
        """_load_cache returns None when no cache entry exists."""
        from voidrift_cli.commands.gather import _cache_path, _load_cache

        result = _load_cache(_cache_path(tmp_path, "nonexistent"))
        assert result is None

    def test_req_ctx5_load_cache_hit_returns_analysis(self, tmp_path):
        """_load_cache returns the analysis string from a valid cache entry."""
        from voidrift_cli.commands.gather import _cache_path, _load_cache, _save_cache

        cache_file = _cache_path(tmp_path, "abc123")
        _save_cache(cache_file, "src/foo.py", "abc123", "- WHEN called, THE SYSTEM SHALL respond")

        result = _load_cache(cache_file)
        assert result == "- WHEN called, THE SYSTEM SHALL respond"

    def test_req_ctx5_save_cache_writes_required_fields(self, tmp_path):
        """_save_cache writes all required JSON fields: file, hash, analysis, timestamp."""
        from voidrift_cli.commands.gather import _cache_path, _save_cache

        before = time.time()
        cache_file = _cache_path(tmp_path, "deadbeef")
        _save_cache(cache_file, "src/api.py", "deadbeef", "- analysis text")
        after = time.time()

        data = json.loads(cache_file.read_text())
        assert data["file"] == "src/api.py"
        assert data["hash"] == "deadbeef"
        assert data["analysis"] == "- analysis text"
        assert before <= data["timestamp"] <= after

    def test_req_ctx5_save_cache_creates_parent_dirs(self, tmp_path):
        """_save_cache creates the cache directory tree if absent."""
        from voidrift_cli.commands.gather import _cache_path, _save_cache

        cache_file = _cache_path(tmp_path, "abc")
        assert not cache_file.parent.exists()

        _save_cache(cache_file, "x.py", "abc", "analysis")

        assert cache_file.exists()

    def test_req_ctx5_load_cache_tolerates_corrupt_entry(self, tmp_path):
        """_load_cache returns None for a corrupt cache file instead of raising."""
        from voidrift_cli.commands.gather import _cache_path, _load_cache

        cache_file = _cache_path(tmp_path, "corrupt")
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text("not valid json")

        result = _load_cache(cache_file)
        assert result is None


class TestAnalysisCacheIntegration:
    """Integration tests for cache hit/miss semantics (V-CTX-2)."""

    def test_req_ctx5_cache_hit_skips_model(self, tmp_path):
        """Unchanged file: same content hash → cached analysis returned without re-analysis."""
        from voidrift_cli.commands.gather import _cache_path, _load_cache, _save_cache

        content = "def handler(): pass\n"
        file_hash = hashlib.sha256(content.encode()).hexdigest()

        vd = tmp_path / ".voidrift"
        vd.mkdir()
        _save_cache(_cache_path(vd, file_hash), "src/api.py", file_hash, "- Cached analysis")

        # Simulate what _analyze_source does: hash the current file content, look up cache
        actual_hash = hashlib.sha256(content.encode()).hexdigest()
        result = _load_cache(_cache_path(vd, actual_hash))

        assert result == "- Cached analysis"

    def test_req_ctx5_cache_miss_when_content_changes(self, tmp_path):
        """Modified file: content hash changes → cache miss → re-analysis required."""
        from voidrift_cli.commands.gather import _cache_path, _load_cache, _save_cache

        original = "def foo(): return 1\n"
        modified = "def foo(): return 2\n"

        vd = tmp_path / ".voidrift"
        vd.mkdir()

        orig_hash = hashlib.sha256(original.encode()).hexdigest()
        _save_cache(_cache_path(vd, orig_hash), "src/foo.py", orig_hash, "- Original analysis")

        # Modified content → different hash → no cache entry
        new_hash = hashlib.sha256(modified.encode()).hexdigest()
        result = _load_cache(_cache_path(vd, new_hash))

        assert result is None
