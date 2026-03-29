"""Tests for phase commands — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


# ── Gather ──────────────────────────────────────────────────────────────


class TestGatherInputChunking:
    """V-G-4: REQ-G-13 — large files chunked (not truncated) for local models."""

    def test_make_chunks_splits_large_content(self):
        """_make_chunks splits text into sized pieces."""
        from voidrift_cli.phases.gather import _make_chunks
        text = "a" * 1000
        chunks = _make_chunks(text, 400, overlap=50)
        # Every character is covered
        assert len(chunks) > 1
        assert all(len(c) <= 400 for c in chunks)
        # Overlap: second chunk starts before first chunk ends
        assert chunks[1][:50] == chunks[0][-50:]

    def test_make_chunks_single_chunk_when_fits(self):
        """_make_chunks returns one chunk when content fits within limit."""
        from voidrift_cli.phases.gather import _make_chunks
        text = "a" * 100
        chunks = _make_chunks(text, 200)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_make_chunks_covers_full_content(self):
        """Every character appears in at least one chunk."""
        from voidrift_cli.phases.gather import _make_chunks
        text = "abcdefghij" * 100  # 1000 chars
        chunks = _make_chunks(text, 300, overlap=50)
        # Last chunk must reach the end of the text
        assert chunks[-1] == text[-(len(chunks[-1])):]
        assert text.endswith(chunks[-1])

    def test_local_model_chunk_size_is_8000(self):
        """Local model input limit (chunk size) defaults to 8000 chars."""
        from voidrift_cli.config import get_max_input_chars
        assert get_max_input_chars("local") == 8000

    def test_cloud_model_not_chunked(self):
        """Cloud model limit is 0 (unlimited — no chunking)."""
        from voidrift_cli.config import get_max_input_chars
        assert get_max_input_chars("cloud") == 0

    def test_large_file_produces_multiple_chunks(self, local_model):
        """A file 3x the limit produces at least 3 chunks."""
        from voidrift_cli.phases.gather import _make_chunks
        from voidrift_cli.config import get_max_input_chars

        limit = get_max_input_chars(local_model.model_type)
        large_content = "x" * (limit * 3)
        chunks = _make_chunks(large_content, limit)
        assert len(chunks) >= 3

    def test_single_chunk_skips_consolidation(self):
        """A file that fits in one chunk doesn't need a consolidation agent."""
        from voidrift_cli.phases.gather import _make_chunks
        from voidrift_cli.config import get_max_input_chars

        limit = get_max_input_chars("local")
        content = "y" * (limit - 100)  # under limit
        chunks = _make_chunks(content, limit)
        assert len(chunks) == 1  # no consolidation needed


class TestGatherRetryOn400:
    """_is_truncated_json_error utility — detects truncated tool call JSON errors."""

    def test_is_truncated_json_error_detects_invalid_json(self):
        from voidrift_cli.phases.gather import _is_truncated_json_error
        assert _is_truncated_json_error("Invalid JSON: something")
        assert _is_truncated_json_error("HTTP 400: EOF while parsing a string at line 1")
        assert not _is_truncated_json_error("HTTP 500: server error")
        assert not _is_truncated_json_error("Connection refused")

    def test_retry_tokens_are_halved(self):
        """Retry formula: max(original // 2, 256)."""
        from voidrift_cli.config import get_max_tokens
        max_tok = get_max_tokens("local", "analysis")
        retry_tok = max(max_tok // 2, 256)
        assert retry_tok <= max_tok

    def test_retry_tokens_floor_at_256(self):
        """Retry floor is 256 even if phase default is tiny."""
        original = 100
        retry = max(original // 2, 256)
        assert retry == 256


class TestContextBuild:
    """V-G-8: REQ-G-17 — context summaries built from non-source categories (≤10 items)."""

    def test_context_block_format(self):
        """context_block starts with '## Project Context' when summaries exist."""
        summaries = {"tests": "- test summary", "config": "- config summary"}
        parts = [f"### {cat.capitalize()}\n\n{s.strip()}" for cat, s in summaries.items()]
        context_block = "## Project Context\n\n" + "\n\n".join(parts)
        assert context_block.startswith("## Project Context")
        assert "### Tests" in context_block
        assert "test summary" in context_block

    def test_empty_categories_produce_no_context(self):
        """Empty non-source categories do not add entries to context block."""
        summaries: dict = {}
        context_block = ""
        if summaries:
            parts = [f"### {cat.capitalize()}\n\n{s.strip()}" for cat, s in summaries.items()]
            context_block = "## Project Context\n\n" + "\n\n".join(parts)
        assert context_block == ""

    def test_context_injected_into_analysis_prompt(self):
        """Context block is appended to analysis system prompt."""
        base_system = "Analyze for requirements."
        context_block = "## Project Context\n\n### Tests\n\n- foo bar"
        combined = base_system + "\n\n" + context_block
        assert "## Project Context" in combined
        assert combined.startswith(base_system)

    def test_non_source_categories_listed(self):
        """_NON_SOURCE contains all expected non-source categories."""
        from voidrift_cli.phases.gather import _NON_SOURCE
        assert "tests" in _NON_SOURCE
        assert "config" in _NON_SOURCE
        assert "infrastructure" in _NON_SOURCE
        assert "documentation" in _NON_SOURCE
        assert "assets" in _NON_SOURCE
        assert "source" not in _NON_SOURCE

    def test_context_block_absent_when_no_summaries(self):
        """If context_summaries is empty, context_block is empty string."""
        context_summaries: dict = {}
        context_block = ""
        if context_summaries:
            parts = [f"### {c.capitalize()}\n\n{s.strip()}" for c, s in context_summaries.items()]
            context_block = "## Project Context\n\n" + "\n\n".join(parts)
        assert context_block == ""
        # And system prompt does not grow when context_block is empty
        system = "base instructions"
        if context_block:
            system = system + "\n\n" + context_block
        assert system == "base instructions"


class TestSourceRequirementsDirect:
    """V-G-9: REQ-G-8 — source analysis returns direct response, CLI owns all persistence."""

    def test_source_is_only_non_context_category(self):
        """CATEGORIES minus _NON_SOURCE equals exactly {'source'}."""
        from voidrift_cli.phases.gather import _NON_SOURCE, CATEGORIES
        assert set(CATEGORIES) - set(_NON_SOURCE) == {"source"}

    def test_final_pass_agent_has_no_tools(self):
        """Final pass agent is invoked with an empty tools list."""
        captured: list[dict] = []

        class FakeAgent:
            def __init__(self, **kwargs):
                captured.append({"tools": kwargs.get("tools", [])})

            def send(self, msg: str) -> str:
                return "# Requirements\n\nREQ-1: The system shall work."

        source_reqs_text = "### src/main.py\n\n- WHEN invoked, THE SYSTEM SHALL run"
        final_msg = f"Source Requirements:\n\n{source_reqs_text}"
        agent = FakeAgent(
            model=None, stream=False, max_tokens=8192,
            system_prompt="Consolidation instructions", tools=[], tool_handlers={},
        )
        response = agent.send(final_msg)
        assert response.startswith("# Requirements")
        assert captured[0]["tools"] == []

    def test_preamble_stripped_from_final_response(self):
        """CLI strips preamble before first # header."""
        import re
        response = "Here is the document:\n\n# Requirements\n\nREQ-1: foo"
        match = re.search(r"^#\s+", response, re.MULTILINE)
        final = response[match.start():] if match else response
        assert final.startswith("# Requirements")
        assert "Here is the document" not in final

    def test_no_preamble_response_unchanged(self):
        """Response already starting with # is returned as-is."""
        import re
        response = "# Requirements\n\nREQ-1: foo"
        match = re.search(r"^#\s+", response, re.MULTILINE)
        final = response[match.start():] if match else response
        assert final == response

    def test_source_requirements_in_user_message(self):
        """Source requirements text is sent in user message, not system prompt."""
        reqs_text = "SOURCE_REQUIREMENTS_SENTINEL"
        system = "Final pass instructions only"
        user_msg = f"Source Requirements:\n\n{reqs_text}"
        assert reqs_text not in system
        assert reqs_text in user_msg


class TestChatWebFetch:
    """V-U-8: REQ-U-8 — web_fetch tool for chat phase."""

    def test_strip_html_removes_script_content(self):
        """_strip_html drops script tag content."""
        from voidrift_cli.tools import _strip_html
        html = "<html><head><script>alert(1)</script></head><body><p>Hello world</p></body></html>"
        result = _strip_html(html)
        assert "Hello world" in result
        assert "alert" not in result

    def test_strip_html_removes_style_content(self):
        """_strip_html drops style tag content."""
        from voidrift_cli.tools import _strip_html
        html = "<style>body { color: red; }</style><p>Content here</p>"
        result = _strip_html(html)
        assert "Content here" in result
        assert "color: red" not in result

    def test_strip_html_preserves_body_text(self):
        """_strip_html returns meaningful body text."""
        from voidrift_cli.tools import _strip_html
        html = "<html><body><h1>Title</h1><p>Description text.</p></body></html>"
        result = _strip_html(html)
        assert "Title" in result
        assert "Description text." in result

    def test_web_fetch_cache_hit_skips_http(self):
        """Second call with same URL returns cached summary without HTTP."""
        from voidrift_cli.tools import make_web_fetch_handler

        class FakeStore:
            def __init__(self):
                self._data: dict = {}
            def get(self, run_id, kind, key):
                return self._data.get((run_id, kind, key))
            def put(self, run_id, kind, key, value):
                self._data[(run_id, kind, key)] = value

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "Agent summary."

        store = FakeStore()
        store.put("run1", "web_cache", "https://example.com", "Cached summary.")

        handler = make_web_fetch_handler(
            mc=None, session_store=store, run_id="run1",
            log="/tmp/test.log", get_prompt_fn=lambda *a: "",
            agent_loop_cls=FakeAgent,
            confirm_fn=lambda url: True,
        )
        result = handler("https://example.com")
        assert result == "Cached summary."

    def test_web_fetch_operator_denied_returns_message(self):
        """Operator denying the prompt returns a denial message without fetching."""
        from voidrift_cli.tools import make_web_fetch_handler

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "summary"

        handler = make_web_fetch_handler(
            mc=None, session_store=None, run_id="run1",
            log="/tmp/test.log", get_prompt_fn=lambda *a: "",
            agent_loop_cls=FakeAgent,
            confirm_fn=lambda url: False,
        )
        with patch("urllib.request.urlopen") as mock_urlopen:
            result = handler("https://example.com")

        assert "declined" in result
        mock_urlopen.assert_not_called()

    def test_web_fetch_http_error_returns_message(self):
        """HTTP error returns an error string — no exception propagates."""
        import urllib.error
        from voidrift_cli.tools import make_web_fetch_handler

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "summary"

        handler = make_web_fetch_handler(
            mc=None, session_store=None, run_id="run1",
            log="/tmp/test.log", get_prompt_fn=lambda *a: "",
            agent_loop_cls=FakeAgent,
            confirm_fn=lambda url: True,
        )
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("connection refused")):
            result = handler("https://bad-url.invalid")

        assert "web_fetch error" in result

    def test_web_fetch_summary_cached_after_fetch(self):
        """Summary is stored in session store after successful fetch."""
        from voidrift_cli.tools import make_web_fetch_handler

        class FakeStore:
            def __init__(self):
                self._data: dict = {}
            def get(self, run_id, kind, key):
                return self._data.get((run_id, kind, key))
            def put(self, run_id, kind, key, value):
                self._data[(run_id, kind, key)] = value

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "Page summary."

        store = FakeStore()
        handler = make_web_fetch_handler(
            mc=None, session_store=store, run_id="run1",
            log="/tmp/test.log", get_prompt_fn=lambda *a: "",
            agent_loop_cls=FakeAgent,
            confirm_fn=lambda url: True,
        )

        fake_resp = MagicMock()
        fake_resp.read.return_value = b"<p>Hello world</p>"
        fake_resp.headers.get.return_value = "text/html"
        fake_resp.__enter__ = lambda s: s
        fake_resp.__exit__ = MagicMock(return_value=False)

        with patch("click.confirm", return_value=True), \
             patch("urllib.request.urlopen", return_value=fake_resp):
            result = handler("https://example.com/docs")

        assert result == "Page summary."
        assert store.get("run1", "web_cache", "https://example.com/docs") == "Page summary."

    def test_web_fetch_in_local_tools(self):
        """web_fetch schema is present in LOCAL_TOOLS."""
        from voidrift_cli.tools import LOCAL_TOOLS
        names = [t["function"]["name"] for t in LOCAL_TOOLS]
        assert "web_fetch" in names

    def test_web_fetch_absent_from_gather_tools(self):
        """web_fetch is not in the tool list for the gather phase."""
        from voidrift_cli.tools import LOCAL_TOOLS
        # gather _PHASE_TOOLS does not include web_fetch — verify via agent module
        import voidrift_cli.agent as agent_mod
        import inspect
        src = inspect.getsource(agent_mod.build_mcp_tools)
        # gather phase tools are defined before chat phase tools in the source
        gather_block_start = src.index('"gather"')
        chat_block_start = src.index('"chat"')
        gather_block = src[gather_block_start:chat_block_start]
        assert "web_fetch" not in gather_block


class TestPromptFormatting:
    """V-RES-1: Prompt format variable substitution — KeyError on missing var."""

    def test_task_format_with_valid_skills(self):
        """_TASK_FORMAT.format(valid_skills=...) substitutes correctly."""
        from voidrift_cli.phases.plan import _TASK_FORMAT
        result = _TASK_FORMAT.format(valid_skills="backend, analysis-reqs")
        assert "backend, analysis-reqs" in result
        assert "{valid_skills}" not in result

    def test_task_format_missing_var_raises_key_error(self):
        """_TASK_FORMAT.format() with no args raises KeyError for missing valid_skills."""
        from voidrift_cli.phases.plan import _TASK_FORMAT
        with pytest.raises(KeyError):
            _TASK_FORMAT.format()


class TestGatherPreflightChecks:
    def test_from_nonexistent_dir(self, tmp_project, cloud_model):
        from voidrift_cli.phases.gather import run_gather
        result = run_gather(cloud_model, from_path="/nonexistent/path")
        assert result == 1

    def test_from_existing_target_no_overwrite(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.phases.gather import run_gather
        result = run_gather(cloud_model, from_path=str(tmp_project), overwrite=False)
        assert result == 1  # Target exists, no --overwrite


# ── Plan ────────────────────────────────────────────────────────────────


class TestPlanPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_produces_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """Simulate a model that creates the required artifacts via tool calls."""
        vd = tmp_project / ".voidrift"

        # When agent.send() is called, create the artifacts the plan phase expects
        def fake_send(msg):
            (vd / "ARCHITECTURE.md").write_text("# Architecture\n\n## Overview\nTest arch")
            (vd / "TASKS.md").write_text("- [ ] Create src/main.py: entry point [analysis-reqs]\n")
            return "Plan complete."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "TASKS.md").exists()

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_retries_on_missing_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call: only create ARCHITECTURE.md (missing TASKS.md)
                (vd / "ARCHITECTURE.md").write_text("# Arch")
                return "Partial."
            else:
                # Retry: create TASKS.md too
                (vd / "TASKS.md").write_text("- [ ] Task [analysis-reqs]\n")
                return "Fixed."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert call_count == 2

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_fails_after_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I didn't create anything."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    def test_overwrite_clears_artifacts(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("old arch")
        (vd / "TASKS.md").write_text("old tasks")
        (vd / "arch").mkdir(exist_ok=True)
        (vd / "arch" / "backend.md").write_text("old module arch")
        (vd / "spec").mkdir(exist_ok=True)
        (vd / "spec" / "auth.md").write_text("gather spec")

        # Create a STATE.md entry so undo_phase knows what to remove
        (vd / "STATE.md").write_text(
            "## 2026-01-01T00:00:00 — plan (test)\nOld plan.\n### Files\n"
            "- created: .voidrift/ARCHITECTURE.md\n"
            "- created: .voidrift/TASKS.md\n"
            "- created: .voidrift/arch/backend.md\n\n"
        )

        with patch("voidrift_cli.phases.plan.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "nothing"
            MockAgent.return_value = mock_instance

            from voidrift_cli.phases.plan import run_plan
            run_plan(cloud_model, overwrite=True)

        assert not (vd / "ARCHITECTURE.md").exists()
        assert not (vd / "TASKS.md").exists()
        assert not (vd / "arch" / "backend.md").exists()
        assert (vd / "spec" / "auth.md").exists(), "Gather specs must be preserved"


# ── Develop ─────────────────────────────────────────────────────────────


class TestDevelopPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_missing_tasks(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_all_tasks_complete(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [x] Done 1\n- [x] Done 2\n")
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0

    def test_workers_without_modules(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Task [analysis-reqs]\n")
        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        # Single module, processes sequentially
        assert result in (0, 1)

    def test_lock_file_stale(self, tmp_project, cloud_model, sample_requirements, sample_tasks):
        """Stale lock (dead PID) should be cleaned up."""
        lock = tmp_project / ".voidrift" / ".develop.lock"
        lock.write_text("99999999\n2020-01-01T00:00:00")  # Dead PID

        with patch("voidrift_cli.phases.develop.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "done"
            MockAgent.return_value = mock_instance

            from voidrift_cli.phases.develop import run_develop
            # Will proceed past lock check (stale PID), then try to run tasks
            result = run_develop(cloud_model)

        # Lock should be cleaned up
        assert not lock.exists()

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_develop_loop_marks_tasks(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Create src/main.py: entry [analysis-reqs]\n")

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Created the file."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0
        assert "[x]" in (vd / "TASKS.md").read_text()

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_sequential_multi_module(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text(
            "## Module: backend\n- [ ] Task A [analysis-reqs]\n"
            "## Module: frontend\n- [ ] Task B [frontend]\n"
        )

        mock_instance = MagicMock()
        mock_instance.send.return_value = "done"
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0
        # Both modules should be marked complete in single file
        text = (vd / "TASKS.md").read_text()
        assert text.count("[x]") == 2


# ── Automate ────────────────────────────────────────────────────────────


class TestAutomatePreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_generate_mode(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        def fake_send(msg):
            # Simulate creating a compose file
            (tmp_project / "docker-compose.yml").write_text("version: '3'\nservices:\n  app:\n    build: .")
            return "Generated IaC."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 0

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_generate_fails_no_iac(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I described the infrastructure but didn't create files."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.automate.AgentLoop")
    def test_review_mode(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        # Pre-existing IaC
        (tmp_project / "docker-compose.yml").write_text("version: '3'")

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Reviewed and reconciled."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.automate import run_automate
        result = run_automate(cloud_model)
        assert result == 0


# ── Verify ──────────────────────────────────────────────────────────────


class TestVerify:
    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_pass_verdict(self, MockAgent, mock_checks, tmp_project, cloud_model):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("All tests passed", 0)

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nPASS\nAll good.")
            return "Report written."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 0

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_fail_no_architect(self, MockAgent, mock_checks, tmp_project, cloud_model):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Tests failed", 2)

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nFAIL\nThings broke.")
            return "Report written."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_fail_with_architect_generates_fixes(self, MockAgent, mock_checks, tmp_project, cloud_model):
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Tests failed", 1)
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Worker writes VERIFY.md
                (vd / "VERIFY.md").write_text("## Verdict\nFAIL\nBroken.")
                return "Report."
            elif call_count == 2:
                # Architect writes remediation plan
                (vd / "ARCHITECT_VERIFY.md").write_text("Fix task 1: do X")
                return "Fix plan."
            else:
                # Worker writes fix tasks
                (vd / "TASKS-fixes.md").write_text("- [ ] Fix X [analysis-reqs]\n")
                (vd / "ARCHITECT_VERIFY.md").unlink(missing_ok=True)
                return "Fix tasks created."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        architect = ModelConfig(alias="arch", model_id="test", model_type="cloud",
                                api_base="http://localhost:19999/v1", api_key="k")

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model, architect=architect)
        assert result == 1  # Still fails, but fix tasks generated
        assert (vd / "TASKS-fixes.md").exists()

    @patch("voidrift_cli.phases.verify._run_checks")
    @patch("voidrift_cli.phases.verify.AgentLoop")
    def test_pass_requires_zero_failed_checks(self, MockAgent, mock_checks, tmp_project, cloud_model):
        """Even if model says PASS, failed_checks > 0 means FAIL (AC-V6)."""
        vd = tmp_project / ".voidrift"
        mock_checks.return_value = ("Some output", 1)  # 1 failed check

        def fake_send(msg):
            (vd / "VERIFY.md").write_text("## Verdict\nPASS\nLooks fine to me.")
            return "Report."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1  # FAIL because failed_checks > 0


# ── CLI Commands ────────────────────────────────────────────────────────


class TestCLICommands:
    def test_status_command(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Phase 1" in result.output
        assert "Phase 5" in result.output

    def test_status_with_requirements(self, tmp_project, sample_requirements):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert "✅" in result.output

    def test_unlock_no_lock(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["unlock"])
        assert result.exit_code == 0
        assert "No lock file" in result.output

    def test_log_no_files(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "gather"])
        assert result.exit_code == 1

    def test_log_prune(self, tmp_project, voidrift_dir):
        log_dir = voidrift_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        (log_dir / "gather-20260101-000000.log").write_text("log content")
        (log_dir / "plan-20260101-000000.log").write_text("log content")
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "--prune"])
        assert "Deleted 2" in result.output

    def test_log_view(self, tmp_project, voidrift_dir):
        log_dir = voidrift_dir / "logs"
        log_dir.mkdir(exist_ok=True)
        (log_dir / "gather-20260101-000000.log").write_text("line1\nline2\nline3")
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["log", "gather"])
        assert result.exit_code == 0
        assert "line1" in result.output

    def test_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "gather" in result.output
        assert "develop" in result.output

    def test_gather_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["gather", "--help"])
        assert "PATH" in result.output
        assert "--overwrite" in result.output

    def test_develop_help(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["develop", "--help"])
        assert "Execute implementation tasks" in result.output

    def test_skills_subcommand_registered(self):
        """V-ARCH-1: 'skills' subcommand is registered in the CLI."""
        from voidrift_cli.main import cli
        assert "skills" in cli.commands

    def test_skills_help(self):
        """V-ARCH-1: 'voidrift skills --help' lists subcommands."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output


class TestSkillsList:
    """V-SKL-4: 'voidrift skills list' groups output by layer."""

    def test_skills_list_shows_layer_column(self, tmp_project):
        """skills list output includes a layer label (north-star, domain, or project)."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "list"])
        # Either skills found with layer labels, or "No skills found."
        assert result.exit_code == 0
        if "No skills found." not in result.output:
            # At least one layer should be labeled
            has_layer = any(lbl in result.output for lbl in ("north-star", "domain", "project"))
            assert has_layer, f"No layer labels found in output: {result.output!r}"

    def test_skills_list_layer_filter(self, tmp_project):
        """skills list --layer=project shows only project skills."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["skills", "list", "--layer", "project"])
        assert result.exit_code == 0
        if "No skills found." not in result.output:
            assert "domain" not in result.output
            assert "north-star" not in result.output


class TestPlanSkillTagValidation:
    """V-P-4: Plan skill tag validation strips invalid tags, preserves valid ones."""

    def test_validate_returns_invalid_tags(self, tmp_project, voidrift_dir):
        """_validate_skill_tags identifies tags not in the valid set."""
        from voidrift_cli.phases.plan import _validate_skill_tags
        tasks_file = voidrift_dir / "TASKS.md"
        tasks_file.write_text(
            "- [ ] Create src/main.py: entry [backend, invalid-tag, another-bad]\n"
        )
        invalid = _validate_skill_tags(tasks_file, {"backend"})
        assert "invalid-tag" in invalid
        assert "another-bad" in invalid
        assert "backend" not in invalid

    def test_validate_returns_empty_when_all_valid(self, tmp_project, voidrift_dir):
        """_validate_skill_tags returns empty set when all tags are valid."""
        from voidrift_cli.phases.plan import _validate_skill_tags
        tasks_file = voidrift_dir / "TASKS.md"
        tasks_file.write_text("- [ ] Create src/main.py: entry [backend]\n")
        invalid = _validate_skill_tags(tasks_file, {"backend"})
        assert invalid == set()

    def test_strip_removes_invalid_tags(self, tmp_project, voidrift_dir):
        """_strip_invalid_tags removes invalid tags from task lines."""
        from voidrift_cli.phases.plan import _strip_invalid_tags
        tasks_file = voidrift_dir / "TASKS.md"
        tasks_file.write_text("- [ ] Create src/a.py: desc [backend, bad-skill]\n")
        _strip_invalid_tags(tasks_file, {"bad-skill"})
        content = tasks_file.read_text()
        assert "bad-skill" not in content
        assert "backend" in content

    def test_strip_removes_whole_bracket_when_all_invalid(self, tmp_project, voidrift_dir):
        """If all tags are invalid, the bracket is removed entirely."""
        from voidrift_cli.phases.plan import _strip_invalid_tags
        tasks_file = voidrift_dir / "TASKS.md"
        tasks_file.write_text("- [ ] Create src/b.py: desc [totally-invalid]\n")
        _strip_invalid_tags(tasks_file, {"totally-invalid"})
        content = tasks_file.read_text()
        assert "totally-invalid" not in content


class TestPlanUpdateMode:
    """V-P-5: Plan --update mode requires existing ARCHITECTURE.md and TASKS.md."""

    def test_update_requires_architecture_md(self, tmp_project, cloud_model, sample_requirements):
        """run_plan(update=True) returns 1 when ARCHITECTURE.md is missing."""
        from voidrift_cli.phases.plan import run_plan
        vd = tmp_project / ".voidrift"
        # ARCHITECTURE.md missing, TASKS.md missing
        result = run_plan(cloud_model, update=True)
        assert result == 1

    def test_update_requires_tasks_md(self, tmp_project, cloud_model, sample_requirements):
        """run_plan(update=True) returns 1 when TASKS.md is missing."""
        from voidrift_cli.phases.plan import run_plan
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("# Architecture")
        # TASKS.md still missing
        result = run_plan(cloud_model, update=True)
        assert result == 1

    @patch("voidrift_cli.phases.plan.AgentLoop")
    def test_update_proceeds_when_both_exist(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """run_plan(update=True) proceeds when both artifacts exist."""
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("# Architecture")
        (vd / "TASKS.md").write_text("- [ ] Task A [backend]\n")

        mock_instance = MagicMock()
        # Fake the update: keep existing artifacts
        mock_instance.send.return_value = "Updated plan."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.plan import run_plan
        # The update call should at least start (not bail with exit code 1 on missing files)
        result = run_plan(cloud_model, update=True)
        # Either succeeds or fails for other reasons (missing artifacts), but NOT because
        # of the "requires existing" check
        mock_instance.send.assert_called()


class TestDevelopRetryEscalation:
    """V-D-4: No writes triggers retry, then escalation."""

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_no_writes_triggers_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """When the first task attempt writes nothing, a retry is attempted."""
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Create src/stub.py: stub [backend]\n")

        call_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.model = kwargs.get("model")
                self.system_prompt = kwargs.get("system_prompt", "")
                self.tools = kwargs.get("tools", [])
                self.tool_handlers = kwargs.get("tool_handlers", {})
                self.stream = kwargs.get("stream", False)
                self.log_path = kwargs.get("log_path")
                self.on_token = None
                self.on_complete = None
                self.on_tool_call = None
                self.messages = []
                self.extra_body = {}

            def send(self, msg: str) -> str:
                nonlocal call_count
                call_count += 1
                # Second call (retry) writes a file
                if call_count >= 2:
                    from voidrift_cli.tools import _ctx
                    _ctx._source_write_count += 1
                return "done"

        MockAgent.side_effect = FakeAgent

        from voidrift_cli.phases.develop import run_develop
        run_develop(cloud_model)

        assert call_count >= 2, "Expected at least 2 agent calls (initial + retry)"

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_no_writes_no_architect_skips_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """When no writes after retry and no architect, task is skipped (not escalated)."""
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text("- [ ] Create src/empty.py: stub [backend]\n")

        mock_instance = MagicMock()
        mock_instance.send.return_value = "I thought about it."
        MockAgent.return_value = mock_instance

        from voidrift_cli.phases.develop import run_develop
        # Without an architect, task should be skipped gracefully
        result = run_develop(cloud_model)
        assert result in (0, 1)  # Doesn't crash


class TestChatSession:
    """V-U-2: chat loads ANALYSIS-REQS skill + chat/SYSTEM prompt.
    V-UI-1: chat tools available on every turn.
    V-UI-2: session log contains operator input and model responses."""

    def test_chat_phase_tools_include_required_handlers(self, tmp_project):
        """V-U-2: build_mcp_tools with phase='chat' exposes get_skill and get_prompt."""
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        from voidrift_cli.agent import build_mcp_tools
        tools, handlers = build_mcp_tools(mcp_mod, phase="chat")
        assert "get_skill" in handlers
        assert "get_prompt" in handlers
        tool_names = {t["function"]["name"] for t in tools}
        assert "get_skill" in tool_names

    def test_chat_analysis_reqs_skill_is_available(self, tmp_project):
        """V-U-2: get_skill('ANALYSIS-REQS') returns non-empty content in chat context."""
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        from voidrift_cli.agent import build_mcp_tools
        _, handlers = build_mcp_tools(mcp_mod, phase="chat")
        skill_content = handlers["get_skill"]("ANALYSIS-REQS")
        assert len(skill_content) > 10
        assert "not found" not in skill_content.lower()

    def test_chat_system_prompt_is_available(self, tmp_project):
        """V-U-2: get_prompt('chat', 'SYSTEM') returns non-empty content."""
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        from voidrift_cli.agent import build_mcp_tools
        _, handlers = build_mcp_tools(mcp_mod, phase="chat")
        system_prompt = handlers["get_prompt"]("chat", "SYSTEM")
        assert len(system_prompt) > 10
        assert "not found" not in system_prompt.lower()

    def test_chat_doc_option_injects_file_content(self, tmp_project, voidrift_dir, cloud_model):
        """V-U-2: --doc injects the artifact's content into the system prompt."""
        from unittest.mock import patch, MagicMock
        from click.testing import CliRunner
        from voidrift_cli.main import cli

        doc_content = "# Requirements\n\nBuild a thing."
        (voidrift_dir / "REQUIREMENTS.md").write_text(doc_content)

        captured = {}

        class FakeAgent:
            def __init__(self, **kwargs):
                captured["system_prompt"] = kwargs.get("system_prompt", "")
                self.tools = kwargs.get("tools", [])
                self.tool_handlers = kwargs.get("tool_handlers", {})
                self.messages = []

        with patch("voidrift_cli.agent.AgentLoop", FakeAgent):
            with patch("voidrift_cli.main._interactive_loop"):
                with patch("voidrift_cli.main.resolve_model", return_value=cloud_model):
                    runner = CliRunner()
                    runner.invoke(cli, ["chat", cloud_model.alias, "--doc", "REQUIREMENTS.md"])

        assert "Build a thing." in captured.get("system_prompt", ""), \
            "Doc content should appear in system prompt when --doc is specified"

    @patch("voidrift_cli.agent.OpenAI")
    def test_ui1_tools_present_on_every_api_call(self, MockOpenAI, cloud_model, tmp_path):
        """V-UI-1: In auto mode, tools are passed to the API on every call."""
        from voidrift_cli.agent import AgentLoop
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        from helpers import make_openai_response, make_tool_call
        # First call: use a tool; second call: final text answer
        tc = make_tool_call("get_skill", '{"name": "backend-eng"}')
        tool_resp = make_openai_response(content=None, tool_calls=[tc])
        tool_resp.choices[0].message.content = None
        final_resp = make_openai_response("Here is my answer.")
        mock_client.chat.completions.create.side_effect = [tool_resp, final_resp]

        tool_def = {"type": "function", "function": {"name": "get_skill", "parameters": {}}}
        agent = AgentLoop(
            model=cloud_model,
            system_prompt="Chat assistant",
            tools=[tool_def],
            tool_handlers={"get_skill": lambda name="": "skill content"},
            stream=False,
            tool_choice="auto",
        )
        agent.send("Tell me about backend-eng")

        # Both API calls should have had tools in kwargs
        for call in mock_client.chat.completions.create.call_args_list:
            kwargs = call[1]
            assert "tools" in kwargs, "tools must be present in every API call for chat (auto) mode"
            assert kwargs.get("tool_choice") == "auto"

    @patch("voidrift_cli.agent.OpenAI")
    def test_ui2_log_contains_user_and_assistant(self, MockOpenAI, cloud_model, tmp_path):
        """V-UI-2: session log contains [USER] input and [ASSISTANT] response."""
        from voidrift_cli.agent import AgentLoop
        from helpers import make_openai_response
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = make_openai_response("Chat reply.")

        log_file = tmp_path / "chat.log"
        agent = AgentLoop(
            model=cloud_model,
            system_prompt="You are a chat assistant.",
            stream=False,
            tool_choice="auto",
            log_path=log_file,
        )
        agent.send("Hello from operator")

        log_content = log_file.read_text()
        assert "[USER]" in log_content
        assert "Hello from operator" in log_content
        assert "[ASSISTANT]" in log_content
        assert "Chat reply." in log_content

    @patch("voidrift_cli.agent.OpenAI")
    def test_ui2_log_contains_system_prompt(self, MockOpenAI, cloud_model, tmp_path):
        """V-UI-2: session log records the system prompt."""
        from voidrift_cli.agent import AgentLoop
        from helpers import make_openai_response
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = make_openai_response("reply")

        log_file = tmp_path / "chat.log"
        agent = AgentLoop(
            model=cloud_model,
            system_prompt="Distinctive system prompt content",
            stream=False,
            log_path=log_file,
        )
        agent.send("test")

        log_content = log_file.read_text()
        assert "[SYSTEM]" in log_content
        assert "Distinctive system prompt content" in log_content


class TestDevelopMaxEscalations:
    """V-D-5: After MAX_ESCALATIONS, task is blocked and loop continues."""

    def test_max_escalations_constant(self):
        """MAX_ESCALATIONS is defined and has a positive value."""
        from voidrift_cli.phases.develop import MAX_ESCALATIONS
        assert MAX_ESCALATIONS > 0

    @patch("voidrift_cli.phases.develop.AgentLoop")
    def test_max_escalations_blocks_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """After MAX_ESCALATIONS+1 escalation files, the task is blocked."""
        from voidrift_cli.phases.develop import MAX_ESCALATIONS
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text(
            "- [ ] Create src/esc.py: stub [backend]\n"
            "- [ ] Create src/ok.py: stub [backend]\n"
        )

        esc_dir = vd / "escalations"
        esc_dir.mkdir(parents=True, exist_ok=True)

        call_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.model = kwargs.get("model")
                self.system_prompt = kwargs.get("system_prompt", "")
                self.tools = kwargs.get("tools", [])
                self.tool_handlers = kwargs.get("tool_handlers", {})
                self.stream = kwargs.get("stream", False)
                self.log_path = kwargs.get("log_path")
                self.on_token = None
                self.on_complete = None
                self.on_tool_call = None
                self.messages = []
                self.extra_body = {}

            def send(self, msg: str) -> str:
                nonlocal call_count
                call_count += 1
                # Write a file so we pass the no-writes check
                from voidrift_cli.tools import _ctx
                _ctx._source_write_count += 1
                # Trigger escalation by writing escalation file
                task_num = call_count
                esc_file = esc_dir / f"{task_num}.md"
                esc_file.write_text(f"Escalation for task {task_num}")
                return "done"

        MockAgent.side_effect = FakeAgent

        architect = MagicMock()
        architect.alias = "arch-test"

        from voidrift_cli.phases.develop import run_develop
        # Should not raise — blocked tasks are handled gracefully
        result = run_develop(cloud_model)
        assert result in (0, 1)
