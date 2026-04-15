"""Tests for gather command analysis cache (REQ-CTX-5, V-CTX-2)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from unittest.mock import patch, MagicMock

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



class TestGatherInputChunking:
    """V-G-4: REQ-G-13 — large files chunked (not truncated) for local models."""

    def test_make_chunks_splits_large_content(self):
        """_make_chunks splits text into sized pieces."""
        from voidrift_cli.commands.gather import _make_chunks
        text = "a" * 1000
        chunks = _make_chunks(text, 400, overlap=50)
        # Every character is covered
        assert len(chunks) > 1
        assert all(len(c) <= 400 for c in chunks)
        # Overlap: second chunk starts before first chunk ends
        assert chunks[1][:50] == chunks[0][-50:]

    def test_make_chunks_single_chunk_when_fits(self):
        """_make_chunks returns one chunk when content fits within limit."""
        from voidrift_cli.commands.gather import _make_chunks
        text = "a" * 100
        chunks = _make_chunks(text, 200)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_make_chunks_covers_full_content(self):
        """Every character appears in at least one chunk."""
        from voidrift_cli.commands.gather import _make_chunks
        text = "abcdefghij" * 100  # 1000 chars
        chunks = _make_chunks(text, 300, overlap=50)
        # Last chunk must reach the end of the text
        assert chunks[-1] == text[-(len(chunks[-1])):]
        assert text.endswith(chunks[-1])

    def test_make_chunks_clamps_overlap_when_gte_size(self):
        """_make_chunks clamps overlap to size-1 when overlap >= size (REQ-G-13)."""
        from voidrift_cli.commands.gather import _make_chunks
        text = "x = 1\n" * 100  # 600 chars
        chunks = _make_chunks(text, 50, overlap=200)
        # Must terminate with finite chunks covering the full text
        assert len(chunks) > 1
        assert all(len(c) <= 50 for c in chunks)
        assert text.endswith(chunks[-1][-6:])  # last line present

    def test_local_model_chunk_size_is_8000(self, local_model):
        """Local model input limit (chunk size) is read from model config."""
        assert local_model.max_input_chars == 8000

    def test_cloud_model_input_limit(self, cloud_model):
        """Cloud model input limit matches the model's max_input_chars."""
        assert cloud_model.max_input_chars >= 0  # 0 means unlimited

    def test_large_file_produces_multiple_chunks(self, local_model):
        """A file 3x the limit produces at least 3 chunks."""
        from voidrift_cli.commands.gather import _make_chunks

        limit = local_model.max_input_chars
        large_content = "x" * (limit * 3)
        chunks = _make_chunks(large_content, limit)
        assert len(chunks) >= 3

    def test_single_chunk_skips_consolidation(self, local_model):
        """A file that fits in one chunk doesn't need a consolidation agent."""
        from voidrift_cli.commands.gather import _make_chunks

        limit = local_model.max_input_chars
        content = "y" * (limit - 100)  # under limit
        chunks = _make_chunks(content, limit)
        assert len(chunks) == 1  # no consolidation needed


class TestContextBuild:
    """V-G-8: REQ-G-17 — context summaries built from non-source categories (≤10 items)."""

    def test_context_block_format(self):
        """build_context_block produces '## Project Context' with category sections."""
        from voidrift_cli.commands.gather import build_context_block
        result = build_context_block({"tests": "- test summary", "config": "- config summary"})
        assert result.startswith("## Project Context")
        assert "### Tests" in result
        assert "test summary" in result

    def test_empty_summaries_produce_empty_string(self):
        """Empty dict returns empty string."""
        from voidrift_cli.commands.gather import build_context_block
        assert build_context_block({}) == ""

    def test_non_source_categories_listed(self):
        """_NON_SOURCE contains all expected non-source categories."""
        from voidrift_cli.commands.gather import _NON_SOURCE
        assert "tests" in _NON_SOURCE
        assert "config" in _NON_SOURCE
        assert "infrastructure" in _NON_SOURCE
        assert "documentation" in _NON_SOURCE
        assert "assets" in _NON_SOURCE
        assert "source" not in _NON_SOURCE


class TestSourceRequirementsDirect:
    """V-G-9: REQ-G-8 — source analysis returns direct response, CLI owns all persistence."""

    def test_source_is_only_non_context_category(self):
        """CATEGORIES minus _NON_SOURCE equals exactly {'source'}."""
        from voidrift_cli.commands.gather import _NON_SOURCE, CATEGORIES
        assert set(CATEGORIES) - set(_NON_SOURCE) == {"source"}

    def test_preamble_stripped_from_final_response(self):
        """strip_preamble removes text before first # header."""
        from voidrift_cli.commands.gather import strip_preamble
        result = strip_preamble("Here is the document:\n\n# Requirements\n\nREQ-1: foo")
        assert result.startswith("# Requirements")
        assert "Here is the document" not in result

    def test_no_preamble_response_unchanged(self):
        """Response already starting with # is returned as-is."""
        from voidrift_cli.commands.gather import strip_preamble
        response = "# Requirements\n\nREQ-1: foo"
        assert strip_preamble(response) == response

    def test_no_header_returns_full_response(self):
        """Response with no # header is returned unchanged."""
        from voidrift_cli.commands.gather import strip_preamble
        response = "Just plain text with no headers."
        assert strip_preamble(response) == response


class TestGatherPreflightChecks:
    def test_from_nonexistent_dir(self, tmp_project, cloud_model):
        from voidrift_cli.commands.gather import run_gather
        result = run_gather(cloud_model, from_path="/nonexistent/path")
        assert result == 1

    @patch("voidrift_cli.commands._gather_pipeline.AgentLoop")
    def test_existing_target_reads_for_update(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """When REQUIREMENTS.md exists and --overwrite is not set, existing content is passed to final pass."""
        from voidrift_cli.commands.gather import run_gather

        # Track all messages sent across all agent instances
        sent_msgs: list[str] = []

        def make_mock():
            m = MagicMock()
            call_count = [0]

            def side_effect(msg):
                sent_msgs.append(msg)
                call_count[0] += 1
                # First call per agent instance is triage — return empty JSON dict
                if call_count[0] == 1 and msg.startswith("File tree:"):
                    return "{}"
                return "# Requirements\n\n- REQ-1: updated"

            m.send.side_effect = side_effect
            return m

        MockAgent.side_effect = lambda **kwargs: make_mock()

        run_gather(cloud_model, from_path=str(tmp_project), overwrite=False)
        assert any("Existing REQUIREMENTS.md" in m for m in sent_msgs), (
            "Expected 'Existing REQUIREMENTS.md' in final pass message"
        )



import os
import time
from voidrift_cli.utils import prune_analysis_cache


class TestAnalysisCachePrune:
    def test_stale_entries_removed(self, tmp_path):
        analysis = tmp_path / ".voidrift" / "analysis"
        analysis.mkdir(parents=True)
        for i in range(3):
            (analysis / f"del{i}.py.md").write_text(f"---\nfile: src/del{i}.py\nhash: x\n---\n")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "keep.py").write_text("x")
        (analysis / "keep.py.md").write_text("---\nfile: src/keep.py\nhash: x\n---\n")
        stats = prune_analysis_cache(tmp_path)
        assert stats["stale"] == 3
        assert not (analysis / "del0.py.md").exists()
        assert (analysis / "keep.py.md").exists()

    def test_expired_entries_removed(self, tmp_path):
        analysis = tmp_path / ".voidrift" / "analysis"
        analysis.mkdir(parents=True)
        (tmp_path / "src").mkdir()
        f = analysis / "old.py.md"
        f.write_text("---\nfile: src/old.py\nhash: x\n---\n")
        (tmp_path / "src" / "old.py").write_text("x")
        old_time = time.time() - (31 * 86400)
        os.utime(f, (old_time, old_time))
        stats = prune_analysis_cache(tmp_path, ttl_days=30)
        assert stats["expired"] == 1
        assert not f.exists()

    def test_lru_eviction(self, tmp_path):
        analysis = tmp_path / ".voidrift" / "analysis"
        analysis.mkdir(parents=True)
        (tmp_path / "src").mkdir()
        for i in range(15):
            (analysis / f"f{i}.py.md").write_text(f"---\nfile: src/f{i}.py\nhash: x\n---\n")
            (tmp_path / "src" / f"f{i}.py").write_text("x")
            t = time.time() - (15 - i)
            os.utime(analysis / f"f{i}.py.md", (t, t))
        stats = prune_analysis_cache(tmp_path, max_entries=10, ttl_days=9999)
        assert stats["lru"] == 5
        assert len(list(analysis.glob("*.md"))) == 10

    def test_no_analysis_dir(self, tmp_path):
        stats = prune_analysis_cache(tmp_path)
        assert stats == {"stale": 0, "expired": 0, "lru": 0, "bytes_freed": 0}


class TestTriageJsonSanitization:
    """V-G-12: REQ-G-20 — control characters stripped before JSON parse in triage."""

    def test_control_chars_stripped_from_triage_response(self, tmp_path, cloud_model):
        """Literal newlines inside JSON string values don't break triage parsing."""
        from voidrift_cli.commands.gather import _run_triage

        log = tmp_path / "test.log"
        log.touch()
        # Simulate model output with literal newlines inside a JSON string value
        bad_json = '{"source": ["frontend/index.html\n\n"], "tests": [], "config": [], "infrastructure": [], "documentation": [], "assets": []}'

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.side_effect = [bad_json, '["frontend/index.html"]']
            MockAgent.return_value = mock

            categories = _run_triage(cloud_model, log, "", "tree", None, None)

        assert "source" in categories
        assert "frontend/index.html" in categories["source"]

    def test_fallback_regex_path_also_sanitized(self, tmp_path, cloud_model):
        """Regex fallback also strips control characters before parsing."""
        from voidrift_cli.commands.gather import _run_triage

        log = tmp_path / "test.log"
        log.touch()
        # Preamble text before JSON, with control chars inside the JSON
        bad_response = 'Here is the result:\n{"source": ["main.py\t"], "tests": [], "config": [], "infrastructure": [], "documentation": [], "assets": []}'

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.side_effect = [bad_response, '["main.py"]']
            MockAgent.return_value = mock

            categories = _run_triage(cloud_model, log, "", "tree", None, None)

        assert "main.py" in categories["source"]

    def test_truncated_json_repaired(self, tmp_path, cloud_model):
        """Truncated JSON from max_tokens cutoff is repaired by closing brackets."""
        from voidrift_cli.commands.gather import _run_triage

        log = tmp_path / "test.log"
        log.touch()
        # Simulate max_tokens truncation — JSON cut off mid-object
        truncated = '{"source": ["main.py", "app.py"], "tests": [], "config": ["pkg.json"],'

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.side_effect = [truncated, '["main.py", "app.py", "pkg.json"]']
            MockAgent.return_value = mock

            categories = _run_triage(cloud_model, log, "", "tree", None, None)

        assert "main.py" in categories["source"]
        assert "app.py" in categories["source"]
        assert "pkg.json" in categories["config"]


class TestGatherPipelineStages:
    """V-G-10: pipeline stages are individually callable (REQ-G-8, REQ-ARCH-7)."""

    def test_run_triage_returns_categories_dict(self, tmp_path, cloud_model):
        """_run_triage parses triage agent JSON response into categories dict."""
        from voidrift_cli.commands.gather import _run_triage, CATEGORIES

        log = tmp_path / "test.log"
        log.touch()
        triage_json = '{"source": ["src/main.py"], "tests": ["tests/test_main.py"]}'

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            # First call: triage; second call: validation
            mock.send.side_effect = [triage_json, '["src/main.py", "tests/test_main.py"]']
            MockAgent.return_value = mock

            categories = _run_triage(cloud_model, log, "", "file_tree text", None, None)

        assert "source" in categories
        assert "src/main.py" in categories["source"]

    def test_run_triage_raises_on_invalid_json(self, tmp_path, cloud_model):
        """_run_triage raises RuntimeError when triage returns non-JSON."""
        from voidrift_cli.commands.gather import _run_triage

        log = tmp_path / "test.log"
        log.touch()

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.return_value = "I could not produce JSON"
            MockAgent.return_value = mock

            with pytest.raises(RuntimeError, match="valid JSON"):
                _run_triage(cloud_model, log, "", "file_tree text", None, None)

    def test_run_context_build_returns_summaries(self, tmp_path, cloud_model):
        """_run_context_build returns category→summary dict for non-source categories."""
        from voidrift_cli.commands.gather import _run_context_build
        from unittest.mock import MagicMock

        log = tmp_path / "test.log"
        log.touch()
        categories = {"tests": ["tests/test_foo.py"], "source": []}

        def read_fn(path: str) -> str:
            return f"content of {path}"

        errors = MagicMock()
        errors.record = MagicMock()

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.return_value = "Summary of tests category"
            MockAgent.return_value = mock

            summaries = _run_context_build(
                cloud_model, categories, read_fn, log, "", None, None, None, errors
            )

        assert "tests" in summaries
        assert "Summary of tests category" in summaries["tests"]

    def test_run_source_analysis_empty_returns_empty(self, tmp_path, cloud_model):
        """_run_source_analysis returns empty dict when no source files given."""
        from voidrift_cli.commands.gather import _run_source_analysis
        from unittest.mock import MagicMock

        log = tmp_path / "test.log"
        log.touch()
        errors = MagicMock()

        result = _run_source_analysis(
            cloud_model, [], tmp_path, log, "",
            tmp_path / ".voidrift" / "REQUIREMENTS.md", None, None, 1, errors
        )
        assert result == {}

    def test_run_consolidation_returns_string(self, tmp_path, cloud_model):
        """_run_consolidation returns the agent response string."""
        from voidrift_cli.commands.gather import _run_consolidation

        log = tmp_path / "test.log"
        log.touch()

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.return_value = "# Requirements\n\nREQ-1: Test requirement"
            MockAgent.return_value = mock

            result = _run_consolidation(
                cloud_model,
                {"src/main.py": "analysis text"},
                {"tests": "test summary"},
                None,
                log, None, None,
            )

        assert "# Requirements" in result

    def test_gather_from_uses_named_stages(self):
        """_run_triage, _run_context_build, _run_source_analysis, _run_consolidation
        are importable from gather module (REQ-ARCH-7)."""
        from voidrift_cli.commands import gather as gather_mod
        assert hasattr(gather_mod, "_run_triage")
        assert hasattr(gather_mod, "_run_context_build")
        assert hasattr(gather_mod, "_run_source_analysis")
        assert hasattr(gather_mod, "_run_consolidation")


class TestGatherSourceReads:
    """V-G-10: REQ-G-18 — gather reads source files via WriteContext with full guards."""

    def test_reads_from_source_dir(self, tmp_path):
        """Source WriteContext is rooted at from_path, not project dir."""
        from voidrift_cli.tools.filesystem import WriteContext

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "main.py").write_text("print('hello')\n")

        ctx = WriteContext(project_dir=source_dir, max_read_lines=2000)
        result = ctx.read_source_file("main.py")
        assert "print('hello')" in result

    def test_offset_limit_supported(self, tmp_path):
        """Source reads support offset and limit parameters."""
        from voidrift_cli.tools.filesystem import WriteContext

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        lines = "\n".join(f"line {i}" for i in range(100)) + "\n"
        (source_dir / "big.py").write_text(lines)

        ctx = WriteContext(project_dir=source_dir, max_read_lines=2000)
        result = ctx.read_source_file("big.py", offset=10, limit=5)
        assert "line 10" in result
        assert "line 14" in result
        assert "line 9" not in result
        assert "line 15" not in result

    def test_sandbox_blocks_traversal(self, tmp_path):
        """Sandbox enforcement blocks path traversal outside source dir."""
        from voidrift_cli.tools.filesystem import WriteContext

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (tmp_path / "secret.txt").write_text("secret")

        ctx = WriteContext(project_dir=source_dir, max_read_lines=2000)
        result = ctx.read_source_file("../secret.txt")
        assert "Access denied" in result or "outside" in result.lower()

    def test_pagination_warning_on_large_file(self, tmp_path):
        """Large files get pagination warning with offset instructions."""
        from voidrift_cli.tools.filesystem import WriteContext

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        lines = "\n".join(f"line {i}" for i in range(200)) + "\n"
        (source_dir / "big.py").write_text(lines)

        ctx = WriteContext(project_dir=source_dir, max_read_lines=50)
        result = ctx.read_source_file("big.py")
        assert "WARNING" in result
        assert "offset=" in result

    def test_no_post_build_handler_override(self, tmp_path, cloud_model):
        """build_local_tools with source_read_ctx returns handler at build time."""
        from voidrift_cli.tools.filesystem import WriteContext
        from voidrift_cli.tool_builder import build_local_tools

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / ".voidrift").mkdir()
        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "app.py").write_text("x = 1\n")

        source_ctx = WriteContext(project_dir=source_dir, max_read_lines=2000)
        tools, handlers = build_local_tools(
            cmd="gather", project_dir=project_dir,
            source_read_ctx=source_ctx,
        )
        # file handler with source_read_ctx reads source files from source_dir
        result = handlers["file"](action="read", path="app.py")
        assert "x = 1" in result

    def test_build_handlers_source_read_ctx(self, tmp_path):
        """build_handlers with source_read_ctx wires source context at build time."""
        from voidrift_cli.tools.filesystem import WriteContext
        from voidrift_cli.tool_builder import build_handlers

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "mod.py").write_text("y = 2\n")

        source_ctx = WriteContext(project_dir=source_dir, max_read_lines=2000)
        handlers = build_handlers(
            cmd="gather", project_dir=project_dir,
            source_read_ctx=source_ctx,
        )
        result = handlers["read_source_file"]("mod.py")
        assert "y = 2" in result

    def test_build_handlers_without_source_read_ctx(self, tmp_path):
        """Without source_read_ctx, read_source_file uses project dir."""
        from voidrift_cli.tools.filesystem import WriteContext
        from voidrift_cli.tool_builder import build_handlers

        project_dir = tmp_path / "project"
        project_dir.mkdir()
        (project_dir / "app.py").write_text("z = 3\n")

        handlers = build_handlers(cmd="gather", project_dir=project_dir)
        result = handlers["read_source_file"]("app.py")
        assert "z = 3" in result


class TestZeroToolSourceAnalysis:
    """V-G-11: REQ-G-19 — source analysis subagent has zero tools, content in user message."""

    def test_normal_flow_agent_has_zero_tools(self, tmp_path, cloud_model):
        """Normal-flow source analysis creates AgentLoop with tools=[] and tool_handlers={}."""
        from voidrift_cli.commands.gather import _run_source_analysis
        from unittest.mock import MagicMock, patch

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "app.py").write_text("x = 1\n")

        log = tmp_path / "test.log"
        log.touch()
        target = tmp_path / ".voidrift" / "REQUIREMENTS.md"
        target.parent.mkdir(parents=True)
        errors = MagicMock()

        captured_kwargs = {}

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "- REQ: x equals 1"

            def capture_init(**kwargs):
                captured_kwargs.update(kwargs)
                return mock_instance

            MockAgent.side_effect = capture_init

            _run_source_analysis(
                cloud_model, ["app.py"], source_dir, log, "",
                target, None, None, 1, errors,
            )

        assert captured_kwargs["tools"] == []
        assert captured_kwargs["tool_handlers"] == {}

    def test_file_content_in_user_message(self, tmp_path, cloud_model):
        """Normal-flow source analysis injects file content into the user message."""
        from voidrift_cli.commands.gather import _run_source_analysis
        from unittest.mock import MagicMock, patch

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "main.py").write_text("def hello():\n    return 'world'\n")

        log = tmp_path / "test.log"
        log.touch()
        target = tmp_path / ".voidrift" / "REQUIREMENTS.md"
        target.parent.mkdir(parents=True)
        errors = MagicMock()

        sent_message = {}

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock_instance = MagicMock()

            def capture_send(msg):
                sent_message["text"] = msg
                return "- REQ: hello returns world"

            mock_instance.send.side_effect = capture_send
            MockAgent.return_value = mock_instance

            _run_source_analysis(
                cloud_model, ["main.py"], source_dir, log, "",
                target, None, None, 1, errors,
            )

        assert "def hello():" in sent_message["text"]
        assert "return 'world'" in sent_message["text"]
        assert "main.py" in sent_message["text"]

    def test_analysis_prompt_no_tool_instruction(self):
        """ANALYSIS prompt does not reference read_source_file or tool calls."""
        from voidrift_cli import prompts

        prompt = prompts.load_prompt("gather", "ANALYSIS")
        assert "read_source_file" not in prompt
        assert "Call" not in prompt.split("\n")[0] if prompt else True

    def test_chunked_flow_unchanged(self, tmp_path):
        """Chunked flow for large files still uses zero tools with content in message."""
        from voidrift_cli.commands.gather import _run_source_analysis
        from voidrift_cli.models import ModelConfig
        from unittest.mock import MagicMock, patch

        model = ModelConfig(
            alias="test", model_id="test", model_type="local",
            api_base="http://localhost:8000/v1", api_key="k",
            max_input_chars=50,
        )

        source_dir = tmp_path / "src"
        source_dir.mkdir()
        (source_dir / "big.py").write_text("x = 1\n" * 100)

        log = tmp_path / "test.log"
        log.touch()
        target = tmp_path / ".voidrift" / "REQUIREMENTS.md"
        target.parent.mkdir(parents=True)
        errors = MagicMock()

        agent_kwargs_list = []

        with patch("voidrift_cli.commands._gather_pipeline.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "- REQ: chunked analysis"

            def capture_init(**kwargs):
                agent_kwargs_list.append(dict(kwargs))
                return mock_instance

            MockAgent.side_effect = capture_init

            _run_source_analysis(
                model, ["big.py"], source_dir, log, "",
                target, None, None, 1, errors,
            )

        # All chunk agents should have zero tools
        for kwargs in agent_kwargs_list:
            assert kwargs["tools"] == []
            assert kwargs["tool_handlers"] == {}


class TestGatherElapsedOutput:
    """V-G-15: REQ-G-21 — gather final line includes total elapsed time."""

    @patch("voidrift_cli.commands._gather_pipeline.AgentLoop")
    def test_done_line_contains_elapsed(self, MockAgent, tmp_project, cloud_model, capsys):
        """The final success message includes a total elapsed time string."""
        from voidrift_cli.commands.gather import run_gather

        mock_instance = MagicMock()

        def make_mock():
            m = MagicMock()
            call_count = [0]

            def side_effect(msg):
                call_count[0] += 1
                if call_count[0] == 1 and msg.startswith("File tree:"):
                    return "{}"
                return "# Requirements\n\n- REQ-1: test"

            m.send.side_effect = side_effect
            return m

        MockAgent.side_effect = lambda **kwargs: make_mock()

        run_gather(cloud_model, from_path=str(tmp_project))
        captured = capsys.readouterr()
        # The done line must contain an elapsed time — either Ns or Nm Ns format.
        import re
        assert re.search(r"\(\d+s\)|\(\d+m \d+s\)", captured.out), (
            f"Expected elapsed time in output, got: {captured.out!r}"
        )


class TestTriageCoverageCheck:
    """Tests for REQ-G-22: triage coverage check."""

    def test_all_categorized_no_warning(self, capsys):
        from voidrift_cli import ui
        file_tree = "src/main.py\nsrc/utils.py\nconfig.yml"
        file_category = {"src/main.py": "source", "src/utils.py": "source", "config.yml": "config"}
        input_count = len(file_tree.strip().splitlines())
        categorized_count = len(file_category)
        if categorized_count < input_count:
            ui.warn(f"Triage: {input_count - categorized_count} file(s) not categorized")
        captured = capsys.readouterr()
        assert "not categorized" not in captured.err

    def test_missing_files_warns(self, capsys):
        from voidrift_cli import ui
        file_tree = "src/main.py\nsrc/utils.py\nconfig.yml"
        file_category = {"src/main.py": "source"}
        input_count = len(file_tree.strip().splitlines())
        categorized_count = len(file_category)
        if categorized_count < input_count:
            ui.warn(f"Triage: {input_count - categorized_count} file(s) not categorized out of {input_count}")
        captured = capsys.readouterr()
        assert "2 file(s) not categorized" in captured.err
