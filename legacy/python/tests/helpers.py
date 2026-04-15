"""Test helpers for CLI tests — mock OpenAI and Anthropic responses."""

from unittest.mock import MagicMock


def make_openai_response(content: str = "test response", tool_calls=None, finish_reason="stop"):
    """Build a mock OpenAI ChatCompletion response."""
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    msg.model_dump.return_value = {
        "role": "assistant",
        "content": content,
        "tool_calls": None,
    }
    choice = MagicMock()
    choice.message = msg
    choice.finish_reason = finish_reason
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def make_tool_call(name: str, arguments: str, call_id: str = "call_1"):
    """Build a mock tool call object."""
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = name
    tc.function.arguments = arguments
    return tc


def make_anthropic_response(text="test response", tool_uses=None, stop_reason="end_turn"):
    """Build a mock anthropic.types.Message."""
    content = []
    if text:
        b = MagicMock()
        b.type = "text"
        b.text = text
        content.append(b)
    for tu in (tool_uses or []):
        b = MagicMock()
        b.type = "tool_use"
        b.id = tu["id"]
        b.name = tu["name"]
        b.input = tu["input"]
        content.append(b)
    resp = MagicMock()
    resp.content = content
    resp.stop_reason = stop_reason
    resp.usage = MagicMock()
    resp.usage.input_tokens = 10
    resp.usage.output_tokens = 5
    resp.usage.cache_creation_input_tokens = 0
    resp.usage.cache_read_input_tokens = 0
    return resp


def make_anthropic_tool_use(name, input_dict, use_id="toolu_1"):
    """Build a tool_use dict for make_anthropic_response."""
    return {"id": use_id, "name": name, "input": input_dict}
