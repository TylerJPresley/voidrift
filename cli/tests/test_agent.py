"""Tests for agent.py — agent loop with mocked OpenAI client."""

import json
from unittest.mock import patch, MagicMock, call

import pytest

from voidrift_cli.agent import AgentLoop, build_mcp_tools
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


class TestBuildMcpTools:
    def test_returns_tools_and_handlers(self):
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
        assert len(tools) > 0
        assert len(handlers) > 0
        for t in tools:
            name = t["function"]["name"]
            assert name in handlers, f"Tool {name} has no handler"

    def test_tool_format(self):
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, _ = build_mcp_tools(mcp_mod)
        for t in tools:
            assert t["type"] == "function"
            assert "name" in t["function"]
            assert "parameters" in t["function"]

    def test_expected_tools_present(self):
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
        expected = [
            "store_file_analysis", "get_file_analysis", "get_all_analyses",
            "store_requirements", "get_requirements",
            "get_skill", "read_source_file", "write_file", "export_to_file",
            "list_project_artifacts", "get_framework_resource",
        ]
        tool_names = {t["function"]["name"] for t in tools}
        for name in expected:
            assert name in tool_names, f"Missing tool: {name}"
