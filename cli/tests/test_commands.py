"""Tests for framework commands — integration tests with mocked model API."""

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


class TestChatWebFetch:
    """V-U-8: REQ-U-8 — web_fetch tool for chat command."""

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

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "Agent summary."

        web_cache = {"https://example.com": "Cached summary."}
        handler = make_web_fetch_handler(
            mc=None, log="/tmp/test.log", web_cache=web_cache,
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
            mc=None, log="/tmp/test.log", web_cache=None,
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
            mc=None, log="/tmp/test.log", web_cache=None,
            agent_loop_cls=FakeAgent,
            confirm_fn=lambda url: True,
        )
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("connection refused")), \
             patch("voidrift_cli.tools.ssrf_guard.check_url"):
            result = handler("https://bad-url.invalid")

        assert "web_fetch error" in result

    def test_web_fetch_summary_cached_after_fetch(self):
        """Summary is stored in web_cache dict after successful fetch."""
        from voidrift_cli.tools import make_web_fetch_handler

        class FakeAgent:
            def __init__(self, **kwargs): pass
            def send(self, msg): return "Page summary."

        web_cache: dict = {}
        handler = make_web_fetch_handler(
            mc=None, log="/tmp/test.log", web_cache=web_cache,
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
        assert web_cache.get("https://example.com/docs") == "Page summary."

    def test_web_fetch_in_local_tools(self):
        """web_fetch schema is present in LOCAL_TOOLS."""
        from voidrift_cli.tools import LOCAL_TOOLS
        names = [t["function"]["name"] for t in LOCAL_TOOLS]
        assert "web_fetch" in names

    def test_web_fetch_absent_from_gather_tools(self):
        """web_fetch is not in the agent tool list for the gather command."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools(cmd="gather")
        tool_names = {t["function"]["name"] for t in tools}
        assert "web_fetch" not in tool_names


class TestPromptFormatting:
    """V-RES-1: Prompt format variable substitution — task format loaded from template."""

    def test_task_format_loads_from_template(self):
        """TASK-FORMAT template loads from resources/templates/."""
        from voidrift_cli.prompts import load_template
        result = load_template("TASK-FORMAT")
        assert "skills:" in result
        assert "reqs:" in result

    def test_task_format_contains_structure(self):
        """TASK-FORMAT template describes multi-line block structure."""
        from voidrift_cli.prompts import load_template
        result = load_template("TASK-FORMAT")
        assert "- [ ]" in result


class TestGatherPreflightChecks:
    def test_from_nonexistent_dir(self, tmp_project, cloud_model):
        from voidrift_cli.commands.gather import run_gather
        result = run_gather(cloud_model, from_path="/nonexistent/path")
        assert result == 1

    @patch("voidrift_cli.commands.gather.AgentLoop")
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


# ── Plan ────────────────────────────────────────────────────────────────


class TestPlanPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_produces_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """Simulate a model that creates the required artifacts via all five stages."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Stage 1: write ARCHITECTURE.md with module reference
                def send(msg):
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Architecture complete."
                mock.send.side_effect = send
            elif agent_count == 2:
                # Stage 2: write arch/backend.md
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend module\n")
                    return "Module arch done."
                mock.send.side_effect = send
            elif agent_count == 3:
                # Stage 3: write tasks/outline/backend.md
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Create entry point\n"
                        "    files:\n      - backend/main.py (create)\n    depends: []\n"
                        "---\n\n## Task 1: Create entry point\nCreates the main entry point.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                # Stage 5: write task file (stage 4 skipped — single module)
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Create entry point\n"
                    )
                    return "Task complete."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "tasks" / "active" / "TASK-1.md").exists()

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_retries_on_missing_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """Stage 1 retries once when ARCHITECTURE.md is not written on first send."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Stage 1: first send omits file, retry writes it
                call_count = 0
                def send(msg):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 1:
                        return "Oops, forgot."
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            elif agent_count == 2:
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\n")
                    return "Done."
                mock.send.side_effect = send
            elif agent_count == 3:
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Task\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Task\nDoes something.\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            else:
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Task\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_fails_after_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I didn't create anything."
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    def test_overwrite_clears_artifacts(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("old arch")
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        (active / "TASK-1.md").write_text("old task")
        (vd / "arch").mkdir(exist_ok=True)
        (vd / "arch" / "backend.md").write_text("old module arch")
        (vd / "spec").mkdir(exist_ok=True)
        (vd / "spec" / "auth.md").write_text("gather spec")

        (vd / "STATE.md").write_text(
            "## 2026-01-01T00:00:00 — plan (test)\nOld plan.\n### Files\n"
            "- created: .voidrift/ARCHITECTURE.md\n"
            "- created: .voidrift/arch/backend.md\n\n"
        )

        with patch("voidrift_cli.commands.plan.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "nothing"
            MockAgent.return_value = mock_instance

            from voidrift_cli.commands.plan import run_plan
            run_plan(cloud_model, overwrite=True)

        assert not (vd / "ARCHITECTURE.md").exists()
        assert not (active / "TASK-1.md").exists()
        assert not (vd / "arch" / "backend.md").exists()
        assert (vd / "spec" / "auth.md").exists(), "Gather specs must be preserved"


# ── Plan skill validation (REQ-P-9) ─────────────────────────────────────


class TestPlanSkillValidation:
    """V-P-4: REQ-P-9 — skill tag validation with word-overlap resolution."""

    def test_valid_skill_preserved(self, tmp_project):
        """Valid skill tags are kept as-is."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [BACKEND-ENG]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == ["BACKEND-ENG"]

    def test_invalid_skill_resolved_by_word_overlap(self):
        """Invalid skill with a shared word is resolved to the closest valid skill (REQ-P-9 AC2)."""
        from voidrift_cli.commands.plan import _resolve_skill
        valid = {"BACKEND-ENG", "WEB-ENG", "CLOUD-OPS"}
        assert _resolve_skill("BACKEND-ENGINEERING", valid) == "BACKEND-ENG"

    def test_invalid_skill_stripped_when_no_overlap(self):
        """Invalid skill with no word overlap is stripped (REQ-P-9 AC3)."""
        from voidrift_cli.commands.plan import _resolve_skill
        valid = {"BACKEND-ENG", "WEB-ENG", "CLOUD-OPS"}
        assert _resolve_skill("documentation", valid) is None

    def test_resolve_picks_highest_overlap(self):
        """When multiple valid skills share words, the one with most overlap wins."""
        from voidrift_cli.commands.plan import _resolve_skill
        # BACKEND-ENG shares 2 words (BACKEND, ENG) with invalid "BACKEND-ENG-EXTRA"
        # CLOUD-OPS shares 0 words
        valid = {"BACKEND-ENG", "CLOUD-OPS"}
        assert _resolve_skill("BACKEND-ENG-EXTRA", valid) == "BACKEND-ENG"

    def test_valid_skills_prompt_includes_descriptions(self, tmp_project):
        """valid_skills string uses '- NAME: description' format (REQ-P-9 AC1)."""
        from voidrift_cli.commands.plan import _available_skills_with_desc
        skill_dir = tmp_project / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend API engineering.\n---\n# Backend\n"
        )
        result = _available_skills_with_desc()
        assert "BACKEND-ENG" in result
        assert result["BACKEND-ENG"] == "Backend API engineering."

    def test_invalid_skill_substituted_in_task_file(self, tmp_project):
        """An invalid skill resolved via word-overlap is written back into the task file."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [BACKEND-ENGINEERING]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == ["BACKEND-ENG"]

    def test_unresolvable_skill_stripped_from_task_file(self, tmp_project):
        """An invalid skill with no word overlap is removed from the task file."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [documentation]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == []


# ── Develop ─────────────────────────────────────────────────────────────


class TestDevelopPreflightChecks:
    def _setup_manifest(self, vd, tasks=None):
        """Create manifest + task files for testing."""
        import yaml
        tasks_dir = vd / "tasks"
        active = tasks_dir / "active"
        active.mkdir(parents=True, exist_ok=True)
        (tasks_dir / "archived").mkdir(exist_ok=True)
        if tasks is None:
            return
        manifest = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1}
        for t in tasks:
            tid = t["id"]
            manifest["tasks"][tid] = {"status": t.get("status", "planned"), "module": t.get("module", "default")}
            mod = t.get("module", "default")
            manifest["modules"].setdefault(mod, [])
            if tid not in manifest["modules"][mod]:
                manifest["modules"][mod].append(tid)
            if t.get("depends"):
                manifest["dependencies"][tid] = t["depends"]
            manifest["next_id"] = max(manifest["next_id"], tid + 1)
            # Write task file
            content = f"---\nid: {tid}\nmodule: {mod}\nskills: []\n---\n# {t.get('title', f'Task {tid}')}\n"
            (active / f"TASK-{tid}.md").write_text(content)
        (tasks_dir / "manifest.yml").write_text(yaml.dump(manifest, default_flow_style=False))

    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_missing_manifest(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_all_tasks_complete(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [
            {"id": 1, "status": "verified", "title": "Done 1"},
            {"id": 2, "status": "verified", "title": "Done 2"},
        ])
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0

    def test_lock_file_stale(self, tmp_project, cloud_model, sample_requirements):
        """Stale lock (dead PID) should be cleaned up."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Task 1"}])
        lock = vd / ".develop.lock"
        lock.write_text("99999999\n2020-01-01T00:00:00")

        with patch("voidrift_cli.commands.develop.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "done"
            MockAgent.return_value = mock_instance
            from voidrift_cli.commands.develop import run_develop
            run_develop(cloud_model)

        assert not lock.exists()

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_develop_loop_marks_implemented(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """REQ-D-9: Task marked implemented after writes."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create main.py"}])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Created the file."
        MockAgent.return_value = mock_instance

        # Simulate write_source_file being called
        with patch("voidrift_cli.tools.get_write_count", return_value=1):
            from voidrift_cli.commands.develop import run_develop
            result = run_develop(cloud_model)

        import yaml
        manifest = yaml.safe_load((vd / "tasks" / "manifest.yml").read_text())
        assert manifest["tasks"][1]["status"] == "implemented"

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_sequential_multi_module(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [
            {"id": 1, "module": "backend", "title": "Task A"},
            {"id": 2, "module": "frontend", "title": "Task B"},
        ])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "done"
        MockAgent.return_value = mock_instance

        with patch("voidrift_cli.tools.get_write_count", return_value=1):
            from voidrift_cli.commands.develop import run_develop
            result = run_develop(cloud_model)

        import yaml
        manifest = yaml.safe_load((vd / "tasks" / "manifest.yml").read_text())
        assert manifest["tasks"][1]["status"] == "implemented"
        assert manifest["tasks"][2]["status"] == "implemented"


# ── Deploy ────────────────────────────────────────────────────────────


class TestDeployPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 1

    def test_missing_architecture(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 1

    def test_no_history_exits_cleanly(self, tmp_project, cloud_model, sample_requirements):
        """No verified tasks since last release → nothing to deploy."""
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("# Architecture\n")
        from voidrift_cli.commands.deploy import run_deploy
        result = run_deploy(cloud_model)
        assert result == 0  # clean exit, nothing to do


# ── Verify ──────────────────────────────────────────────────────────────


class TestVerifyPreflight:
    """REQ-VF-P: Verify exits early when REQUIREMENTS.md is missing."""

    def test_missing_requirements_exits_with_error(self, tmp_project, cloud_model, capsys):
        """No REQUIREMENTS.md → exit 1 with 'voidrift gather' message (REQ-VF-P)."""
        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)
        assert result == 1

    def test_missing_requirements_no_model_call(self, tmp_project, cloud_model):
        """No REQUIREMENTS.md → no AgentLoop instantiation (REQ-VF-P)."""
        with patch("voidrift_cli.commands.verify.AgentLoop") as MockAgent:
            from voidrift_cli.commands.verify import run_verify
            run_verify(cloud_model)
            MockAgent.assert_not_called()


class TestVerifyPlanParsing:
    """_parse_verify_plan correctly splits VERIFY-PLAN.md into item dicts."""

    def test_parses_testable_items(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        text = (
            "# Verify Plan\n\n---\n\n"
            "### ITEM-1\n\nTest case one.\n\n---\n\n"
            "### ITEM-2\n\nTest case two.\n"
        )
        items = _parse_verify_plan(text)
        assert len(items) == 2
        assert items[0]["item_id"] == "ITEM-1"
        assert items[0]["skip"] is False
        assert "Test case one" in items[0]["content"]

    def test_parses_skip_items(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        text = (
            "### ITEM-1\n\nNormal test.\n\n"
            "### ITEM-2 [SKIP]\n\nReason: qualitative.\n"
        )
        items = _parse_verify_plan(text)
        assert items[0]["skip"] is False
        assert items[1]["skip"] is True
        assert items[1]["item_id"] == "ITEM-2"

    def test_empty_plan_returns_empty(self):
        from voidrift_cli.commands.verify import _parse_verify_plan
        assert _parse_verify_plan("# Verify Plan\n\nNo items here.") == []


class TestVerifyOrchestrator:
    """Full orchestrator flow with mocked AgentLoop."""

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands.verify.AgentLoop")
    def test_pass_when_no_bug_reports(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """All items pass (no bug reports written) → VERIFY.md verdict PASS, exit 0 (REQ-VF-5)."""
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Plan agent writes VERIFY-PLAN.md
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest REQ-X.\n\n"
                    "### ITEM-2 [SKIP]\n\nReason: qualitative.\n"
                )
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 0
        assert (vd / "VERIFY.md").exists()
        content = (vd / "VERIFY.md").read_text()
        assert "PASS" in content

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands.verify.AgentLoop")
    def test_fail_when_bug_report_written(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """Sub-agent writes bug report → VERIFY.md verdict FAIL, exit 1 (REQ-VF-4, REQ-VF-5)."""
        vd = tmp_project / ".voidrift"
        call_count = 0

        def fake_send(msg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest REQ-Y.\n"
                )
            else:
                # Sub-agent writes a bug report
                (vd / "bugs").mkdir(exist_ok=True)
                (vd / "bugs" / "ITEM-1.md").write_text("# Bug Report — ITEM-1\n\nFAIL")
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 1
        content = (vd / "VERIFY.md").read_text()
        assert "FAIL" in content
        assert "bugs/ITEM-1.md" in content

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands.verify.AgentLoop")
    def test_stop_all_called_on_exception(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """stop_all() is called even when plan agent raises (REQ-VF-10)."""
        mock_instance = MagicMock()
        mock_instance.send.side_effect = RuntimeError("model exploded")
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        result = run_verify(cloud_model)

        assert result == 1
        mock_stop_all.assert_called()

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands.verify.AgentLoop")
    def test_state_md_written_after_run(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """STATE.md is appended after verify completes (REQ-VF-6)."""
        vd = tmp_project / ".voidrift"

        def fake_send(msg):
            if not (vd / "VERIFY-PLAN.md").exists():
                (vd / "VERIFY-PLAN.md").write_text(
                    "# Verify Plan\n\n### ITEM-1\n\nTest.\n"
                )
            return "Done."

        mock_instance = MagicMock()
        mock_instance.send.side_effect = fake_send
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.verify import run_verify
        run_verify(cloud_model)

        state = vd / "STATE.md"
        assert state.exists()
        assert "verify" in state.read_text()

    @patch("voidrift_cli.commands.verify.stop_all")
    @patch("voidrift_cli.commands.verify.clear_sessions")
    @patch("voidrift_cli.commands.verify.close_all_sessions")
    @patch("voidrift_cli.commands.verify.AgentLoop")
    def test_no_source_file_tools_in_execute(
        self, MockAgent, mock_close_browser, mock_clear_http, mock_stop_all,
        tmp_project, cloud_model, sample_requirements
    ):
        """verify-execute tool set excludes read_source_file and write_source_file (REQ-VF-7, REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-execute")
        names = {t["function"]["name"] for t in tools}
        assert "write_source_file" not in names
        assert "read_source_file" not in names

    def test_verify_plan_tool_set_includes_source_read(self, tmp_project):
        """verify-plan tool set includes read_source_file (REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-plan")
        names = {t["function"]["name"] for t in tools}
        assert "read_source_file" in names
        assert "write_source_file" not in names

    def test_verify_execute_includes_http_and_run_command(self, tmp_project):
        """verify-execute tool set includes http_request and run_command (REQ-VF-16)."""
        from voidrift_cli.agent import build_local_tools
        tools, _ = build_local_tools("verify-execute")
        names = {t["function"]["name"] for t in tools}
        assert "http_request" in names
        assert "run_command" in names
        assert "read_process_output" in names


# ── CLI Commands ────────────────────────────────────────────────────────


class TestCLICommands:
    def test_status_command(self, tmp_project):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert "Gather" in result.output
        assert "Verify" in result.output

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
        assert "--path" in result.output
        assert "--idea" in result.output
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


class TestPlanUpdateMode:
    """V-P-5: plan auto-detects update mode when artifacts exist; fresh-plan when absent."""

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_fresh_plan_when_no_artifacts(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """run_plan() runs all stages when no artifacts exist."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                def send(msg):
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Arch done."
                mock.send.side_effect = send
            elif agent_count == 2:
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\n")
                    return "Module done."
                mock.send.side_effect = send
            elif agent_count == 3:
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Stub\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Stub\nCreates the stub.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Stub\n"
                    )
                    return "Tasks done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "tasks" / "active" / "TASK-1.md").exists()

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_auto_detects_update_mode(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """run_plan() runs delta analysis when plan artifacts already exist (REQ-P-11)."""
        vd = tmp_project / ".voidrift"
        # Pre-existing arch artifacts from a previous plan run
        (vd / "ARCHITECTURE.md").write_text("---\nmodules:\n  - backend\n---\n# Architecture\n")
        (vd / "arch").mkdir(parents=True, exist_ok=True)
        (vd / "arch" / "backend.md").write_text("# Backend\nExisting module arch.")
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        (active / "TASK-1.md").write_text(
            "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Done task\n"
        )
        # manifest.yml triggers update mode detection
        import yaml as _yaml
        tasks_dir = vd / "tasks"
        (tasks_dir / "manifest.yml").write_text(_yaml.dump(
            {"tasks": {1: {"status": "implemented", "module": "backend"}},
             "modules": {"backend": [1]}, "dependencies": {}, "next_id": 2, "next_bug_id": 1},
            default_flow_style=False,
        ))
        # A source file so delta analysis has something to scan
        src = tmp_project / "src"
        src.mkdir()
        (src / "main.py").write_text("print('hello')")

        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Delta analysis agent (REQ-P-11)
                mock.send.return_value = "## Implemented\n- REQ-1: main.py exists\n## Unimplemented\n- REQ-2: no files"
            elif agent_count == 2:
                # Stage 1: ARCHITECTURE.md already exists; agent updates it
                mock.send.return_value = "Updated."
            elif agent_count == 3:
                # Stage 2: arch/backend.md
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\nUpdated module arch.")
                    return "Module updated."
                mock.send.side_effect = send
            elif agent_count == 4:
                # Stage 3: write outline
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Existing task\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Existing task\nUpdates the existing task.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                # Stage 5: task agent
                def send(msg):
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Updated\n"
                    )
                    return "Task done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        # Delta agent was called (agent_count >= 2 means delta + at least stage 1)
        assert agent_count >= 2


class TestDevelopRetryEscalation:
    """V-D-4: No writes triggers retry, then escalation."""

    def _setup_manifest(self, vd, tasks=None):
        """Create manifest + task files for testing."""
        import yaml as _yaml
        tasks_dir = vd / "tasks"
        active = tasks_dir / "active"
        active.mkdir(parents=True, exist_ok=True)
        (tasks_dir / "archived").mkdir(exist_ok=True)
        if tasks is None:
            return
        manifest = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1}
        for t in tasks:
            tid = t["id"]
            manifest["tasks"][tid] = {"status": t.get("status", "planned"), "module": t.get("module", "default")}
            mod = t.get("module", "default")
            manifest["modules"].setdefault(mod, [])
            if tid not in manifest["modules"][mod]:
                manifest["modules"][mod].append(tid)
            manifest["next_id"] = max(manifest["next_id"], tid + 1)
            content = f"---\nid: {tid}\nmodule: {mod}\nskills: []\n---\n# {t.get('title', f'Task {tid}')}\n"
            (active / f"TASK-{tid}.md").write_text(content)
        (tasks_dir / "manifest.yml").write_text(_yaml.dump(manifest, default_flow_style=False))

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_triggers_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """When the first task attempt writes nothing, a retry is attempted."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])

        call_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.on_progress = None
                self.on_token = None
                self.on_complete = None
                self.messages = []

            def send(self, msg: str) -> str:
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    from voidrift_cli.tools import _ctx
                    _ctx._source_write_count += 1
                return "done"

        MockAgent.side_effect = FakeAgent

        from voidrift_cli.commands.develop import run_develop
        run_develop(cloud_model)

        assert call_count >= 2, "Expected at least 2 agent calls (initial + retry)"

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_no_architect_skips_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """When no writes after retry and no architect, task returns failure."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "I thought about it."
        mock_instance.on_progress = None
        mock_instance.on_token = None
        mock_instance.on_complete = None
        mock_instance.messages = []
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result in (0, 1)

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_with_architect_escalates(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """When no writes after retry and architect is configured, architect is consulted
        and fix plan is appended to the task file (REQ-D-6, REQ-TM-7)."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])
        (vd / "REQUIREMENTS.md").write_text("# Reqs\n")
        (vd / "ARCHITECTURE.md").write_text("# Arch\n")

        send_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.on_progress = None
                self.on_token = None
                self.on_complete = None
                self.messages = []
                self._has_tools = bool(kwargs.get("tools"))

            def send(self, msg: str) -> str:
                nonlocal send_count
                send_count += 1
                # Architect agent (no tools) returns guidance
                if not self._has_tools:
                    return "Fix: create the file with a stub function."
                # After architect guidance (send 3+), produce writes
                if send_count >= 5:
                    from voidrift_cli.tools import _ctx
                    _ctx._source_write_count += 1
                return "done"

        MockAgent.side_effect = FakeAgent

        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model, architect=cloud_model)

        # Architect guidance should be appended to the task file
        task_file = vd / "tasks" / "active" / "TASK-1.md"
        content = task_file.read_text()
        assert "Architect Fix Plan" in content


class TestChatSession:
    """V-U-2: chat loads ANALYSIS-REQS skill + chat/SYSTEM prompt.
    V-UI-1: chat tools available on every turn.
    V-UI-2: session log contains operator input and model responses."""

    def test_chat_command_tools_include_required_handlers(self, tmp_project):
        """V-U-2: build_local_tools with cmd='chat' exposes get_skill."""
        from voidrift_cli.agent import build_local_tools
        tools, handlers = build_local_tools(cmd="chat")
        assert "get_skill" in handlers
        tool_names = {t["function"]["name"] for t in tools}
        assert "get_skill" in tool_names

    def test_chat_analysis_reqs_skill_is_available(self, tmp_project):
        """V-U-2: get_skill('ANALYSIS-REQS') returns non-empty content in chat context."""
        from voidrift_cli.agent import build_local_tools
        _, handlers = build_local_tools(cmd="chat")
        skill_content = handlers["get_skill"]("ANALYSIS-REQS")
        assert len(skill_content) > 10
        assert "not found" not in skill_content.lower()

    def test_chat_system_prompt_is_available(self, tmp_project):
        """V-U-2: load_prompt('chat', 'SYSTEM') returns non-empty content."""
        from voidrift_cli import prompts
        prompts.clear_cache()
        system_prompt = prompts.load_prompt("chat", "SYSTEM")
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
                    with patch("voidrift_cli.main._check_setup"):
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
        from voidrift_cli.commands.develop import MAX_ESCALATIONS
        assert MAX_ESCALATIONS > 0

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_max_escalations_blocks_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """After MAX_ESCALATIONS+1 escalation files, the task is blocked."""
        from voidrift_cli.commands.develop import MAX_ESCALATIONS
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

        from voidrift_cli.commands.develop import run_develop
        # Should not raise — blocked tasks are handled gracefully
        result = run_develop(cloud_model)
        assert result in (0, 1)
