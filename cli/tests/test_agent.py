"""Tests for agent.py — agent loop with mocked OpenAI client."""

import json
from unittest.mock import patch, MagicMock, call

import openai
import pytest

from voidrift_cli.agent import AgentLoop, build_local_tools
from voidrift_cli.models import ModelConfig

from helpers import make_openai_response, make_tool_call


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
        m = ModelConfig(alias="c", model_id="anthropic/claude-4", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "claude-4"

    def test_model_name_strips_gemini(self):
        m = ModelConfig(alias="g", model_id="gemini/gemini-2.5-pro", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "gemini-2.5-pro"

    def test_model_name_no_prefix(self):
        m = ModelConfig(alias="x", model_id="plain-model", model_type="cloud")
        a = AgentLoop(model=m, stream=False)
        assert a._model_name() == "plain-model"


class TestAgentSend:
    @patch("voidrift_cli.agent.OpenAI")
    def test_simple_response(self, MockOpenAI, agent):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = make_openai_response("Hello!")

        result = agent.send("Hi")
        assert result == "Hello!"
        assert agent.messages[-1]["content"] == "Hello!"
        assert agent.messages[-2]["content"] == "Hi"

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
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
        cloud_model.api_base = "http://custom:1234/v1"
        cloud_model.api_key = "key123"
        a = AgentLoop(model=cloud_model, stream=False)
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
            MockOpenAI.return_value = MagicMock()
            MockOpenAI.return_value.chat.completions.create.return_value = make_openai_response()
            a.send("test")
            kwargs = MockOpenAI.call_args[1]
            assert kwargs["base_url"] == "http://custom:1234/v1"
            assert kwargs["api_key"] == "key123"

    def test_anthropic_config(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "ant-key")
        m = ModelConfig(alias="c", model_id="anthropic/claude", model_type="cloud", provider="anthropic")
        a = AgentLoop(model=m, stream=False)
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
            MockOpenAI.return_value = MagicMock()
            MockOpenAI.return_value.chat.completions.create.return_value = make_openai_response()
            a.send("test")
            kwargs = MockOpenAI.call_args[1]
            assert kwargs["api_key"] == "ant-key"
            assert "anthropic" in kwargs["base_url"]

    def test_gemini_config(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "gem-key")
        m = ModelConfig(alias="g", model_id="gemini/pro", model_type="cloud", provider="gemini")
        a = AgentLoop(model=m, stream=False)
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
            with patch("voidrift_cli.agent.time.sleep"):
                mock_client = MagicMock()
                MockOpenAI.return_value = mock_client
                mock_client.chat.completions.create.side_effect = [conn_err, success]
                agent.send("hi")
        log_content = log_file.read_text()
        assert "[RETRY]" in log_content


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

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
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


class TestMaxTokensRecovery:
    """V-ARCH-6a: REQ-ARCH-11 — max output token truncation detection and recovery."""

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
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

    @patch("voidrift_cli.agent.OpenAI")
    def test_tool_truncation_logged_not_blocked(self, MockOpenAI, cloud_model, tmp_path):
        """Given finish_reason='length' with tool calls, log warning and process normally."""
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
        final = make_openai_response("done", finish_reason="stop")
        mock_client.chat.completions.create.side_effect = [truncated_with_tools, final]

        result = agent.send("read file")
        assert result == "done"
        log_text = log.read_text()
        assert "[MAX_TOKENS_TOOL_TRUNCATION]" in log_text

    @patch("voidrift_cli.agent.OpenAI")
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
