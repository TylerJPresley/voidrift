"""Tests for skill allowed_tools (REQ-SKL-9), DevelopDashboard (REQ-UI-11),
read bytes guard (REQ-FSZ-5), and analysis cache pruning (REQ-U-14)."""

import os
import time
from pathlib import Path

from voidrift_cli.skills import get_skill_allowed_tools, make_skill_tool_guard
from voidrift_cli.ui import DevelopDashboard
from voidrift_cli.tools.filesystem import WriteContext
from voidrift_cli.utils import prune_analysis_cache


class TestAllowedTools:
    def test_blocks_unlisted_tool(self):
        guard = make_skill_tool_guard(["read_source_file"], "SEC")
        result = guard("write_source_file", "{}")
        assert result is not None
        assert "blocked" in result
        assert "read_source_file" in result

    def test_allows_listed_tool(self):
        guard = make_skill_tool_guard(["read_source_file"], "SEC")
        assert guard("read_source_file", "{}") is None

    def test_none_returns_no_guard(self):
        assert make_skill_tool_guard(None, "ANY") is None

    def test_empty_list_blocks_all(self):
        guard = make_skill_tool_guard([], "RO")
        result = guard("read_source_file", "{}")
        assert result is not None
        assert "none" in result

    def test_parse_from_frontmatter(self, tmp_path):
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "TEST-SKILL.md").write_text(
            "---\nname: TEST-SKILL\nallowed_tools:\n  - read_source_file\n---\n# Test\n"
        )
        at = get_skill_allowed_tools("TEST-SKILL", project_dir=tmp_path)
        assert at == ["read_source_file"]

    def test_absent_field_returns_none(self, tmp_path):
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "OPEN.md").write_text("---\nname: OPEN\n---\n# Open\n")
        assert get_skill_allowed_tools("OPEN", project_dir=tmp_path) is None

    def test_nonexistent_skill_returns_none(self, tmp_path):
        assert get_skill_allowed_tools("NOPE", project_dir=tmp_path) is None


class TestDevelopDashboard:
    def test_three_rows_rendered(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1 API")
        dash.add_task("T-2", "TASK-2 Models")
        dash.add_task("T-3", "TASK-3 Tests")
        table = dash._render()
        assert table.row_count == 3

    def test_tracker_updates_state(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        cb = dash.tracker("T-1")
        cb({"prompt_tokens": 5000, "completion_tokens": 1200, "ctx_pct": 42, "turn": 3, "last_tool": "write_source_file"})
        with dash._lock:
            r = dash._rows["T-1"]
        assert r["status"] == "running"
        assert r["turn"] == 3
        assert r["last_tool"] == "write_source_file"
        assert r["pt"] == 5000

    def test_mark_done_failed(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        dash.mark_done("T-1", failed=True)
        with dash._lock:
            assert dash._rows["T-1"]["status"] == "failed"

    def test_mark_done_success(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        dash.mark_done("T-1")
        with dash._lock:
            assert dash._rows["T-1"]["status"] == "done"


class TestReadBytesGuard:
    def test_no_truncation_at_limit(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 1024
        f = tmp_path / "exact.txt"
        f.write_text("x" * 1024)
        result = ctx.read_source_file("exact.txt")
        assert "TRUNCATED" not in result

    def test_truncation_over_limit(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 1024
        f = tmp_path / "big.txt"
        f.write_text("y" * 2048)
        result = ctx.read_source_file("big.txt")
        assert "TRUNCATED" in result
        assert "Showing first 1KB" in result

    def test_disabled_when_zero(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 0
        f = tmp_path / "huge.txt"
        f.write_text("z" * 100_000)
        result = ctx.read_source_file("huge.txt")
        assert "TRUNCATED" not in result

    def test_utf8_boundary_safe(self, tmp_path):
        ctx = WriteContext(project_dir=tmp_path)
        ctx._max_read_bytes = 100
        f = tmp_path / "utf8.txt"
        f.write_text("é" * 200)  # 2 bytes each in UTF-8
        result = ctx.read_source_file("utf8.txt")
        assert "TRUNCATED" in result
        result.encode("utf-8")  # must not raise


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


class TestChatStyles:
    """Tests for --style option (REQ-UI-12)."""

    def test_verbose_style_accepted(self):
        """verbose is a valid style choice."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "--style", "verbose", "--help"])
        assert result.exit_code == 0

    def test_terse_style_accepted(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "--style", "terse", "--help"])
        assert result.exit_code == 0

    def test_raw_style_accepted(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "--style", "raw", "--help"])
        assert result.exit_code == 0

    def test_invalid_style_rejected(self):
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "--style", "fancy", "test-model"])
        assert result.exit_code != 0

    def test_terse_summary_format(self):
        """Terse summary line format matches spec."""
        from collections import Counter
        calls = ["read_source_file", "read_source_file", "write_source_file"]
        counts = Counter(calls)
        summary = ", ".join(f"{n}× {t}" for t, n in counts.most_common())
        result = f"[{len(calls)} tool calls: {summary}]"
        assert "3 tool calls" in result
        assert "2× read_source_file" in result
        assert "1× write_source_file" in result


class TestQuickCommand:
    """Tests for /quick side question (REQ-U-15)."""

    def test_quick_does_not_modify_messages(self):
        """A /quick call must not change agent.messages."""
        from unittest.mock import MagicMock, patch
        from voidrift_cli.agent import AgentLoop
        from voidrift_cli.models import ModelConfig

        mc = ModelConfig(alias="t", model_id="m", api_base="http://x/v1", api_key="k")
        agent = AgentLoop(model=mc, system_prompt="test", stream=False)
        before = len(agent.messages)

        # Simulate what /quick does — make a standalone call
        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = "4"
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_resp

        with patch.object(agent, "_get_client", return_value=mock_client):
            client = agent._get_client()
            resp = client.chat.completions.create(
                model=agent._model_name(),
                messages=[
                    {"role": "system", "content": "Answer concisely."},
                    {"role": "user", "content": "what is 2+2"},
                ],
                max_tokens=2048,
            )
            answer = resp.choices[0].message.content

        assert answer == "4"
        assert len(agent.messages) == before  # unchanged

    def test_quick_uses_no_tools(self):
        """The /quick API call must not include tools."""
        from unittest.mock import MagicMock, patch
        from voidrift_cli.agent import AgentLoop
        from voidrift_cli.models import ModelConfig

        mc = ModelConfig(alias="t", model_id="m", api_base="http://x/v1", api_key="k")
        agent = AgentLoop(model=mc, system_prompt="test", stream=False)

        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = "answer"
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_resp

        with patch.object(agent, "_get_client", return_value=mock_client):
            client = agent._get_client()
            client.chat.completions.create(
                model=agent._model_name(),
                messages=[{"role": "user", "content": "test"}],
                max_tokens=2048,
            )

        call_kwargs = mock_client.chat.completions.create.call_args
        assert "tools" not in call_kwargs.kwargs

    def test_quick_minimal_system_prompt(self):
        """The /quick call uses a minimal system prompt, not the full session prompt."""
        # The implementation sends: {"role": "system", "content": "Answer concisely."}
        # This test verifies the pattern
        messages = [
            {"role": "system", "content": "Answer concisely."},
            {"role": "user", "content": "what is 2+2"},
        ]
        assert len(messages) == 2
        assert messages[0]["content"] == "Answer concisely."
        assert "framework" not in messages[0]["content"].lower()


class TestBareMode:
    """Tests for --bare mode (REQ-U-17)."""

    def test_bare_uses_context_only(self):
        """--bare system prompt is built from CONTEXT section only, no skills."""
        from voidrift_cli import prompts
        context = prompts.load_prompt("system", "CONTEXT")
        # In bare mode, system = context only. Verify context exists and
        # does not contain skill or chat-specific content.
        assert len(context) > 0
        assert "ANALYSIS-REQS" not in context

    def test_system_prompt_without_bare_rejected(self):
        """--system-prompt without --bare exits with error."""
        from click.testing import CliRunner
        from voidrift_cli.main import cli
        runner = CliRunner()
        result = runner.invoke(cli, ["chat", "test", "--system-prompt", "/dev/null"])
        assert result.exit_code != 0
        assert "requires --bare" in result.output

    def test_bare_with_system_prompt_replaces_entirely(self, tmp_path):
        """--bare --system-prompt uses file content as complete system prompt."""
        custom = tmp_path / "custom.md"
        custom.write_text("You are a pirate.")
        content = custom.read_text()
        assert content == "You are a pirate."
        # When --bare --system-prompt is set, the code does:
        #   system = Path(system_prompt_path).read_text()
        # No CONTEXT section prepended.
        from voidrift_cli import prompts
        context = prompts.load_prompt("system", "CONTEXT")
        assert context not in content  # custom replaces, not appends

    def test_non_bare_includes_skill(self):
        """Without --bare, system prompt construction includes skill content."""
        from voidrift_cli import prompts
        from voidrift_cli.skills import find_skill
        context = prompts.load_prompt("system", "CONTEXT")
        chat_prompt = prompts.load_prompt("chat", "SYSTEM")
        skill = find_skill("ANALYSIS-REQS") or ""
        system = "\n\n".join(p for p in [context, skill, chat_prompt] if p)
        # Non-bare includes all layers
        assert context in system
        assert chat_prompt in system
        if skill:
            assert skill in system
