"""Tests for agent.py — agent loop with mocked OpenAI client."""

import json
from unittest.mock import patch, MagicMock, call

import anthropic
import openai
import pytest

from voidrift_cli.agent import AgentLoop, build_local_tools
from voidrift_cli.models import ModelConfig, ModelInterface
from voidrift_cli.agent_protocol import get_adapter

from helpers import make_openai_response, make_tool_call, make_anthropic_response, make_anthropic_tool_use


def _mi(alias="test", model_id="test-model", protocol="openai", **kwargs):
    """Create a ModelInterface for testing."""
    config = ModelConfig(alias=alias, model_id=model_id, protocol=protocol, **kwargs)
    return ModelInterface(config, get_adapter(config.protocol))


@pytest.fixture
def agent(cloud_model):
    return AgentLoop(
        model=cloud_model,
        system_prompt="You are a test assistant.",
        stream=False,
    )


class TestAgentInit:
    def test_system_prompt_added(self, agent):
        assert agent.messages[0]["role"] == "system"
        assert "test assistant" in agent.messages[0]["content"]

    def test_no_system_prompt(self, cloud_model):
        a = AgentLoop(model=cloud_model, stream=False)
        assert len(a.messages) == 0

    def test_model_name_strips_prefix(self, cloud_model):
        cloud_model.model_id = "openai/test-model"
        a = AgentLoop(model=cloud_model, stream=False)
        assert a._model_name() == "test-model"

    def test_model_name_strips_anthropic(self):
        m = _mi(alias="c", model_id="anthropic/claude-4", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "claude-4"

    def test_model_name_strips_gemini(self):
        m = _mi(alias="g", model_id="gemini/gemini-2.5-pro", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "gemini-2.5-pro"

    def test_model_name_no_prefix(self):
        m = _mi(alias="x", model_id="plain-model", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "plain-model"


class TestAgentSend:
    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_simple_response(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = make_openai_response("Hello!")

        result = agent.send("Hi")
        assert result == "Hello!"
        assert agent.messages[-1]["content"] == "Hello!"
        assert agent.messages[-2]["content"] == "Hi"

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_tool_call_then_response(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        # First call returns a tool call, second returns text
        tc = make_tool_call("get_conventions", '{"section": ""}')
        tool_response = make_openai_response(content=None, tool_calls=[tc])
        tool_response.choices[0].message.content = None
        final_response = make_openai_response("Here are the conventions.")

        mock_client.chat.completions.create.side_effect = [tool_response, final_response]

        agent.tool_handlers = {"get_conventions": lambda section="": "Convention rules here"}
        agent.tools = [{"type": "function", "function": {"name": "get_conventions"}}]

        result = agent.send("Show conventions")
        assert result == "Here are the conventions."
        assert mock_client.chat.completions.create.call_count == 2

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_unknown_tool_returns_error(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("nonexistent_tool", '{}')
        tool_response = make_openai_response(content=None, tool_calls=[tc])
        tool_response.choices[0].message.content = None
        final_response = make_openai_response("OK")

        mock_client.chat.completions.create.side_effect = [tool_response, final_response]
        agent.tools = [{"type": "function", "function": {"name": "nonexistent_tool"}}]

        result = agent.send("Do something")
        # The tool result message should contain an error
        tool_msgs = [m for m in agent.messages if m.get("role") == "tool"]
        assert any("Unknown tool" in m["content"] for m in tool_msgs)

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_invalid_json_args(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("get_conventions", 'not valid json{{{')
        tool_response = make_openai_response(content=None, tool_calls=[tc])
        tool_response.choices[0].message.content = None
        final_response = make_openai_response("OK")

        mock_client.chat.completions.create.side_effect = [tool_response, final_response]
        agent.tools = [{"type": "function", "function": {"name": "get_conventions"}}]
        agent.tool_handlers = {"get_conventions": lambda: "rules"}

        agent.send("test")
        tool_msgs = [m for m in agent.messages if m.get("role") == "tool"]
        assert any("Invalid JSON" in m["content"] for m in tool_msgs)

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_tool_handler_exception(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("bad_tool", '{}')
        tool_response = make_openai_response(content=None, tool_calls=[tc])
        tool_response.choices[0].message.content = None
        final_response = make_openai_response("OK")

        mock_client.chat.completions.create.side_effect = [tool_response, final_response]
        agent.tools = [{"type": "function", "function": {"name": "bad_tool"}}]
        agent.tool_handlers = {"bad_tool": lambda: (_ for _ in ()).throw(ValueError("boom"))}

        agent.send("test")
        tool_msgs = [m for m in agent.messages if m.get("role") == "tool"]
        assert any("Error calling" in m["content"] for m in tool_msgs)


class TestAgentClientConfig:
    def test_uses_api_base(self, cloud_model):
        cloud_model.config.api_base = "http://custom:1234/v1"
        cloud_model.config.api_key = "key123"
        a = AgentLoop(model=cloud_model, stream=False)
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            MockOpenAI.return_value = MagicMock()
            MockOpenAI.return_value.chat.completions.create.return_value = make_openai_response()
            a.send("test")
            kwargs = MockOpenAI.call_args[1]
            assert kwargs["base_url"] == "http://custom:1234/v1"
            assert kwargs["api_key"] == "key123"

    def test_anthropic_config(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "ant-key")
        m = _mi(alias="c", model_id="anthropic/claude", model_type="cloud", provider="anthropic")
        a = AgentLoop(model=m, stream=False)
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            MockOpenAI.return_value = MagicMock()
            MockOpenAI.return_value.chat.completions.create.return_value = make_openai_response()
            a.send("test")
            kwargs = MockOpenAI.call_args[1]
            assert kwargs["api_key"] == "ant-key"
            assert "anthropic" in kwargs["base_url"]

    def test_gemini_config(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "gem-key")
        m = _mi(alias="g", model_id="gemini/pro", model_type="cloud", provider="gemini")
        a = AgentLoop(model=m, stream=False)
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            MockOpenAI.return_value = MagicMock()
            MockOpenAI.return_value.chat.completions.create.return_value = make_openai_response()
            a.send("test")
            kwargs = MockOpenAI.call_args[1]
            assert kwargs["api_key"] == "gem-key"
            assert "generativelanguage" in kwargs["base_url"]


class TestRetryLogic:
    """Tests for REQ-ARCH-10: exponential backoff retry on transient errors."""

    def _make_agent(self, cloud_model):
        return AgentLoop(model=cloud_model, stream=False)

    def test_req_arch10_retries_connection_error(self, cloud_model, tmp_path):
        """REQ-ARCH-10: connection errors are retried up to 3 attempts."""
        agent = self._make_agent(cloud_model)
        conn_err = openai.APIConnectionError(request=MagicMock())
        success = make_openai_response("ok")
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = [conn_err, success]
                result = agent.send("test")
        assert result == "ok"
        assert mock_client.chat.completions.create.call_count == 2

    def test_req_arch10_retries_rate_limit(self, cloud_model):
        """REQ-ARCH-10: 429 rate limit responses are retried."""
        agent = self._make_agent(cloud_model)
        rate_err = openai.RateLimitError("rate limited", response=MagicMock(), body={})
        success = make_openai_response("ok")
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = [rate_err, success]
                result = agent.send("test")
        assert result == "ok"

    def test_req_arch10_no_retry_on_auth_error(self, cloud_model):
        """REQ-ARCH-10: auth errors (401) are NOT retried."""
        agent = self._make_agent(cloud_model)
        auth_err = openai.AuthenticationError("unauthorized", response=MagicMock(), body={})
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep") as mock_sleep:
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = auth_err
                with pytest.raises(RuntimeError):
                    agent.send("test")
        mock_sleep.assert_not_called()
        assert mock_client.chat.completions.create.call_count == 1

    def test_req_arch10_no_retry_on_context_length(self, cloud_model):
        """REQ-ARCH-10: context length errors are NOT retried."""
        agent = self._make_agent(cloud_model)
        ctx_err = Exception("context length exceeded")
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep") as mock_sleep:
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = ctx_err
                with pytest.raises(RuntimeError):
                    agent.send("test")
        mock_sleep.assert_not_called()

    def test_req_arch10_exhausted_raises(self, cloud_model):
        """REQ-ARCH-10: when all retry attempts fail, the exception is raised."""
        agent = self._make_agent(cloud_model)
        conn_err = openai.APIConnectionError(request=MagicMock())
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = conn_err
                with pytest.raises((openai.APIConnectionError, RuntimeError)):
                    agent.send("test")
        assert mock_client.chat.completions.create.call_count == 3

    def test_req_arch10_retry_logged(self, cloud_model, tmp_path):
        """REQ-ARCH-10: each retry attempt is logged to the command log."""
        log_file = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log_file)
        conn_err = openai.APIConnectionError(request=MagicMock())
        success = make_openai_response("done")
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = [conn_err, success]
                agent.send("hi")
        log_content = log_file.read_text()
        assert "[RETRY attempt=" in log_content


    def test_create_completion_retries_on_rate_limit(self, cloud_model, tmp_path):
        """_create_completion retries up to RETRY_MAX on RateLimitError."""
        log_file = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log_file)
        retry_max = agent._RETRY_MAX
        call_count = [0]
        def mock_create(**kwargs):
            call_count[0] += 1
            if call_count[0] < retry_max:
                raise openai.RateLimitError(
                    "rate limited", response=MagicMock(status_code=429, headers={}), body={},
                )
            return make_openai_response("ok")
        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = mock_create
                result = agent.send("test")
        assert result == "ok"
        assert call_count[0] == retry_max


class TestThinkTagStripping:
    """V-ARCH-4: REQ-ARCH-8 — <think> tags stripped and logged as [THINKING]."""

    def _make_agent(self, cloud_model, tmp_path):
        log = tmp_path / "test.log"
        return AgentLoop(model=cloud_model, stream=False, log_path=log), log

    def test_strips_think_tags_from_output(self, cloud_model, tmp_path):
        """<think>...</think> blocks are removed from the returned text."""
        agent, _ = self._make_agent(cloud_model, tmp_path)
        result = agent._strip_think("<think>internal reasoning</think>Final answer.")
        assert "<think>" not in result
        assert "internal reasoning" not in result
        assert "Final answer." in result

    def test_logs_think_content(self, cloud_model, tmp_path):
        """Think content is logged with [THINKING] prefix."""
        agent, log = self._make_agent(cloud_model, tmp_path)
        agent._strip_think("<think>log this thought</think>Output.")
        log_content = log.read_text()
        assert "[THINKING]" in log_content
        assert "log this thought" in log_content

    def test_orphaned_close_tag_stripped(self, cloud_model, tmp_path):
        """Leading orphaned </think> (no opening tag) is handled gracefully."""
        agent, _ = self._make_agent(cloud_model, tmp_path)
        result = agent._strip_think("some preamble</think>actual output")
        assert "</think>" not in result
        assert "actual output" in result

    def test_empty_think_block_removed(self, cloud_model, tmp_path):
        """Empty <think></think> blocks are removed without error."""
        agent, _ = self._make_agent(cloud_model, tmp_path)
        result = agent._strip_think("<think></think>Clean output.")
        assert "<think>" not in result
        assert "Clean output." in result

    def test_multiple_think_blocks_stripped(self, cloud_model, tmp_path):
        """Multiple think blocks in one response are all removed."""
        agent, _ = self._make_agent(cloud_model, tmp_path)
        text = "<think>first</think>middle<think>second</think>end"
        result = agent._strip_think(text)
        assert "first" not in result
        assert "second" not in result
        assert "middle" in result
        assert "end" in result


class TestContextLengthError:
    """V-G-2: REQ-ARCH-10 — context length error message includes model alias."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_context_length_error_message(self, MockOpenAI, cloud_model):
        """Context length exceeded raises RuntimeError with alias and 'larger context window'."""
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception(
            "maximum context length exceeded"
        )

        agent = AgentLoop(model=cloud_model, stream=False)
        with pytest.raises(RuntimeError) as exc_info:
            agent.send("test message")

        msg = str(exc_info.value)
        assert "larger context window" in msg

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_context_length_error_includes_alias(self, MockOpenAI, cloud_model):
        """Context length error message names the model alias."""
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.side_effect = Exception("token limit exceeded")

        agent = AgentLoop(model=cloud_model, stream=False)
        with pytest.raises(RuntimeError) as exc_info:
            agent.send("test message")

        msg = str(exc_info.value)
        assert cloud_model.alias in msg


class TestBuildLocalTools:
    def test_returns_tools_and_handlers(self):
        tools, handlers = build_local_tools()
        assert len(tools) > 0
        assert len(handlers) > 0
        for t in tools:
            name = t["function"]["name"]
            assert name in handlers, f"Tool {name} has no handler"

    def test_tool_format(self):
        tools, _ = build_local_tools()
        for t in tools:
            assert t["type"] == "function"
            assert "name" in t["function"]
            assert "parameters" in t["function"]

    def test_expected_tools_present_no_cmd(self):
        tools, handlers = build_local_tools()
        expected = [
            "read_source_file", "write_source_file",
            "read_framework_file", "write_framework_file",
            "list_project_artifacts", "web_fetch",
            "get_skill", "list_skills",
        ]
        tool_names = {t["function"]["name"] for t in tools}
        for name in expected:
            assert name in tool_names, f"Missing tool: {name}"

    def test_develop_command_excludes_skill_tools(self):
        """V-ARCH-5: develop command must not expose get_skill/list_skills tools (skills are pre-injected)."""
        tools, handlers = build_local_tools(cmd="develop")
        tool_names = {t["function"]["name"] for t in tools}
        assert "get_skill" not in tool_names
        assert "list_skills" not in tool_names

    def test_develop_command_has_source_tools(self):
        """V-ARCH-5: develop command includes source file read/write tools."""
        tools, handlers = build_local_tools(cmd="develop")
        tool_names = {t["function"]["name"] for t in tools}
        assert "read_source_file" in tool_names
        assert "write_source_file" in tool_names

    def test_plan_command_excludes_source_write(self):
        """V-ARCH-5: plan command excludes write_source_file."""
        tools, handlers = build_local_tools(cmd="plan")
        tool_names = {t["function"]["name"] for t in tools}
        assert "write_source_file" not in tool_names
        assert "write_framework_file" in tool_names

    def test_chat_command_includes_skill_tools(self):
        """V-ARCH-5: chat command exposes get_skill and list_skills tools."""
        tools, handlers = build_local_tools(cmd="chat")
        tool_names = {t["function"]["name"] for t in tools}
        assert "get_skill" in tool_names
        assert "list_skills" in tool_names
        assert "get_skill" in handlers
        assert "list_skills" in handlers


    def test_build_local_tools_no_cmd_returns_all_tools(self):
        """Calling build_local_tools() with no argument returns all tools."""
        tools_all, _ = build_local_tools()
        tools_none, _ = build_local_tools(cmd=None)
        tool_names_all = {t["function"]["name"] for t in tools_all}
        tool_names_none = {t["function"]["name"] for t in tools_none}
        assert tool_names_all == tool_names_none


class TestMaxTokensRecovery:
    """V-ARCH-6a: REQ-ARCH-11 — max output token truncation detection and recovery."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_text_truncation_triggers_continuation(self, MockOpenAI, cloud_model, tmp_path):
        """Given finish_reason='length' on text, agent injects resume and retries."""
        log = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        truncated = make_openai_response("partial ", finish_reason="length")
        complete = make_openai_response("content here", finish_reason="stop")
        mock_client.chat.completions.create.side_effect = [truncated, complete]

        result = agent.send("generate something long")
        assert result == "partial content here"
        assert mock_client.chat.completions.create.call_count == 2
        log_text = log.read_text()
        assert "[MAX_TOKENS_RECOVERY] attempt 1/2" in log_text

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_exhaustion_returns_partial(self, MockOpenAI, cloud_model, tmp_path):
        """Given 2 continuations exhausted, agent returns concatenated partial text."""
        log = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        t1 = make_openai_response("part1 ", finish_reason="length")
        t2 = make_openai_response("part2 ", finish_reason="length")
        t3 = make_openai_response("part3", finish_reason="length")
        mock_client.chat.completions.create.side_effect = [t1, t2, t3]

        result = agent.send("generate")
        assert result == "part1 part2 part3"
        assert mock_client.chat.completions.create.call_count == 3
        log_text = log.read_text()
        assert "[MAX_TOKENS_RECOVERY] attempt 1/2" in log_text
        assert "[MAX_TOKENS_RECOVERY] attempt 2/2" in log_text
        assert "[MAX_TOKENS_EXHAUSTED]" in log_text

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_tool_truncation_discards_and_reemits(self, MockOpenAI, cloud_model, tmp_path):
        """Given finish_reason='length' with tool calls, discard calls and inject re-emit prompt."""
        log = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        agent.tools = [{"type": "function", "function": {"name": "read_source_file", "parameters": {}}}]
        agent.tool_handlers = {"read_source_file": lambda **kw: "file content"}
        agent.tool_choice = "auto"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("read_source_file", '{"path": "x.py"}')
        truncated_with_tools = make_openai_response(content=None, tool_calls=[tc], finish_reason="length")
        truncated_with_tools.choices[0].message.content = None
        # After re-emit prompt, model retries with tool calls successfully
        tc2 = make_tool_call("read_source_file", '{"path": "x.py"}', call_id="call_2")
        reemit_response = make_openai_response(content=None, tool_calls=[tc2], finish_reason="stop")
        reemit_response.choices[0].message.content = None
        final = make_openai_response("done", finish_reason="stop")
        mock_client.chat.completions.create.side_effect = [truncated_with_tools, reemit_response, final]

        result = agent.send("read file")
        assert result == "done"
        log_text = log.read_text()
        assert "[MAX_TOKENS_TOOL_DISCARD] Discarded 1 truncated tool calls, requesting re-emit" in log_text
        # The truncated tool call should NOT have been executed — only the re-emitted one
        assert mock_client.chat.completions.create.call_count == 3

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_tool_truncation_does_not_execute_truncated_calls(self, MockOpenAI, cloud_model, tmp_path):
        """Truncated tool calls must not be executed — verify handler is not called."""
        log = tmp_path / "test.log"
        call_count = {"n": 0}
        def counting_handler(**kw):
            call_count["n"] += 1
            return "result"

        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        agent.tools = [{"type": "function", "function": {"name": "read_source_file", "parameters": {}}}]
        agent.tool_handlers = {"read_source_file": counting_handler}
        agent.tool_choice = "auto"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("read_source_file", '{"path": "x.py"}')
        truncated_with_tools = make_openai_response(content=None, tool_calls=[tc], finish_reason="length")
        truncated_with_tools.choices[0].message.content = None
        # Model responds with text only after re-emit prompt
        final = make_openai_response("done", finish_reason="stop")
        mock_client.chat.completions.create.side_effect = [truncated_with_tools, final]

        result = agent.send("read file")
        assert result == "done"
        # Handler should never have been called — truncated calls were discarded
        assert call_count["n"] == 0

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_tool_truncation_resume_prompt_injected(self, MockOpenAI, cloud_model, tmp_path):
        """Verify the re-emit user message is injected into message history."""
        log = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        agent.tools = [{"type": "function", "function": {"name": "read_source_file", "parameters": {}}}]
        agent.tool_handlers = {"read_source_file": lambda **kw: "content"}
        agent.tool_choice = "auto"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("read_source_file", '{"path": "x.py"}')
        truncated_with_tools = make_openai_response(content="partial", tool_calls=[tc], finish_reason="length")
        final = make_openai_response("done", finish_reason="stop")
        mock_client.chat.completions.create.side_effect = [truncated_with_tools, final]

        agent.send("read file")
        # Find the re-emit user message in history
        user_msgs = [m for m in agent.messages if m["role"] == "user"]
        assert any("Re-emit the tool calls" in m["content"] for m in user_msgs)

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_normal_stop_no_recovery(self, MockOpenAI, cloud_model, tmp_path):
        """Given finish_reason='stop', no recovery logic triggers."""
        log = tmp_path / "test.log"
        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        mock_client.chat.completions.create.return_value = make_openai_response("complete", finish_reason="stop")

        result = agent.send("test")
        assert result == "complete"
        assert mock_client.chat.completions.create.call_count == 1
        log_text = log.read_text()
        assert "MAX_TOKENS" not in log_text


class TestModelFallback:
    """Tests for model fallback on retry exhaustion (REQ-MC-4)."""

    def test_fallback_on_429_exhaustion(self, tmp_path):
        """Fallback model is used when primary exhausts retries on 429."""
        primary = _mi(
            alias="primary", model_id="p-model", api_base="http://localhost:1/v1",
            api_key="k", fallback="fallback-model",
        )
        agent = AgentLoop(model=primary, system_prompt="test", stream=False, log_path=tmp_path / "test.log")

        call_count = [0]
        def mock_create(**kw):
            call_count[0] += 1
            if call_count[0] <= 3:
                raise openai.RateLimitError(
                    message="rate limited", response=MagicMock(status_code=429, headers={}), body=None,
                )
            return make_openai_response("fallback response")

        fallback_mi = _mi(alias="fallback-model", model_id="fb-model", api_base="http://localhost:2/v1", api_key="k")

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with patch("voidrift_cli.models.resolve_model", return_value=fallback_mi):
                result = agent.send("test")

        assert result == "fallback response"
        assert agent.model.alias == "fallback-model"

    def test_no_fallback_without_config(self, cloud_model):
        """No fallback field → retries exhaust and error is raised."""
        assert cloud_model.fallback is None
        agent = AgentLoop(model=cloud_model, system_prompt="test", stream=False)

        def mock_create(**kw):
            raise openai.RateLimitError(
                message="rate limited", response=MagicMock(status_code=429, headers={}), body=None,
            )

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with pytest.raises(RuntimeError):
                agent.send("test")

    def test_no_fallback_on_401(self, tmp_path):
        """Auth errors (401) do not trigger fallback."""
        primary = _mi(alias="primary", model_id="p", api_base="http://localhost:1/v1", api_key="k", fallback="fb")
        agent = AgentLoop(model=primary, system_prompt="test", stream=False, log_path=tmp_path / "t.log")

        def mock_create(**kw):
            raise openai.AuthenticationError(
                message="invalid key", response=MagicMock(status_code=401, headers={}), body=None,
            )

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with pytest.raises(RuntimeError):
                agent.send("test")
        # Model should NOT have changed
        assert agent.model.alias == "primary"

    def test_fallback_failure_is_logged(self, tmp_path):
        """Fallback attempt failure writes a log entry with MODEL_FALLBACK_FAILED."""
        primary = _mi(alias="primary", model_id="p", api_base="http://localhost:1/v1", api_key="k", fallback="fb")
        log_file = tmp_path / "test.log"
        agent = AgentLoop(model=primary, system_prompt="test", stream=False, log_path=log_file)

        def mock_create(**kw):
            raise openai.RateLimitError(
                message="rate limited", response=MagicMock(status_code=429, headers={}), body=None,
            )

        fallback_mi = _mi(alias="fb", model_id="fb-model", api_base="http://localhost:2/v1", api_key="k")

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with patch("voidrift_cli.models.resolve_model", return_value=fallback_mi):
                with pytest.raises(RuntimeError):
                    agent.send("test")

        log_content = log_file.read_text()
        assert "MODEL_FALLBACK_FAILED" in log_content


class TestReactiveCompact:
    def test_reactive_compact_count_initialized_at_construction(self, cloud_model):
        """_reactive_compact_count is 0 immediately after construction."""
        loop = AgentLoop(model=cloud_model)
        assert loop._reactive_compact_count == 0

    def test_reactive_compact_count_not_reset_on_second_call(self, cloud_model):
        """Counter survives multiple calls — no hasattr re-init."""
        loop = AgentLoop(model=cloud_model)
        loop._reactive_compact_count = 1
        assert loop._reactive_compact_count >= 1


class TestPartitionToolCalls:
    def test_partition_uses_tool_definition_flag(self, cloud_model):
        """_partition_tool_calls uses concurrent_safe flag from tool defs."""
        loop = AgentLoop(
            model=cloud_model,
            tools=[
                {"type": "function", "function": {"name": "my_read"}, "concurrent_safe": True},
                {"type": "function", "function": {"name": "my_write"}},
            ],
            tool_handlers={"my_read": lambda: "r", "my_write": lambda: "w"},
        )
        tool_calls = [
            {"id": "1", "function": {"name": "my_read", "arguments": "{}"}},
            {"id": "2", "function": {"name": "my_read", "arguments": "{}"}},
            {"id": "3", "function": {"name": "my_write", "arguments": "{}"}},
        ]
        batches = loop._partition_tool_calls(tool_calls)
        assert len(batches) == 2
        assert len(batches[0]) == 2


class TestToolCallDedup:
    """Verify deduplication of identical tool calls (REQ-ARCH-16, V-ARCH-16)."""

    def test_identical_calls_reduced_to_one(self, cloud_model, tmp_path):
        """Given 3 identical read_source_file calls, execute once, map result to all IDs."""
        log = tmp_path / "agent.log"
        loop = AgentLoop(model=cloud_model, log_path=log)
        tool_calls = [
            {"id": "c1", "function": {"name": "read_source_file", "arguments": '{"path":"foo.js"}'}},
            {"id": "c2", "function": {"name": "read_source_file", "arguments": '{"path":"foo.js"}'}},
            {"id": "c3", "function": {"name": "read_source_file", "arguments": '{"path":"foo.js"}'}},
        ]
        unique, dedup_map = loop._deduplicate_tool_calls(tool_calls)
        # Only one unique call
        assert len(unique) == 1
        assert unique[0]["id"] == "c1"
        # Dedup map: c1 -> [c2, c3]
        assert dedup_map == {"c1": ["c2", "c3"]}
        # Log contains dedup entry
        log_text = log.read_text()
        assert "[DEDUP] 3 identical calls to read_source_file reduced to 1" in log_text

    def test_distinct_calls_unaffected(self, cloud_model, tmp_path):
        """Given 3 calls with different names or arguments, all are kept."""
        log = tmp_path / "agent.log"
        loop = AgentLoop(model=cloud_model, log_path=log)
        tool_calls = [
            {"id": "c1", "function": {"name": "read_source_file", "arguments": '{"path":"a.js"}'}},
            {"id": "c2", "function": {"name": "read_source_file", "arguments": '{"path":"b.js"}'}},
            {"id": "c3", "function": {"name": "write_source_file", "arguments": '{"path":"a.js"}'}},
        ]
        unique, dedup_map = loop._deduplicate_tool_calls(tool_calls)
        assert len(unique) == 3
        assert dedup_map == {}
        # No log file created or no DEDUP entry
        assert not log.exists() or "[DEDUP]" not in log.read_text()

    def test_all_ids_receive_result_in_loop(self, cloud_model, tmp_path):
        """Integration: identical calls produce tool result messages for every ID."""
        log = tmp_path / "agent.log"
        call_count = 0

        def mock_handler(path=""):
            nonlocal call_count
            call_count += 1
            return f"content of {path}"

        tc1 = make_tool_call("read_source_file", '{"path":"foo.js"}', call_id="c1")
        tc2 = make_tool_call("read_source_file", '{"path":"foo.js"}', call_id="c2")
        tc3 = make_tool_call("read_source_file", '{"path":"foo.js"}', call_id="c3")
        tool_resp = make_openai_response(content=None, tool_calls=[tc1, tc2, tc3])
        tool_resp.choices[0].message.content = None
        final_resp = make_openai_response("Done.")

        loop = AgentLoop(
            model=cloud_model,
            system_prompt="test",
            tools=[{"type": "function", "function": {"name": "read_source_file", "parameters": {"properties": {"path": {"type": "string"}}, "required": ["path"]}}}],
            tool_handlers={"read_source_file": mock_handler},
            stream=False,
            log_path=log,
        )

        with patch("voidrift_cli.agent_protocol.OpenAI") as MockOpenAI:
            mock_client = MagicMock()
            MockOpenAI.return_value = mock_client
            mock_client.chat.completions.create.side_effect = [tool_resp, final_resp]
            result = loop.send("read foo")

        # Handler called only once
        assert call_count == 1
        # All 3 tool_call IDs have result messages
        tool_results = [m for m in loop.messages if m.get("role") == "tool"]
        assert len(tool_results) == 3
        result_ids = {m["tool_call_id"] for m in tool_results}
        assert result_ids == {"c1", "c2", "c3"}
        # All results are identical
        assert all(m["content"] == "content of foo.js" for m in tool_results)

    def test_mixed_identical_and_distinct(self, cloud_model):
        """Given a mix of identical and distinct calls, only identical are deduped."""
        loop = AgentLoop(model=cloud_model)
        tool_calls = [
            {"id": "c1", "function": {"name": "read_source_file", "arguments": '{"path":"a.js"}'}},
            {"id": "c2", "function": {"name": "read_source_file", "arguments": '{"path":"a.js"}'}},
            {"id": "c3", "function": {"name": "read_source_file", "arguments": '{"path":"b.js"}'}},
        ]
        unique, dedup_map = loop._deduplicate_tool_calls(tool_calls)
        assert len(unique) == 2
        assert [tc["id"] for tc in unique] == ["c1", "c3"]
        assert dedup_map == {"c1": ["c2"]}


class TestBuildLocalToolsProjectDir:
    def test_build_local_tools_uses_provided_project_dir(self, tmp_path):
        """Memory and session handlers use the provided project_dir, not Path.cwd()."""
        (tmp_path / ".voidrift").mkdir()
        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path)
        result = handlers["write_memory"](name="test-key", content="hello")
        assert (tmp_path / ".voidrift" / "memory" / "test-key.md").exists()


class TestLoopDecomposition:
    # ------------------------------------------------------------------
    # _drain_steering unit tests (REQ-ARCH-20)
    # ------------------------------------------------------------------

    def test_drain_steering_returns_all_batches(self, cloud_model):
        """_drain_steering flattens all pending steering batches into one list."""
        agent = AgentLoop(model=cloud_model)
        batch_a = [{"role": "user", "content": "a"}]
        batch_b = [{"role": "user", "content": "b"}]
        batch_c = [{"role": "user", "content": "c"}]
        agent._steering_queue.put_nowait(batch_a)
        agent._steering_queue.put_nowait(batch_b)
        agent._steering_queue.put_nowait(batch_c)
        result = agent._drain_steering()
        assert result == batch_a + batch_b + batch_c
        assert agent._steering_queue.empty()

    def test_drain_steering_empty_returns_empty_list(self, cloud_model):
        """_drain_steering on an empty queue returns []."""
        agent = AgentLoop(model=cloud_model)
        assert agent._drain_steering() == []

    # ------------------------------------------------------------------
    # _drain_one_followup unit tests (REQ-ARCH-20)
    # ------------------------------------------------------------------

    def test_drain_one_followup_returns_first_item(self, cloud_model):
        """First call returns the first queued item."""
        agent = AgentLoop(model=cloud_model)
        msgs1 = [{"role": "user", "content": "fu1"}]
        msgs2 = [{"role": "user", "content": "fu2"}]
        agent._followup_queue.put_nowait((msgs1, "one-at-a-time"))
        agent._followup_queue.put_nowait((msgs2, "one-at-a-time"))
        result = agent._drain_one_followup()
        assert result == (msgs1, "one-at-a-time")
        assert not agent._followup_queue.empty()

    def test_drain_one_followup_second_call_returns_second_item(self, cloud_model):
        """Sequential calls each return the next item."""
        agent = AgentLoop(model=cloud_model)
        msgs1 = [{"role": "user", "content": "fu1"}]
        msgs2 = [{"role": "user", "content": "fu2"}]
        agent._followup_queue.put_nowait((msgs1, "one-at-a-time"))
        agent._followup_queue.put_nowait((msgs2, "all"))
        agent._drain_one_followup()
        result = agent._drain_one_followup()
        assert result == (msgs2, "all")
        assert agent._followup_queue.empty()

    def test_drain_one_followup_empty_returns_none(self, cloud_model):
        """_drain_one_followup on an empty queue returns None."""
        agent = AgentLoop(model=cloud_model)
        assert agent._drain_one_followup() is None

    def test_handle_stall_increments_counter(self, cloud_model, tmp_path):
        """Calling _handle_stall with same signature set twice increments stall counter."""
        agent = AgentLoop(model=cloud_model, log_path=tmp_path / "agent.log")
        sig = frozenset({"read_source_file:{}"})
        # First call — no stall yet (last_sigs is None)
        stop, new_last, count = agent._handle_stall(sig, None, 0)
        assert not stop
        assert new_last == sig
        assert count == 0
        # Second call — same sig as last, stall detected
        stop, new_last, count = agent._handle_stall(sig, sig, 0)
        assert not stop  # nudge injected, not stopped yet
        assert count == 1
        # Third call — stall should stop now
        stop, new_last, count = agent._handle_stall(sig, sig, 1)
        assert stop
        assert count == 2

    def test_handle_stall_fires_1_to_n_same_call(self, cloud_model, tmp_path):
        """Stall fires when 1 call in turn A and N identical calls in turn B."""
        agent = AgentLoop(model=cloud_model, log_path=tmp_path / "agent.log")
        sig_one = frozenset({"read_source_file:foo.js"})
        sig_three = frozenset({"read_source_file:foo.js"})  # same sig, N copies deduped to set
        stop, new_last, count = agent._handle_stall(sig_three, sig_one, 0)
        assert not stop
        assert count == 1  # stall detected, nudge injected

    def test_handle_stall_fires_n_to_n_same_call(self, cloud_model, tmp_path):
        """Stall fires when N identical calls in both turns."""
        agent = AgentLoop(model=cloud_model, log_path=tmp_path / "agent.log")
        sig = frozenset({"read_source_file:foo.js"})
        stop, new_last, count = agent._handle_stall(sig, sig, 0)
        assert not stop
        assert count == 1

    def test_handle_stall_no_false_positive_different_calls(self, cloud_model, tmp_path):
        """Different tool calls across turns do not trigger stall detection."""
        agent = AgentLoop(model=cloud_model, log_path=tmp_path / "agent.log")
        sig_a = frozenset({"read_source_file:a.py"})
        sig_b = frozenset({"read_source_file:b.py"})
        stop, new_last, count = agent._handle_stall(sig_b, sig_a, 0)
        assert not stop
        assert new_last == sig_b
        assert count == 0  # no stall


class TestQueueDrainIntegration:
    """Integration: steer() and follow_up() work through _run_loop (REQ-ARCH-20)."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_steer_message_appears_before_next_api_call(self, MockOpenAI, cloud_model):
        """Messages queued via steer() are injected into the conversation after the
        current tool round, before the next API call."""
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        steer_msg = {"role": "user", "content": "steered!"}

        tc = make_tool_call("my_tool", "{}", call_id="t1")
        tool_resp = make_openai_response(content=None, tool_calls=[tc])
        tool_resp.choices[0].message.content = None
        final_resp = make_openai_response("done")
        mock_client.chat.completions.create.side_effect = [tool_resp, final_resp]

        loop = AgentLoop(
            model=cloud_model,
            tools=[{"type": "function", "function": {"name": "my_tool"}}],
            tool_handlers={"my_tool": lambda: "ok"},
            stream=False,
        )
        loop.steer([steer_msg])
        result = loop.send("go")

        assert result == "done"
        assert steer_msg in loop.messages
        # Two API calls were made
        assert mock_client.chat.completions.create.call_count == 2

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_follow_up_one_at_a_time_consumes_one_batch_per_stop(self, MockOpenAI, cloud_model):
        """drain='one-at-a-time' queues exactly one follow-up batch per natural stop."""
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        fu1 = [{"role": "user", "content": "fu1"}]
        fu2 = [{"role": "user", "content": "fu2"}]

        # 3 text responses: 1st/2nd trigger follow-up continuation, 3rd is the final exit
        mock_client.chat.completions.create.side_effect = [
            make_openai_response("t1"),
            make_openai_response("t2"),
            make_openai_response("t3"),
        ]

        loop = AgentLoop(model=cloud_model, stream=False)
        loop.follow_up(fu1, drain="one-at-a-time")
        loop.follow_up(fu2, drain="one-at-a-time")
        result = loop.send("go")

        assert result == "t3"
        assert mock_client.chat.completions.create.call_count == 3
        assert any(m == fu1[0] for m in loop.messages)
        assert any(m == fu2[0] for m in loop.messages)

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_follow_up_all_drain_mode_consumes_all_on_first_stop(self, MockOpenAI, cloud_model):
        """drain='all' on the first item drains every remaining follow-up in one stop."""
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        fu1 = [{"role": "user", "content": "fu1"}]
        fu2 = [{"role": "user", "content": "fu2"}]

        # 2 text responses: 1st stop drains everything, 2nd is the final exit
        mock_client.chat.completions.create.side_effect = [
            make_openai_response("t1"),
            make_openai_response("t2"),
        ]

        loop = AgentLoop(model=cloud_model, stream=False)
        loop.follow_up(fu1, drain="all")
        loop.follow_up(fu2, drain="one-at-a-time")
        result = loop.send("go")

        assert result == "t2"
        assert mock_client.chat.completions.create.call_count == 2
        assert any(m == fu1[0] for m in loop.messages)
        assert any(m == fu2[0] for m in loop.messages)


class TestSensitivePathRedaction:
    def test_sensitive_path_redacted_in_log(self, cloud_model, tmp_path):
        log = tmp_path / "agent.log"
        agent = AgentLoop(model=cloud_model, log_path=log)
        redacted = agent._redact_tool_result("read_source_file", '{"path": ".env"}', "SECRET=abc123")
        assert "SECRET" not in redacted
        assert "REDACTED" in redacted

    def test_non_sensitive_path_not_redacted(self, cloud_model):
        agent = AgentLoop(model=cloud_model)
        result = agent._redact_tool_result("read_source_file", '{"path": "src/main.py"}', "def main(): pass")
        assert "def main" in result

    def test_write_tool_not_redacted(self, cloud_model):
        agent = AgentLoop(model=cloud_model)
        result = agent._redact_tool_result("write_source_file", '{"path": ".env", "content": "x"}', "wrote .env")
        assert "wrote .env" in result


class TestClientLifecycle:
    """V-ARCH-21: REQ-ARCH-21 — OpenAI client closed after _run_loop."""

    def test_client_closed_on_normal_exit(self, cloud_model, tmp_path):
        """Client.close() is called when _run_loop returns normally."""
        agent = AgentLoop(model=cloud_model, system_prompt="test", stream=False,
                          log_path=tmp_path / "test.log")
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = make_openai_response("done")

        with patch.object(agent, "_get_client", return_value=mock_client):
            agent.send("hello")

        mock_client.close.assert_called_once()

    def test_client_closed_on_exception(self, cloud_model, tmp_path):
        """Client.close() is called even when _run_loop raises."""
        agent = AgentLoop(model=cloud_model, system_prompt="test", stream=False,
                          log_path=tmp_path / "test.log")
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = openai.AuthenticationError(
            message="bad key", response=MagicMock(status_code=401, headers={}), body=None,
        )

        with patch.object(agent, "_get_client", return_value=mock_client):
            with pytest.raises(RuntimeError):
                agent.send("hello")

        mock_client.close.assert_called_once()

    def test_old_client_closed_on_fallback(self, tmp_path):
        """Previous client is closed before fallback client is created."""
        primary = _mi(alias="primary", model_id="p", api_base="http://localhost:1/v1", api_key="k", fallback="fb")
        agent = AgentLoop(model=primary, system_prompt="test", stream=False,
                          log_path=tmp_path / "test.log")

        primary_client = MagicMock()
        fallback_client = MagicMock()
        call_count = [0]

        def mock_create(**kw):
            call_count[0] += 1
            if call_count[0] <= 3:
                raise openai.RateLimitError(
                    message="rate limited",
                    response=MagicMock(status_code=429, headers={}), body=None,
                )
            return make_openai_response("ok")

        primary_client.chat.completions.create = mock_create
        fallback_client.chat.completions.create = mock_create

        clients = iter([primary_client, fallback_client])
        fallback_mi = _mi(alias="fb", model_id="fb-model", api_base="http://localhost:2/v1", api_key="k")

        with patch.object(agent, "_get_client", side_effect=lambda: next(clients)):
            with patch("voidrift_cli.models.resolve_model", return_value=fallback_mi):
                agent.send("test")

        # Primary client was closed during fallback
        primary_client.close.assert_called()
        # Fallback client was closed in finally
        fallback_client.close.assert_called()


class TestAnthropicProtocol:
    """Tests for native Anthropic protocol support (REQ-ARCH-ANTHROPIC)."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_uses_anthropic_client_when_protocol_anthropic(
        self, MockAnthropic, MockOpenAI, anthropic_model
    ):
        """AnthropicAdapter creates an Anthropic client, never an OpenAI client."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = make_anthropic_response("Hello!")

        agent = AgentLoop(model=anthropic_model, stream=False)
        agent.send("hi")

        MockAnthropic.assert_called_once()
        MockOpenAI.assert_not_called()

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_simple_text_response(self, MockAnthropic, anthropic_model):
        """Anthropic text-only response is returned correctly."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = make_anthropic_response("Hello from Claude!")

        agent = AgentLoop(model=anthropic_model, stream=False)
        result = agent.send("hi")

        assert result == "Hello from Claude!"
        assert agent.messages[-1]["content"] == "Hello from Claude!"

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_tool_call_then_done(self, MockAnthropic, anthropic_model):
        """Anthropic tool_use → done tool → final text terminates the loop."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        tool_resp = make_anthropic_response(
            text=None,
            tool_uses=[make_anthropic_tool_use("read_file", {"path": "foo.py"}, "tu_1")],
            stop_reason="tool_use",
        )
        done_resp = make_anthropic_response(
            text=None,
            tool_uses=[make_anthropic_tool_use("done", {}, "tu_2")],
            stop_reason="tool_use",
        )
        final_resp = make_anthropic_response("All done.")
        mock_client.messages.create.side_effect = [tool_resp, done_resp, final_resp]

        agent = AgentLoop(model=anthropic_model, stream=False)
        agent.tools = [{"type": "function", "function": {"name": "read_file"}}]
        agent.tool_handlers = {"read_file": lambda path="": f"contents of {path}"}
        result = agent.send("read foo.py")

        assert result == "All done."
        assert mock_client.messages.create.call_count == 3
        tool_msgs = [m for m in agent.messages if m.get("role") == "tool"]
        assert any("foo.py" in m.get("content", "") for m in tool_msgs)

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_max_tokens_triggers_continuation(self, MockAnthropic, anthropic_model):
        """stop_reason=max_tokens without tool calls triggers a continuation call."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        truncated = make_anthropic_response("Partial text...", stop_reason="max_tokens")
        continuation = make_anthropic_response("...and the rest.")
        mock_client.messages.create.side_effect = [truncated, continuation]

        agent = AgentLoop(model=anthropic_model, stream=False)
        result = agent.send("write a long response")

        assert mock_client.messages.create.call_count == 2
        assert "Partial text" in result

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_retry_on_anthropic_rate_limit(self, MockAnthropic, anthropic_model):
        """RateLimitError on attempt 1 is retried; succeeds on attempt 2."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        rate_err = anthropic.RateLimitError(
            message="rate limited",
            response=MagicMock(status_code=429, headers={}),
            body=None,
        )
        success = make_anthropic_response("Success after retry!")
        mock_client.messages.create.side_effect = [rate_err, success]

        agent = AgentLoop(model=anthropic_model, stream=False)
        with patch("voidrift_cli.agent.time.sleep"):
            result = agent.send("hi")

        assert result == "Success after retry!"
        assert mock_client.messages.create.call_count == 2

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_no_retry_on_anthropic_auth_error(self, MockAnthropic, anthropic_model):
        """AuthenticationError is not retried — single attempt, RuntimeError propagated."""
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        auth_err = anthropic.AuthenticationError(
            message="invalid api key",
            response=MagicMock(status_code=401, headers={}),
            body=None,
        )
        mock_client.messages.create.side_effect = auth_err

        agent = AgentLoop(model=anthropic_model, stream=False)
        with pytest.raises(RuntimeError):
            agent.send("hi")

        assert mock_client.messages.create.call_count == 1


class TestTokenBudgetExceptionNarrowing:
    """Non-BudgetExhaustedError from token_budget.check() must propagate (TASK-A1)."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_attribute_error_from_check_propagates(self, MockOpenAI, cloud_model):
        """AttributeError from token_budget.check() is not swallowed as budget_exhausted.

        Before the fix, except Exception: silently converted any error into
        stop_reason='budget_exhausted'. After the fix, only BudgetExhaustedError
        is caught; other exceptions propagate.
        """
        from voidrift_cli.token_budget import BudgetExhaustedError

        # First call (start of loop iteration, line ~291): succeeds.
        # Second call (after tool processing, line ~495): raises AttributeError.
        mock_budget = MagicMock()
        mock_budget.check.side_effect = [None, AttributeError("internal budget bug")]

        tc = make_tool_call("my_tool", "{}", call_id="t1")
        tool_resp = make_openai_response(content=None, tool_calls=[tc])
        tool_resp.choices[0].message.content = None

        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = tool_resp

        loop = AgentLoop(
            model=cloud_model,
            tools=[{"type": "function", "function": {"name": "my_tool"}}],
            tool_handlers={"my_tool": lambda: "ok"},
            stream=False,
        )
        loop.token_budget = mock_budget

        with pytest.raises((RuntimeError, AttributeError)):
            loop.send("go")


class TestLoopExitTokens:
    """V-ARCH-18: LOOP_EXIT logs accurate token totals (REQ-ARCH-18, REQ-ARCH-13)."""

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_loop_exit_logs_accumulated_totals(self, MockOpenAI, cloud_model, tmp_path):
        """total_input and total_output in LOOP_EXIT reflect actual API usage."""
        log = tmp_path / "t.log"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        resp = make_openai_response("done", finish_reason="stop")
        resp.usage.prompt_tokens = 120
        resp.usage.completion_tokens = 45
        resp.usage.total_tokens = 165
        mock_client.chat.completions.create.return_value = resp

        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        agent.send("hello")

        log_text = log.read_text()
        assert "total_input=120" in log_text
        assert "total_output=45" in log_text

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_loop_exit_zero_when_provider_returns_no_usage(self, MockOpenAI, cloud_model, tmp_path):
        """When provider returns no usage data, totals are 0 — not an error."""
        log = tmp_path / "t.log"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        resp = make_openai_response("done", finish_reason="stop")
        resp.usage = None
        mock_client.chat.completions.create.return_value = resp

        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        agent.send("hello")

        log_text = log.read_text()
        assert "total_input=0" in log_text
        assert "total_output=0" in log_text

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_accumulates_across_multiple_turns(self, MockOpenAI, cloud_model, tmp_path):
        """Totals are cumulative across all turns in the session."""
        log = tmp_path / "t.log"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        tc = make_tool_call("my_tool", "{}", call_id="t1")
        turn1 = make_openai_response(content=None, tool_calls=[tc], finish_reason="tool_calls")
        turn1.choices[0].message.content = None
        turn1.usage.prompt_tokens = 100
        turn1.usage.completion_tokens = 20
        turn1.usage.total_tokens = 120

        turn2 = make_openai_response("done", finish_reason="stop")
        turn2.usage.prompt_tokens = 150
        turn2.usage.completion_tokens = 30
        turn2.usage.total_tokens = 180

        mock_client.chat.completions.create.side_effect = [turn1, turn2]

        agent = AgentLoop(
            model=cloud_model,
            tools=[{"type": "function", "function": {"name": "my_tool"}}],
            tool_handlers={"my_tool": lambda: "ok"},
            stream=False,
            log_path=log,
        )
        agent.send("go")

        log_text = log.read_text()
        assert "total_input=250" in log_text
        assert "total_output=50" in log_text

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_no_budget_still_accumulates(self, MockOpenAI, cloud_model, tmp_path):
        """Without a token_budget, loop accumulators track usage for LOOP_EXIT."""
        log = tmp_path / "t.log"
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client

        resp = make_openai_response("result", finish_reason="stop")
        resp.usage.prompt_tokens = 80
        resp.usage.completion_tokens = 15
        resp.usage.total_tokens = 95
        mock_client.chat.completions.create.return_value = resp

        agent = AgentLoop(model=cloud_model, stream=False, log_path=log)
        assert agent.token_budget is None
        agent.send("test")

        log_text = log.read_text()
        assert "total_input=80" in log_text
        assert "total_output=15" in log_text
