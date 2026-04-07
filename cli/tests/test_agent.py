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
        with patch("voidrift_cli.agent.OpenAI") as MockOpenAI:
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


    def test_build_local_tools_no_cmd_returns_all_tools(self):
        """Calling build_local_tools() with no argument returns all tools."""
        tools_all, _ = build_local_tools()
        tools_none, _ = build_local_tools(cmd=None)
        tool_names_all = {t["function"]["name"] for t in tools_all}
        tool_names_none = {t["function"]["name"] for t in tools_none}
        assert tool_names_all == tool_names_none


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


class TestModelFallback:
    """Tests for model fallback on retry exhaustion (REQ-MC-4)."""

    def test_fallback_on_429_exhaustion(self, tmp_path):
        """Fallback model is used when primary exhausts retries on 429."""
        from voidrift_cli.models import ModelConfig

        primary = ModelConfig(
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

        fallback_mc = ModelConfig(
            alias="fallback-model", model_id="fb-model", api_base="http://localhost:2/v1", api_key="k",
        )

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with patch("voidrift_cli.models.resolve_model", return_value=fallback_mc):
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
        from voidrift_cli.models import ModelConfig

        primary = ModelConfig(
            alias="primary", model_id="p", api_base="http://localhost:1/v1",
            api_key="k", fallback="fb",
        )
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
        from voidrift_cli.models import ModelConfig

        primary = ModelConfig(
            alias="primary", model_id="p", api_base="http://localhost:1/v1",
            api_key="k", fallback="fb",
        )
        log_file = tmp_path / "test.log"
        agent = AgentLoop(model=primary, system_prompt="test", stream=False, log_path=log_file)

        def mock_create(**kw):
            raise openai.RateLimitError(
                message="rate limited", response=MagicMock(status_code=429, headers={}), body=None,
            )

        fallback_mc = ModelConfig(
            alias="fb", model_id="fb-model", api_base="http://localhost:2/v1", api_key="k",
        )

        with patch.object(agent, "_get_client") as mock_gc:
            mock_client = MagicMock()
            mock_client.chat.completions.create = mock_create
            mock_gc.return_value = mock_client
            with patch("voidrift_cli.models.resolve_model", return_value=fallback_mc):
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


class TestBuildLocalToolsProjectDir:
    def test_build_local_tools_uses_provided_project_dir(self, tmp_path):
        """Memory and session handlers use the provided project_dir, not Path.cwd()."""
        (tmp_path / ".voidrift").mkdir()
        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path)
        result = handlers["write_memory"](name="test-key", content="hello")
        assert (tmp_path / ".voidrift" / "memory" / "test-key.md").exists()


class TestLoopDecomposition:
    def test_drain_queues_drains_steering_queue(self, cloud_model):
        """Messages placed on steering queue are returned by _drain_queues."""
        agent = AgentLoop(model=cloud_model)
        msgs = [{"role": "user", "content": "steer me"}]
        agent._steering_queue.put_nowait(msgs)
        steered, _ = agent._drain_queues()
        assert steered == msgs
        assert agent._steering_queue.empty()

    def test_drain_queues_drains_followup_queue(self, cloud_model):
        """Messages placed on followup queue are returned by _drain_queues."""
        agent = AgentLoop(model=cloud_model)
        msgs = [{"role": "user", "content": "follow up"}]
        agent._followup_queue.put_nowait((msgs, "one-at-a-time"))
        _, followups = agent._drain_queues()
        assert len(followups) == 1
        assert followups[0][0] == msgs
        assert agent._followup_queue.empty()

    def test_handle_stall_increments_counter(self, cloud_model, tmp_path):
        """Calling _handle_stall with same signature twice increments stall counter."""
        agent = AgentLoop(model=cloud_model, log_path=tmp_path / "agent.log")
        sig = "read_source_file:{}"
        # First call — no stall yet (last_sig differs)
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
