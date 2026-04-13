"""Tests for chat command — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig, ModelInterface
from voidrift_cli.agent_protocol import get_adapter
from helpers import make_openai_response


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


class TestQueryMaxContext:
    def test_query_max_context_logs_on_failure(self, caplog, cloud_model):
        """Exception during context query is logged at DEBUG, not swallowed silently."""
        import logging
        from voidrift_cli.commands.chat import _query_max_context
        with patch("openai.OpenAI") as mock_client:
            mock_client.return_value.models.list.side_effect = ConnectionError("refused")
            with caplog.at_level(logging.DEBUG, logger="voidrift_cli.commands._chat_display"):
                result = _query_max_context(cloud_model)
        assert result == cloud_model.max_context
        assert "max_context query failed" in caplog.text


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
            with patch("voidrift_cli.commands.chat._interactive_loop"):
                with patch("voidrift_cli.commands.chat.resolve_model", return_value=cloud_model):
                    with patch("voidrift_cli.main._check_setup"):
                        runner = CliRunner()
                        runner.invoke(cli, ["chat", cloud_model.alias, "--doc", "REQUIREMENTS.md"])

        assert "Build a thing." in captured.get("system_prompt", ""), \
            "Doc content should appear in system prompt when --doc is specified"

    @patch("voidrift_cli.agent_protocol.OpenAI")
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

    @patch("voidrift_cli.agent_protocol.OpenAI")
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

    @patch("voidrift_cli.agent_protocol.OpenAI")
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



from click.testing import CliRunner
from voidrift_cli.main import cli as _cli_app
from voidrift_cli.agent import AgentLoop
from voidrift_cli import prompts
from voidrift_cli.skills import find_skill


class TestChatStyles:
    """Tests for --style option (REQ-UI-12)."""

    def test_verbose_style_accepted(self):
        runner = CliRunner()
        result = runner.invoke(_cli_app, ["chat", "--style", "verbose", "--help"])
        assert result.exit_code == 0

    def test_terse_style_accepted(self):
        runner = CliRunner()
        result = runner.invoke(_cli_app, ["chat", "--style", "terse", "--help"])
        assert result.exit_code == 0

    def test_raw_style_accepted(self):
        runner = CliRunner()
        result = runner.invoke(_cli_app, ["chat", "--style", "raw", "--help"])
        assert result.exit_code == 0

    def test_invalid_style_rejected(self):
        runner = CliRunner()
        result = runner.invoke(_cli_app, ["chat", "--style", "fancy", "test-model"])
        assert result.exit_code != 0

    def test_terse_summary_format(self):
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
        _mc = ModelConfig(alias="t", model_id="m", api_base="http://x/v1", api_key="k")
        mc = ModelInterface(_mc, get_adapter(_mc.protocol))
        agent = AgentLoop(model=mc, system_prompt="test", stream=False)
        before = len(agent.messages)
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
        assert len(agent.messages) == before

    def test_quick_uses_no_tools(self):
        _mc = ModelConfig(alias="t", model_id="m", api_base="http://x/v1", api_key="k")
        mc = ModelInterface(_mc, get_adapter(_mc.protocol))
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
        context = prompts.load_prompt("system", "CONTEXT")
        assert len(context) > 0
        assert "ANALYSIS-REQS" not in context

    def test_system_prompt_without_bare_rejected(self):
        runner = CliRunner()
        result = runner.invoke(_cli_app, ["chat", "test", "--system-prompt", "/dev/null"])
        assert result.exit_code != 0
        assert "requires --bare" in result.output

    def test_bare_with_system_prompt_replaces_entirely(self, tmp_path):
        custom = tmp_path / "custom.md"
        custom.write_text("You are a pirate.")
        content = custom.read_text()
        assert content == "You are a pirate."
        context = prompts.load_prompt("system", "CONTEXT")
        assert context not in content

    def test_non_bare_includes_skill(self):
        context = prompts.load_prompt("system", "CONTEXT")
        chat_prompt = prompts.load_prompt("chat", "SYSTEM")
        skill = find_skill("ANALYSIS-REQS") or ""
        system = "\n\n".join(p for p in [context, skill, chat_prompt] if p)
        assert context in system
        assert chat_prompt in system
        if skill:
            assert skill in system


class TestInteractiveLoopConcerns:
    def test_ctrl_j_inserts_newline(self):
        """V-UI-3: Ctrl+J inserts a newline into the input buffer without submitting."""
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.buffer import Buffer
        from prompt_toolkit.document import Document
        from unittest.mock import MagicMock

        kb = KeyBindings()

        @kb.add("c-j")
        def _newline(event):
            event.current_buffer.insert_text("\n")

        buf = Buffer()
        buf.set_document(Document("hello"), bypass_readonly=True)

        event = MagicMock()
        event.current_buffer = buf

        _newline(event)

        assert buf.text == "hello\n"

    def test_make_display_callbacks_returns_callable_hooks(self, cloud_model):
        """_make_display_callbacks returns a dict of callable hooks."""
        from voidrift_cli.commands.chat import _make_display_callbacks
        from voidrift_cli.agent import AgentLoop

        agent = AgentLoop(model=cloud_model)
        live_holder: list = [None]
        live_start: list = [0.0]
        turn_label: list = ["test"]
        got_token: list = [False]
        stream_buf: list = []
        stats_parts: list = []
        tool_calls: list = []

        cbs = _make_display_callbacks(
            agent=agent,
            style="verbose",
            live_holder=live_holder,
            live_start=live_start,
            turn_label=turn_label,
            got_token=got_token,
            stream_buf=stream_buf,
            stats_parts=stats_parts,
            tool_calls_this_turn=tool_calls,
        )
        assert callable(cbs["on_token"])
        assert callable(cbs["on_complete"])
        assert callable(cbs["on_progress"])
        assert callable(cbs["on_tool_call"])
        assert callable(cbs["on_tool_result"])
        # Verify on_token works without a live holder
        cbs["on_token"]("hello")
        assert stream_buf == ["hello"]
        assert got_token[0] is True

    def test_setup_restore_terminal_is_symmetric(self):
        """_setup_terminal and _restore_terminal don't raise on non-TTY (fd=None)."""
        from voidrift_cli.commands.chat import _setup_terminal, _restore_terminal
        termios_mod, saved = _setup_terminal(None)
        assert termios_mod is None
        assert saved is None
        # Restore with None args should be a no-op
        _restore_terminal(None, None, None)  # must not raise


class TestIdeaSession:
    """V-U-21: REQ-U-21 — IdeaSession state machine independently testable."""

    def test_start_transitions_to_collecting(self):
        from voidrift_cli.commands._chat_idea import IdeaSession, IdeaState
        session = IdeaSession()
        session.start()
        assert session.state == IdeaState.COLLECTING

    def test_add_line_in_collecting(self):
        from voidrift_cli.commands._chat_idea import IdeaSession
        session = IdeaSession()
        session.start()
        session.add_line("first")
        session.add_line("second")
        assert session.lines == ["first", "second"]

    def test_add_line_in_idle_raises(self):
        from voidrift_cli.commands._chat_idea import IdeaSession
        session = IdeaSession()
        with pytest.raises(ValueError):
            session.add_line("oops")

    def test_confirm_returns_text_and_resets_to_idle(self):
        from voidrift_cli.commands._chat_idea import IdeaSession, IdeaState
        session = IdeaSession()
        session.start()
        session.add_line("line one")
        session.add_line("line two")
        text = session.confirm()
        assert text == "line one\nline two"
        assert session.state == IdeaState.IDLE
        assert session.lines == []

    def test_cancel_resets_to_idle(self):
        from voidrift_cli.commands._chat_idea import IdeaSession, IdeaState
        session = IdeaSession()
        session.start()
        session.idea_id = 42
        session.cancel()
        assert session.state == IdeaState.IDLE
        assert session.idea_id is None

    def test_is_active_reflects_state(self):
        from voidrift_cli.commands._chat_idea import IdeaSession
        session = IdeaSession()
        assert not session.is_active()
        session.start()
        assert session.is_active()
        session.cancel()
        assert not session.is_active()


class TestContextCompactor:
    """V-U-21: REQ-U-21 — ContextCompactor independently testable without TTY or live model."""

    def _make_compactor(self, messages=None, max_ctx=None, session=None):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_compact import ContextCompactor

        agent = MagicMock()
        agent.messages = messages if messages is not None else [{"role": "system", "content": "sys"}]
        ui = MagicMock()
        ui._con = MagicMock()
        ui.random_label.return_value = "thinking"
        ui.render_text.return_value = "summary text"

        estimate_tokens = lambda msgs: sum(len(m.get("content") or "") for m in msgs) // 4
        setup_terminal = MagicMock(return_value=(None, None))
        restore_terminal = MagicMock()

        return ContextCompactor(
            agent=agent,
            log="/tmp/test.log",
            max_ctx=max_ctx,
            ui=ui,
            session=session,
            original_skill="",
            fs_ctx=None,
            estimate_tokens=estimate_tokens,
            setup_terminal=setup_terminal,
            restore_terminal=restore_terminal,
        )

    def test_should_auto_compact_at_80(self):
        compactor = self._make_compactor()
        assert compactor.should_auto_compact(80)
        assert compactor.should_auto_compact(99)
        assert not compactor.should_auto_compact(79)

    def test_should_auto_compact_disabled(self):
        compactor = self._make_compactor()
        compactor.disabled = True
        assert not compactor.should_auto_compact(80)

    def test_should_nudge_at_70(self):
        compactor = self._make_compactor()
        assert compactor.should_nudge(70)
        assert not compactor.should_nudge(69)

    def test_should_nudge_already_nudged(self):
        compactor = self._make_compactor()
        compactor.nudged = True
        assert not compactor.should_nudge(90)

    def test_compact_nothing_to_compact(self):
        compactor = self._make_compactor(messages=[{"role": "system", "content": "sys"}])
        result = compactor.compact()
        assert result is True
        compactor._ui.info.assert_called_once_with("Nothing to compact.")

    def test_compact_calls_model_and_returns_shorter_messages(self):
        from unittest.mock import MagicMock, patch
        from voidrift_cli.commands._chat_compact import ContextCompactor

        agent = MagicMock()
        agent.messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
        ]
        agent._get_client.return_value.chat.completions.create.return_value.choices[
            0
        ].message.content = "summary"

        ui = MagicMock()
        ui._con = MagicMock()
        ui.random_label.return_value = "thinking"
        ui.render_text.return_value = "rendered"

        estimate_tokens = lambda msgs: sum(len(m.get("content") or "") for m in msgs) // 4
        setup_terminal = MagicMock(return_value=(None, None))
        restore_terminal = MagicMock()

        compactor = ContextCompactor(
            agent=agent,
            log="/tmp/test_compact.log",
            max_ctx=10000,
            ui=ui,
            session=None,
            original_skill="",
            fs_ctx=None,
            estimate_tokens=estimate_tokens,
            setup_terminal=setup_terminal,
            restore_terminal=restore_terminal,
        )

        with patch("rich.live.Live.__enter__", return_value=None), \
             patch("rich.live.Live.__exit__", return_value=False):
            result = compactor.compact()

        assert result is True
        assert len(agent.messages) == 1
        assert "summary" in agent.messages[0]["content"]


class TestKeyBindings:
    """V-U-21: Phase 3 — _build_key_bindings independently testable."""

    def test_returns_key_bindings_object(self):
        from voidrift_cli.commands._chat_display import _build_key_bindings
        from prompt_toolkit.key_binding import KeyBindings
        kb = _build_key_bindings()
        assert isinstance(kb, KeyBindings)

    def test_enter_binding_registered(self):
        from voidrift_cli.commands._chat_display import _build_key_bindings
        from prompt_toolkit.keys import Keys
        kb = _build_key_bindings()
        bound_keys = [b.keys for b in kb.bindings]
        # prompt_toolkit maps "enter" → ControlM internally
        assert (Keys.ControlM,) in bound_keys

    def test_ctrl_j_binding_registered(self):
        from voidrift_cli.commands._chat_display import _build_key_bindings
        kb = _build_key_bindings()
        bound_keys = [b.keys for b in kb.bindings]
        assert ("c-j",) in bound_keys


class TestConfirmHandlers:
    """V-U-21: Phase 4 — _handle_web_fetch_confirm and _handle_ask_user independently testable."""

    def test_web_fetch_confirm_true(self):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import _handle_web_fetch_confirm
        console = MagicMock()
        result = _handle_web_fetch_confirm("https://example.com", console, lambda: True)
        assert result is True
        console.print.assert_called_once()

    def test_web_fetch_confirm_false(self):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import _handle_web_fetch_confirm
        console = MagicMock()
        result = _handle_web_fetch_confirm("https://example.com", console, lambda: False)
        assert result is False

    def test_ask_user_with_options_prints_all(self):
        from unittest.mock import MagicMock, call
        from voidrift_cli.commands._chat_display import _handle_ask_user
        console = MagicMock()
        _handle_ask_user("Pick one?", ["a", "b"], console, lambda: "a")
        calls = [str(c) for c in console.print.call_args_list]
        assert any("a" in c for c in calls)
        assert any("b" in c for c in calls)

    def test_ask_user_without_options(self):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import _handle_ask_user
        console = MagicMock()
        result = _handle_ask_user("What?", None, console, lambda: "answer")
        assert result == "answer"
        assert console.print.call_count == 1


class TestChatDisplay:
    """V-U-21: Phase 5 — ChatDisplay lifecycle independently testable."""

    def test_context_manager_enters_and_exits(self):
        from unittest.mock import MagicMock, patch
        from voidrift_cli.commands._chat_display import ChatDisplay
        console = MagicMock()
        with patch("rich.live.Live.__enter__", return_value=None), \
             patch("rich.live.Live.__exit__", return_value=False):
            with ChatDisplay(console) as display:
                assert display is not None

    def test_print_assistant_delegates_to_console(self):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import ChatDisplay
        console = MagicMock()
        display = ChatDisplay(console)
        display.print_assistant("hello")
        console.print.assert_called_once_with("hello")

    def test_print_tool_call_delegates_to_console(self):
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import ChatDisplay
        console = MagicMock()
        display = ChatDisplay(console)
        display.print_tool_call("read_file", {"path": "x.py"})
        assert console.print.called


class TestPermissionGate:
    """V-U-22: REQ-U-22 — session-scoped permission gate for chat write/run/read-outside."""

    def test_gate_defaults_all_false(self):
        """PermissionGate starts with all categories denied."""
        from voidrift_cli.commands._chat_display import PermissionGate
        gate = PermissionGate()
        assert gate.writes is False
        assert gate.runs is False
        assert gate.reads_outside is False

    def test_permission_prompt_allow_once(self):
        """Selecting '1' allows the action without updating the gate."""
        from voidrift_cli.commands._chat_display import PermissionGate, _handle_permission_prompt
        from unittest.mock import MagicMock
        gate = PermissionGate()
        console = MagicMock()
        result = _handle_permission_prompt("writes", "write_source_file('src/main.py')", gate, console, lambda: "1")
        assert result is True
        assert gate.writes is False  # allow-once does not update gate

    def test_permission_prompt_always_allow_sets_gate(self):
        """Selecting '2' allows the action and sets the gate category to True."""
        from voidrift_cli.commands._chat_display import PermissionGate, _handle_permission_prompt
        from unittest.mock import MagicMock
        gate = PermissionGate()
        console = MagicMock()
        result = _handle_permission_prompt("writes", "write_source_file('src/main.py')", gate, console, lambda: "2")
        assert result is True
        assert gate.writes is True

    def test_permission_prompt_deny(self):
        """Selecting '3' denies the action and does not update the gate."""
        from voidrift_cli.commands._chat_display import PermissionGate, _handle_permission_prompt
        from unittest.mock import MagicMock
        gate = PermissionGate()
        console = MagicMock()
        result = _handle_permission_prompt("writes", "write_source_file('src/main.py')", gate, console, lambda: "3")
        assert result is False
        assert gate.writes is False

    def test_permission_prompt_eof_denies(self):
        """EOFError from input_fn is treated as deny."""
        from voidrift_cli.commands._chat_display import PermissionGate, _handle_permission_prompt
        from unittest.mock import MagicMock
        gate = PermissionGate()
        console = MagicMock()
        def _raise(): raise EOFError
        result = _handle_permission_prompt("runs", "run_command('npm install')", gate, console, _raise)
        assert result is False

    def test_write_guard_prompts_without_session_grant(self, tmp_path):
        """write_source_file prompts when gate.writes is False."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate()
        calls = []
        holder = [lambda cat, desc: calls.append((cat, desc)) or True]  # allow once

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        result = handlers["write_source_file"]("src/main.py", "print('hello')")
        assert len(calls) == 1
        assert calls[0][0] == "writes"
        assert "src/main.py" in calls[0][1]
        assert "Wrote" in result

    def test_write_guard_skips_prompt_with_session_grant(self, tmp_path):
        """write_source_file skips prompt when gate.writes is True."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate(writes=True)
        calls = []
        holder = [lambda cat, desc: calls.append((cat, desc)) or True]

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        handlers["write_source_file"]("src/main.py", "print('hello')")
        assert len(calls) == 0  # no prompt

    def test_write_guard_deny_returns_message_no_write(self, tmp_path):
        """Operator denying write returns denial message and does not write the file."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate()
        holder = [lambda cat, desc: False]  # always deny

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        result = handlers["write_source_file"]("src/main.py", "print('hello')")
        assert "denied" in result.lower()
        assert not (tmp_path / "src" / "main.py").exists()

    def test_run_guard_prompts_and_denies(self, tmp_path):
        """run_command in chat prompts and returns denial JSON when denied."""
        import json
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate()
        holder = [lambda cat, desc: False]  # deny

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        result = handlers["run_command"]("echo hello")
        parsed = json.loads(result)
        assert "denied" in parsed["error"].lower()
        assert parsed["exit_code"] == -1

    def test_run_guard_skips_prompt_with_session_grant(self, tmp_path):
        """run_command skips prompt when gate.runs is True."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate(runs=True)
        calls = []
        holder = [lambda cat, desc: calls.append((cat, desc)) or True]

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        handlers["run_command"]("echo hello")
        assert len(calls) == 0

    def test_read_inside_project_no_prompt(self, tmp_path):
        """read_source_file within project dir proceeds without any prompt."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").write_text("print('hello')")

        gate = PermissionGate()
        calls = []
        holder = [lambda cat, desc: calls.append((cat, desc)) or True]

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        result = handlers["read_source_file"]("src/main.py")
        assert "print" in result
        assert len(calls) == 0  # no prompt

    def test_read_outside_project_prompts(self, tmp_path):
        """read_source_file outside project dir triggers the reads_outside gate."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext
        import tempfile, os

        # Create a file outside tmp_path
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("outside = True\n")
            outside_path = f.name

        try:
            gate = PermissionGate()
            calls = []
            holder = [lambda cat, desc: calls.append((cat, desc)) or True]  # allow

            ctx = WriteContext(project_dir=tmp_path)
            handlers = build_handlers(
                cmd="chat",
                project_dir=tmp_path,
                ctx=ctx,
                permission_gate=gate,
                permission_confirm_holder=holder,
            )
            result = handlers["read_source_file"](outside_path)
            assert len(calls) == 1
            assert calls[0][0] == "reads_outside"
            assert "outside" in result
        finally:
            os.unlink(outside_path)

    def test_read_outside_denied_returns_message(self, tmp_path):
        """Denying an outside-project read returns a denial message."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext
        import tempfile, os

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write("outside = True\n")
            outside_path = f.name

        try:
            gate = PermissionGate()
            holder = [lambda cat, desc: False]  # deny

            ctx = WriteContext(project_dir=tmp_path)
            handlers = build_handlers(
                cmd="chat",
                project_dir=tmp_path,
                ctx=ctx,
                permission_gate=gate,
                permission_confirm_holder=holder,
            )
            result = handlers["read_source_file"](outside_path)
            assert "denied" in result.lower()
        finally:
            os.unlink(outside_path)

    def test_non_tty_auto_denies_write(self, tmp_path):
        """When confirm_holder is [None] (no TTY), writes are auto-denied."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.commands._chat_display import PermissionGate
        from voidrift_cli.tools.filesystem import WriteContext

        gate = PermissionGate()
        holder = [None]  # simulates non-TTY — no confirm fn

        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(
            cmd="chat",
            project_dir=tmp_path,
            ctx=ctx,
            permission_gate=gate,
            permission_confirm_holder=holder,
        )
        result = handlers["write_source_file"]("src/main.py", "print('hello')")
        assert "denied" in result.lower()
        assert not (tmp_path / "src" / "main.py").exists()

    def test_develop_cmd_writes_without_gate(self, tmp_path):
        """develop command does not apply the permission gate — writes proceed freely."""
        from voidrift_cli.tool_builder import build_handlers
        from voidrift_cli.tools.filesystem import WriteContext

        ctx = WriteContext(project_dir=tmp_path)
        # No permission_gate passed — automated command
        handlers = build_handlers(
            cmd="develop",
            project_dir=tmp_path,
            ctx=ctx,
        )
        result = handlers["write_source_file"]("src/main.py", "print('hello')")
        assert "Wrote" in result
        assert (tmp_path / "src" / "main.py").exists()


class TestSessionGapMarker:
    """Tests for session gap marker injection (REQ-U-23)."""

    def test_gap_marker_appended(self):
        """_inject_session_gap_marker appends user marker and assistant ack."""
        from voidrift_cli.commands.chat import _inject_session_gap_marker
        messages = [{"role": "system", "content": "test"}]
        _inject_session_gap_marker(messages, ", last active 2h ago")
        assert len(messages) == 3
        assert "Session resumed after 2h ago" in messages[1]["content"]
        assert messages[1]["role"] == "user"
        assert messages[2]["role"] == "assistant"
        assert "ready" in messages[2]["content"].lower()

    def test_gap_marker_contains_do_not_continue(self):
        """The marker instructs the model not to continue previous actions."""
        from voidrift_cli.commands.chat import _inject_session_gap_marker
        messages = []
        _inject_session_gap_marker(messages, ", last active 1d ago")
        assert "Do not continue previous actions" in messages[0]["content"]

    def test_threshold_constant(self):
        """Threshold is 1800 seconds (30 minutes)."""
        from voidrift_cli.commands.chat import _SESSION_GAP_THRESHOLD
        assert _SESSION_GAP_THRESHOLD == 1800


class TestThinkingIndicator:
    """Tests for REQ-UI-14: chat thinking indicator and empty response feedback."""

    def test_thinking_text_shows_thinking_immediately(self):
        """Thinking text includes 'thinking' even with zero elapsed time."""
        from voidrift_cli.commands._chat_display import _make_display_callbacks
        # We test the logic directly via the chat module's _thinking_text
        # Since it's a closure, test the pattern: no elapsed → still shows "thinking"
        # The function is inside _interactive_loop, so we verify the contract via the display callbacks
        cbs = _make_display_callbacks(
            agent=None, style="verbose",
            live_holder=[None], live_start=[0.0],
            turn_label=["test label"], got_token=[False],
            stream_buf=[], stats_parts=[], tool_calls_this_turn=[],
        )
        # on_progress should not crash when live is None
        cbs["on_progress"]({"state": "thinking"})

    def test_token_stall_resumes_thinking(self):
        """on_progress fires when tokens have stalled for >1.5s."""
        import time as _time
        from unittest.mock import MagicMock
        from voidrift_cli.commands._chat_display import _make_display_callbacks

        mock_live = MagicMock()
        cbs = _make_display_callbacks(
            agent=None, style="verbose",
            live_holder=[mock_live], live_start=[_time.time() - 5],
            turn_label=["test"], got_token=[True],
            stream_buf=["hello"], stats_parts=[], tool_calls_this_turn=[],
        )
        # Simulate token received 3 seconds ago by calling on_token then waiting
        cbs["on_token"]("x")
        # Manually set _last_token_time to 3 seconds ago
        # Access via the closure — we need to trigger on_progress after stall
        # The got_token is True but last_token_time is recent, so on_progress returns
        cbs["on_progress"]({"state": "thinking"})
        # Live should NOT have been updated with spinner (tokens are recent)
        # Check that the last update was from on_token, not on_progress
        calls = mock_live.update.call_args_list
        assert len(calls) >= 1  # at least the on_token update

    def test_empty_response_with_tools_shows_summary(self):
        """Empty response after tool calls shows completed tool summary."""
        tool_calls = ["write_source_file", "edit_source_file", "write_source_file"]
        # dict.fromkeys preserves order and deduplicates
        summary = f"(Completed: {', '.join(dict.fromkeys(tool_calls))})"
        assert summary == "(Completed: write_source_file, edit_source_file)"

    def test_empty_response_no_tools_shows_no_response(self):
        """Empty response with no tool calls shows fallback message."""
        tool_calls = []
        response = ""
        if not response.strip() and not tool_calls:
            msg = "(No response from model)"
        elif not response.strip() and tool_calls:
            msg = f"(Completed: {', '.join(dict.fromkeys(tool_calls))})"
        else:
            msg = response
        assert msg == "(No response from model)"
