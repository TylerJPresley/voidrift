"""Unit tests for agent_protocol.py — OpenAIAdapter and AnthropicAdapter."""

import json
from unittest.mock import MagicMock, patch

import anthropic
import openai
import pytest

from voidrift_cli.agent_protocol import (
    AnthropicAdapter,
    OpenAIAdapter,
    get_adapter,
)
from helpers import (
    make_anthropic_response,
    make_anthropic_tool_use,
    make_openai_response,
    make_tool_call,
)


# ---------------------------------------------------------------------------
# get_adapter factory
# ---------------------------------------------------------------------------

class TestGetAdapter:
    def test_openai_protocol_returns_openai_adapter(self):
        assert isinstance(get_adapter("openai"), OpenAIAdapter)

    def test_anthropic_protocol_returns_anthropic_adapter(self):
        assert isinstance(get_adapter("anthropic"), AnthropicAdapter)

    def test_unknown_protocol_returns_openai_adapter(self):
        # Unrecognised protocol defaults to OpenAI-compatible
        assert isinstance(get_adapter("unknown"), OpenAIAdapter)


# ---------------------------------------------------------------------------
# OpenAIAdapter
# ---------------------------------------------------------------------------

class TestOpenAIAdapter:

    def setup_method(self):
        self.adapter = OpenAIAdapter()

    # --- build_request ---

    def test_strips_stream_key(self):
        req = self.adapter.build_request({"model": "m", "messages": [], "stream": True})
        assert "stream" not in req

    def test_strips_stream_options_key(self):
        req = self.adapter.build_request(
            {"model": "m", "messages": [], "stream_options": {"include_usage": True}}
        )
        assert "stream_options" not in req

    def test_passes_through_other_keys(self):
        req = self.adapter.build_request({"model": "gpt-4", "messages": [], "max_tokens": 512})
        assert req["model"] == "gpt-4"
        assert req["max_tokens"] == 512

    def test_anthropic_provider_adds_cache_control_to_system(self):
        req = self.adapter.build_request(
            {
                "model": "m",
                "messages": [{"role": "system", "content": "Be helpful."}],
            },
            provider="anthropic",
        )
        system_msg = req["messages"][0]
        assert isinstance(system_msg["content"], list)
        assert system_msg["content"][0]["cache_control"] == {"type": "ephemeral"}

    def test_non_anthropic_provider_leaves_system_as_string(self):
        req = self.adapter.build_request(
            {
                "model": "m",
                "messages": [{"role": "system", "content": "Be helpful."}],
            },
            provider="openai",
        )
        assert req["messages"][0]["content"] == "Be helpful."

    # --- parse_response ---

    def test_parse_text_response(self):
        raw = make_openai_response("Hello!")
        text, tool_calls, finish_reason, usage = self.adapter.parse_response(raw)
        assert text == "Hello!"
        assert tool_calls == []
        assert finish_reason == "stop"

    def test_parse_tool_call_response(self):
        tc = make_tool_call("my_tool", '{"arg": 1}', call_id="c1")
        raw = make_openai_response(content=None, tool_calls=[tc], finish_reason="tool_calls")
        text, tool_calls, finish_reason, usage = self.adapter.parse_response(raw)
        assert finish_reason == "tool_calls"
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "my_tool"
        assert tool_calls[0]["id"] == "c1"

    # --- is_retryable ---

    def test_rate_limit_is_retryable(self):
        exc = openai.RateLimitError("rate limited", response=MagicMock(), body={})
        assert self.adapter.is_retryable(exc) is True

    def test_connection_error_is_retryable(self):
        exc = openai.APIConnectionError(request=MagicMock())
        assert self.adapter.is_retryable(exc) is True

    def test_auth_error_not_retryable(self):
        exc = openai.AuthenticationError("bad key", response=MagicMock(), body={})
        assert self.adapter.is_retryable(exc) is False

    def test_context_length_error_not_retryable(self):
        exc = Exception("context length exceeded, please reduce")
        assert self.adapter.is_retryable(exc) is False

    # --- is_availability_error ---

    def test_rate_limit_is_availability_error(self):
        exc = openai.RateLimitError("rate limited", response=MagicMock(), body={})
        assert self.adapter.is_availability_error(exc) is True

    def test_auth_error_not_availability_error(self):
        exc = openai.AuthenticationError("bad key", response=MagicMock(status_code=401, headers={}), body={})
        assert self.adapter.is_availability_error(exc) is False

    # --- is_context_length_error ---

    def test_context_length_error_detected(self):
        exc = Exception("This model's maximum context length is exceeded")
        assert self.adapter.is_context_length_error(exc) is True

    def test_413_is_context_length_error(self):
        exc = openai.APIStatusError(
            "too large",
            response=MagicMock(status_code=413, headers={}),
            body=None,
        )
        assert self.adapter.is_context_length_error(exc) is True

    # --- get_retry_after ---

    def test_retry_after_header_parsed(self):
        exc = openai.APIStatusError(
            "rate limited",
            response=MagicMock(
                status_code=429,
                headers={"retry-after": "5"},
            ),
            body=None,
        )
        result = self.adapter.get_retry_after(exc)
        assert result == 5.0

    def test_no_retry_after_returns_none(self):
        exc = openai.APIConnectionError(request=MagicMock())
        assert self.adapter.get_retry_after(exc) is None

    # --- get_client ---

    @patch("voidrift_cli.agent_protocol.OpenAI")
    def test_get_client_uses_api_base(self, MockOpenAI):
        model = MagicMock()
        model.api_base = "http://example.com/v1"
        model.api_key = "key"
        model.provider = "openai"
        self.adapter.get_client(model)
        kwargs = MockOpenAI.call_args[1]
        assert kwargs["base_url"] == "http://example.com/v1"
        assert kwargs["api_key"] == "key"

    # --- iter_stream ---

    def test_iter_stream_text_with_usage(self):
        """Streaming text chunks followed by a usage-only chunk capture text and token counts."""
        def _text_chunk(text, finish=None):
            chunk = MagicMock()
            choice = MagicMock()
            choice.delta.content = text
            choice.delta.tool_calls = None
            choice.finish_reason = finish
            chunk.choices = [choice]
            return chunk

        def _usage_chunk():
            chunk = MagicMock()
            chunk.choices = []
            chunk.usage = MagicMock()
            chunk.usage.prompt_tokens = 10
            chunk.usage.completion_tokens = 5
            chunk.usage.total_tokens = 15
            return chunk

        chunks = [
            _text_chunk("Hello "),
            _text_chunk("world", finish="stop"),
            _usage_chunk(),
        ]
        emitted = []
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(chunks), emit_token=emitted.append, log_fn=lambda _: None
        )
        assert text == "Hello world"
        assert emitted == ["Hello ", "world"]
        assert finish_reason == "stop"
        assert tool_calls == []
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5
        assert usage["total_tokens"] == 15


# ---------------------------------------------------------------------------
# AnthropicAdapter
# ---------------------------------------------------------------------------

class TestAnthropicAdapter:

    def setup_method(self):
        self.adapter = AnthropicAdapter()

    # --- build_request ---

    def test_extracts_system_message(self):
        req = self.adapter.build_request({
            "model": "claude-sonnet-4-6",
            "messages": [
                {"role": "system", "content": "Be helpful."},
                {"role": "user", "content": "Hi"},
            ],
            "max_tokens": 1024,
        })
        assert req["system"] == "Be helpful."
        assert all(m["role"] != "system" for m in req["messages"])

    def test_anthropic_provider_wraps_system_in_cache_block(self):
        req = self.adapter.build_request(
            {
                "model": "claude-sonnet-4-6",
                "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "u"}],
                "max_tokens": 1024,
            },
            provider="anthropic",
        )
        assert isinstance(req["system"], list)
        assert req["system"][0]["cache_control"] == {"type": "ephemeral"}

    def test_strips_stream_key(self):
        req = self.adapter.build_request(
            {"model": "m", "messages": [], "stream": True, "max_tokens": 100}
        )
        assert "stream" not in req

    def test_strips_extra_body(self):
        req = self.adapter.build_request(
            {"model": "m", "messages": [], "extra_body": {"key": "val"}, "max_tokens": 100}
        )
        assert "extra_body" not in req

    def test_converts_tools_to_anthropic_format(self):
        tools = [{"type": "function", "function": {
            "name": "my_tool",
            "description": "Does something",
            "parameters": {"type": "object", "properties": {"x": {"type": "string"}}},
        }}]
        req = self.adapter.build_request(
            {"model": "m", "messages": [], "tools": tools, "max_tokens": 100}
        )
        assert "tools" in req
        assert req["tools"][0]["name"] == "my_tool"
        assert req["tools"][0]["input_schema"] == {"type": "object", "properties": {"x": {"type": "string"}}}

    def test_tool_choice_required_maps_to_any(self):
        req = self.adapter.build_request({
            "model": "m",
            "messages": [],
            "tools": [{"type": "function", "function": {"name": "t", "parameters": {}}}],
            "tool_choice": "required",
            "max_tokens": 100,
        })
        assert req["tool_choice"] == {"type": "any"}

    def test_tool_choice_auto_maps_to_auto(self):
        req = self.adapter.build_request({
            "model": "m",
            "messages": [],
            "tools": [{"type": "function", "function": {"name": "t", "parameters": {}}}],
            "tool_choice": "auto",
            "max_tokens": 100,
        })
        assert req["tool_choice"] == {"type": "auto"}

    def test_batches_consecutive_tool_results(self):
        """Consecutive role=tool messages are merged into a single role=user message."""
        req = self.adapter.build_request({
            "model": "m",
            "messages": [
                {"role": "user", "content": "go"},
                {"role": "assistant", "tool_calls": [
                    {"id": "tc1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                    {"id": "tc2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
                ]},
                {"role": "tool", "tool_call_id": "tc1", "content": "result_a"},
                {"role": "tool", "tool_call_id": "tc2", "content": "result_b"},
            ],
            "max_tokens": 100,
        })
        # The two tool results should be in a single user message
        user_msgs = [m for m in req["messages"] if m["role"] == "user"]
        # Last user message should have two tool_result blocks
        tool_results_msg = user_msgs[-1]
        assert isinstance(tool_results_msg["content"], list)
        assert len(tool_results_msg["content"]) == 2
        assert all(b["type"] == "tool_result" for b in tool_results_msg["content"])

    # --- parse_response ---

    def test_parse_text_response(self):
        raw = make_anthropic_response("Hello from Claude!")
        text, tool_calls, finish_reason, usage = self.adapter.parse_response(raw)
        assert text == "Hello from Claude!"
        assert tool_calls == []
        assert finish_reason == "stop"

    def test_parse_tool_use_response(self):
        raw = make_anthropic_response(
            text=None,
            tool_uses=[make_anthropic_tool_use("my_tool", {"x": 1}, "tu1")],
            stop_reason="tool_use",
        )
        text, tool_calls, finish_reason, usage = self.adapter.parse_response(raw)
        assert finish_reason == "tool_calls"
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "my_tool"
        assert json.loads(tool_calls[0]["function"]["arguments"]) == {"x": 1}
        assert tool_calls[0]["id"] == "tu1"

    def test_parse_max_tokens_stop_reason(self):
        raw = make_anthropic_response("Partial", stop_reason="max_tokens")
        _, _, finish_reason, _ = self.adapter.parse_response(raw)
        assert finish_reason == "length"

    def test_parse_usage_fields(self):
        raw = make_anthropic_response("Hi")
        raw.usage.input_tokens = 100
        raw.usage.output_tokens = 50
        raw.usage.cache_creation_input_tokens = 10
        raw.usage.cache_read_input_tokens = 5
        _, _, _, usage = self.adapter.parse_response(raw)
        assert usage["prompt_tokens"] == 100
        assert usage["completion_tokens"] == 50
        assert usage["cache_creation_input_tokens"] == 10
        assert usage["cache_read_input_tokens"] == 5

    # --- is_retryable ---

    def test_rate_limit_is_retryable(self):
        exc = anthropic.RateLimitError(
            message="rate limited",
            response=MagicMock(status_code=429, headers={}),
            body=None,
        )
        assert self.adapter.is_retryable(exc) is True

    def test_connection_error_is_retryable(self):
        exc = anthropic.APIConnectionError(request=MagicMock())
        assert self.adapter.is_retryable(exc) is True

    def test_auth_error_not_retryable(self):
        exc = anthropic.AuthenticationError(
            message="bad key",
            response=MagicMock(status_code=401, headers={}),
            body=None,
        )
        assert self.adapter.is_retryable(exc) is False

    # --- is_availability_error ---

    def test_rate_limit_is_availability_error(self):
        exc = anthropic.RateLimitError(
            message="rate limited",
            response=MagicMock(status_code=429, headers={}),
            body=None,
        )
        assert self.adapter.is_availability_error(exc) is True

    def test_auth_error_not_availability_error(self):
        exc = anthropic.AuthenticationError(
            message="bad key",
            response=MagicMock(status_code=401, headers={}),
            body=None,
        )
        assert self.adapter.is_availability_error(exc) is False

    # --- is_context_length_error ---

    def test_413_is_context_length_error(self):
        exc = anthropic.APIStatusError(
            "too large",
            response=MagicMock(status_code=413, headers={}),
            body=None,
        )
        assert self.adapter.is_context_length_error(exc) is True

    def test_context_length_msg_detected(self):
        exc = Exception("tokens exceed context length limit")
        assert self.adapter.is_context_length_error(exc) is True

    # --- iter_stream ---

    def test_iter_stream_text_only(self):
        """iter_stream collects text deltas and calls emit_token (real SDK types)."""
        events = [
            _sdk_message_start(10),
            _sdk_text_block_start(0),
            _sdk_text_delta(0, "Hello "),
            _sdk_text_delta(0, "world"),
            _sdk_block_stop(0),
            _sdk_message_delta("end_turn", 5),
            _sdk_message_stop(),
        ]
        emitted = []
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=emitted.append, log_fn=lambda _: None
        )
        assert text == "Hello world"
        assert emitted == ["Hello ", "world"]
        assert finish_reason == "stop"
        assert tool_calls == []
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5

    def test_iter_stream_tool_use(self):
        """iter_stream assembles tool_use blocks into tool_calls list (real SDK types)."""
        events = [
            _sdk_message_start(20),
            _sdk_tool_block_start(0, "tu1", "my_tool"),
            _sdk_json_delta(0, '{"x":'),
            _sdk_json_delta(0, " 42}"),
            _sdk_block_stop(0),
            _sdk_message_delta("tool_use", 8),
            _sdk_message_stop(),
        ]
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=lambda _: None, log_fn=lambda _: None
        )
        assert finish_reason == "tool_calls"
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "my_tool"
        assert json.loads(tool_calls[0]["function"]["arguments"]) == {"x": 42}
        assert tool_calls[0]["id"] == "tu1"

    # --- compact_call ---

    def test_compact_call_returns_first_text_block(self):
        """compact_call returns text from a normal text-only response."""
        client = MagicMock()
        block = MagicMock()
        block.type = "text"
        block.text = "summary text"
        client.messages.create.return_value.content = [block]
        result = self.adapter.compact_call(client, "summarise this", "claude-sonnet-4-6")
        assert result == "summary text"

    def test_compact_call_skips_thinking_block(self):
        """compact_call skips thinking blocks and returns the first real text block."""
        client = MagicMock()
        thinking_block = MagicMock()
        thinking_block.type = "thinking"
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "the actual summary"
        client.messages.create.return_value.content = [thinking_block, text_block]
        result = self.adapter.compact_call(client, "summarise this", "claude-sonnet-4-6")
        assert result == "the actual summary"

    def test_compact_call_returns_empty_when_no_text_block(self):
        """compact_call returns empty string when response contains no text block."""
        client = MagicMock()
        thinking_block = MagicMock()
        thinking_block.type = "thinking"
        client.messages.create.return_value.content = [thinking_block]
        result = self.adapter.compact_call(client, "summarise this", "claude-sonnet-4-6")
        assert result == ""

    # --- get_client ---

    @patch("voidrift_cli.agent_protocol.anthropic.Anthropic")
    def test_get_client_uses_api_base(self, MockAnthropic):
        model = MagicMock()
        model.api_base = "https://custom.api.com"
        model.api_key = "key123"
        self.adapter.get_client(model)
        kwargs = MockAnthropic.call_args[1]
        assert kwargs["base_url"] == "https://custom.api.com"
        assert kwargs["api_key"] == "key123"


# ---------------------------------------------------------------------------
# Stream event helpers — real Anthropic SDK types (not MagicMocks)
# ---------------------------------------------------------------------------

from anthropic.types import (
    InputJSONDelta,
    Message,
    MessageDeltaUsage,
    RawContentBlockDeltaEvent,
    RawContentBlockStartEvent,
    RawContentBlockStopEvent,
    RawMessageDeltaEvent,
    RawMessageStartEvent,
    RawMessageStopEvent,
    TextBlock,
    TextDelta,
    ThinkingBlock,
    ThinkingDelta,
    ToolUseBlock,
    Usage,
)
from anthropic.types.raw_message_delta_event import Delta as _MessageDelta


def _sdk_message_start(input_tokens: int) -> RawMessageStartEvent:
    msg = Message(
        id="msg_test",
        content=[],
        model="claude-sonnet-4-6",
        role="assistant",
        stop_reason=None,
        stop_sequence=None,
        type="message",
        usage=Usage(input_tokens=input_tokens, output_tokens=0),
    )
    return RawMessageStartEvent(type="message_start", message=msg)


def _sdk_text_block_start(index: int) -> RawContentBlockStartEvent:
    return RawContentBlockStartEvent(
        type="content_block_start",
        index=index,
        content_block=TextBlock(type="text", text=""),
    )


def _sdk_tool_block_start(index: int, tool_id: str, name: str) -> RawContentBlockStartEvent:
    return RawContentBlockStartEvent(
        type="content_block_start",
        index=index,
        content_block=ToolUseBlock(type="tool_use", id=tool_id, name=name, input={}),
    )


def _sdk_text_delta(index: int, text: str) -> RawContentBlockDeltaEvent:
    return RawContentBlockDeltaEvent(
        type="content_block_delta",
        index=index,
        delta=TextDelta(type="text_delta", text=text),
    )


def _sdk_json_delta(index: int, partial: str) -> RawContentBlockDeltaEvent:
    return RawContentBlockDeltaEvent(
        type="content_block_delta",
        index=index,
        delta=InputJSONDelta(type="input_json_delta", partial_json=partial),
    )


def _sdk_block_stop(index: int) -> RawContentBlockStopEvent:
    return RawContentBlockStopEvent(type="content_block_stop", index=index)


def _sdk_message_delta(stop_reason: str, output_tokens: int) -> RawMessageDeltaEvent:
    return RawMessageDeltaEvent(
        type="message_delta",
        delta=_MessageDelta(stop_reason=stop_reason, stop_sequence=None),
        usage=MessageDeltaUsage(output_tokens=output_tokens),
    )


def _sdk_message_stop() -> RawMessageStopEvent:
    return RawMessageStopEvent(type="message_stop")


def _sdk_think_block_start(index: int) -> RawContentBlockStartEvent:
    return RawContentBlockStartEvent(
        type="content_block_start",
        index=index,
        content_block=ThinkingBlock(type="thinking", thinking="", signature="sig"),
    )


def _sdk_thinking_delta(index: int, thinking: str) -> RawContentBlockDeltaEvent:
    return RawContentBlockDeltaEvent(
        type="content_block_delta",
        index=index,
        delta=ThinkingDelta(type="thinking_delta", thinking=thinking),
    )


# ---------------------------------------------------------------------------
# TestAnthropicAdapterStreamRealSDK — same scenarios using real SDK event types
# ---------------------------------------------------------------------------

class TestAnthropicAdapterStreamRealSDK:
    """Streaming tests with actual Anthropic SDK event objects (not MagicMocks).

    These tests eliminate the risk that mock attribute access hides real SDK
    structure differences (REQ-ARCH-22 confidence gap).
    """

    def setup_method(self):
        self.adapter = AnthropicAdapter()

    def test_text_only_stream(self):
        events = [
            _sdk_message_start(10),
            _sdk_text_block_start(0),
            _sdk_text_delta(0, "Hello "),
            _sdk_text_delta(0, "world"),
            _sdk_block_stop(0),
            _sdk_message_delta("end_turn", 5),
            _sdk_message_stop(),
        ]
        emitted = []
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=emitted.append, log_fn=lambda _: None
        )
        assert text == "Hello world"
        assert emitted == ["Hello ", "world"]
        assert finish_reason == "stop"
        assert tool_calls == []
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5

    def test_tool_use_stream(self):
        events = [
            _sdk_message_start(20),
            _sdk_tool_block_start(0, "tu1", "my_tool"),
            _sdk_json_delta(0, '{"x":'),
            _sdk_json_delta(0, " 42}"),
            _sdk_block_stop(0),
            _sdk_message_delta("tool_use", 8),
            _sdk_message_stop(),
        ]
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=lambda _: None, log_fn=lambda _: None
        )
        assert finish_reason == "tool_calls"
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "my_tool"
        assert json.loads(tool_calls[0]["function"]["arguments"]) == {"x": 42}
        assert tool_calls[0]["id"] == "tu1"
        assert usage["prompt_tokens"] == 20
        assert usage["completion_tokens"] == 8

    def test_max_tokens_stream(self):
        events = [
            _sdk_message_start(15),
            _sdk_text_block_start(0),
            _sdk_text_delta(0, "Partial..."),
            _sdk_block_stop(0),
            _sdk_message_delta("max_tokens", 3),
            _sdk_message_stop(),
        ]
        text, _, finish_reason, _ = self.adapter.iter_stream(
            iter(events), emit_token=lambda _: None, log_fn=lambda _: None
        )
        assert finish_reason == "length"
        assert text == "Partial..."

    def test_text_and_tool_use_mixed(self):
        """Text block followed by tool_use block in the same response."""
        events = [
            _sdk_message_start(25),
            _sdk_text_block_start(0),
            _sdk_text_delta(0, "Let me check that."),
            _sdk_block_stop(0),
            _sdk_tool_block_start(1, "tu2", "lookup"),
            _sdk_json_delta(1, '{"q": "test"}'),
            _sdk_block_stop(1),
            _sdk_message_delta("tool_use", 12),
            _sdk_message_stop(),
        ]
        emitted = []
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=emitted.append, log_fn=lambda _: None
        )
        assert text == "Let me check that."
        assert emitted == ["Let me check that."]
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "lookup"
        assert finish_reason == "tool_calls"

    def test_think_block_stream(self):
        """Think block spanning two thinking_delta events: logged via log_fn, excluded from text."""
        events = [
            _sdk_message_start(12),
            _sdk_think_block_start(0),
            _sdk_thinking_delta(0, "Let me think "),
            _sdk_thinking_delta(0, "about this."),
            _sdk_block_stop(0),
            _sdk_text_block_start(1),
            _sdk_text_delta(1, "Answer."),
            _sdk_block_stop(1),
            _sdk_message_delta("end_turn", 6),
            _sdk_message_stop(),
        ]
        logged = []
        emitted = []
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=emitted.append, log_fn=logged.append
        )
        assert text == "Answer."
        assert emitted == ["Answer."]
        assert len(logged) == 1
        assert "[THINKING]" in logged[0]
        assert "Let me think" in logged[0]
        assert "about this." in logged[0]
        assert finish_reason == "stop"
        assert tool_calls == []

    def test_tool_use_stream_three_chunks(self):
        """Tool call JSON split across three input_json_delta events produces correct arguments."""
        events = [
            _sdk_message_start(18),
            _sdk_tool_block_start(0, "tu3", "search"),
            _sdk_json_delta(0, '{"q":'),
            _sdk_json_delta(0, ' "py'),
            _sdk_json_delta(0, 'thon"}'),
            _sdk_block_stop(0),
            _sdk_message_delta("tool_use", 7),
            _sdk_message_stop(),
        ]
        text, tool_calls, finish_reason, usage = self.adapter.iter_stream(
            iter(events), emit_token=lambda _: None, log_fn=lambda _: None
        )
        assert finish_reason == "tool_calls"
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "search"
        assert json.loads(tool_calls[0]["function"]["arguments"]) == {"q": "python"}
        assert tool_calls[0]["id"] == "tu3"
        assert text == ""


# ---------------------------------------------------------------------------
# REQ-ARCH-20 — stream_options only for known providers
# ---------------------------------------------------------------------------

class TestStreamOptions:
    """V-ARCH-20: stream_options injected for known providers only (REQ-ARCH-20)."""

    def setup_method(self):
        self.adapter = OpenAIAdapter()

    def test_openai_provider_gets_stream_options(self):
        """provider='openai' → stream_options in wire request."""
        req = self.adapter.build_request(
            {"model": "gpt-4o", "messages": []},
            provider="openai",
        )
        assert req.get("stream_options") == {"include_usage": True}

    def test_anthropic_provider_gets_stream_options(self):
        """provider='anthropic' (via OpenAI compat) → stream_options in wire request."""
        req = self.adapter.build_request(
            {"model": "claude-4", "messages": []},
            provider="anthropic",
        )
        assert req.get("stream_options") == {"include_usage": True}

    def test_gemini_provider_gets_stream_options(self):
        """provider='gemini' → stream_options in wire request."""
        req = self.adapter.build_request(
            {"model": "gemini-2.5-pro", "messages": []},
            provider="gemini",
        )
        assert req.get("stream_options") == {"include_usage": True}

    def test_no_provider_omits_stream_options(self):
        """Generic OpenAI-compatible (no provider) → stream_options absent."""
        req = self.adapter.build_request(
            {"model": "local-model", "messages": []},
            provider="",
        )
        assert "stream_options" not in req

    def test_unrecognized_provider_omits_stream_options(self):
        """Unknown cloud provider → stream_options absent."""
        req = self.adapter.build_request(
            {"model": "glm-4", "messages": []},
            provider="z.ai",
        )
        assert "stream_options" not in req

    def test_vllm_provider_omits_stream_options(self):
        """Local vLLM (no provider set) → stream_options absent."""
        req = self.adapter.build_request(
            {"model": "qwen3", "messages": []},
            provider="vllm",
        )
        assert "stream_options" not in req

    def test_caller_cannot_inject_stream_options(self):
        """Caller-supplied stream_options is stripped then re-applied only for known providers.

        For an unknown provider the incoming stream_options must not survive.
        """
        req = self.adapter.build_request(
            {"model": "m", "messages": [], "stream_options": {"include_usage": True}},
            provider="",
        )
        assert "stream_options" not in req

    def test_decision_in_build_request_not_create_raw_stream(self):
        """create_raw_stream passes wire_request through without adding stream_options itself."""
        mock_client = MagicMock()
        captured: list[dict] = []

        def fake_create(**kw):
            captured.append(kw)
            stream = MagicMock()
            stream.__iter__ = MagicMock(return_value=iter([]))
            return stream

        mock_client.chat.completions.create.side_effect = fake_create
        # Wire request already has stream_options set (as build_request would for openai)
        wire_req = {"model": "m", "messages": [], "stream_options": {"include_usage": True}}
        self.adapter.create_raw_stream(mock_client, wire_req)

        assert mock_client.chat.completions.create.called
        call_kwargs = mock_client.chat.completions.create.call_args[1]
        # create_raw_stream should not add another stream_options — it's already in wire_req
        assert call_kwargs.get("stream") is True
        # The stream_options from wire_req is passed through unchanged
        assert call_kwargs.get("stream_options") == {"include_usage": True}
