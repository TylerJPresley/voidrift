"""Protocol adapters — isolate wire format differences from the agent loop.

AgentLoop stores message history in OpenAI format. Adapters convert to/from
wire format at the API boundary. The loop itself has no protocol branches.
"""

from __future__ import annotations

import json
import itertools
import re
import sys
import threading
from abc import ABC, abstractmethod
from typing import Any, Callable

import httpx
import openai
import anthropic
from openai import OpenAI


# (text, tool_calls_openai_format, finish_reason_canonical, usage_dict)
# usage keys: prompt_tokens, completion_tokens,
#             cache_creation_input_tokens, cache_read_input_tokens
ParseResult = tuple[str, list[dict], str | None, dict]


class ProtocolAdapter(ABC):

    @abstractmethod
    def get_client(self, model: Any) -> Any:
        """Create the SDK client for this protocol (model is ModelConfig)."""

    @abstractmethod
    def build_request(self, openai_kwargs: dict, provider: str = "") -> dict:
        """Convert OpenAI-format kwargs to wire format.

        Handles: system extraction, tool conversion, tool_choice conversion,
        cache control. Does NOT include 'stream' — callers add it.
        Strips 'stream' and 'stream_options' keys if present.
        """

    @abstractmethod
    def create_raw(self, client: Any, wire_request: dict) -> Any:
        """Execute one non-streaming API call. No retry. Raises on error."""

    @abstractmethod
    def create_raw_stream(self, client: Any, wire_request: dict) -> Any:
        """Execute one streaming API call. No retry. Returns iterable."""

    @abstractmethod
    def parse_response(self, raw: Any, log_fn: Callable[[str], None] | None = None) -> ParseResult:
        """Parse sync response to (text, tool_calls, finish_reason, usage)."""

    @abstractmethod
    def iter_stream(
        self,
        stream: Any,
        emit_token: Callable[[str], None],
        log_fn: Callable[[str], None],
    ) -> ParseResult:
        """Process stream. Calls emit_token for visible text, log_fn for thinking/debug."""

    @abstractmethod
    def is_retryable(self, exc: Exception) -> bool: ...

    @abstractmethod
    def is_availability_error(self, exc: Exception) -> bool: ...

    @abstractmethod
    def is_context_length_error(self, exc: Exception) -> bool: ...

    @abstractmethod
    def is_context_truncation(self, exc: Exception) -> bool: ...

    @abstractmethod
    def get_retry_after(self, exc: Exception) -> float | None: ...

    @abstractmethod
    def compact_call(self, client: Any, content: str, model_name: str) -> str:
        """Summarization call used by reactive_compact. content is the full message content.
        Returns summary text."""


class OpenAIAdapter(ProtocolAdapter):

    def get_client(self, model: Any) -> Any:
        kwargs: dict[str, Any] = {}
        if model.api_base:
            kwargs["base_url"] = model.api_base
        if model.api_key:
            kwargs["api_key"] = model.api_key
        return OpenAI(
            timeout=httpx.Timeout(connect=30.0, read=600.0, write=60.0, pool=30.0),
            **kwargs,
        )

    # Providers known to support stream_options={"include_usage": true} (REQ-ARCH-20)
    _STREAM_USAGE_PROVIDERS = frozenset({"openai", "anthropic", "gemini"})

    def build_request(self, openai_kwargs: dict, provider: str = "") -> dict:
        result = dict(openai_kwargs)
        result.pop("stream", None)
        result.pop("stream_options", None)
        if provider == "anthropic":
            messages = result.get("messages", [])
            updated = []
            for m in messages:
                if m.get("role") == "system" and isinstance(m.get("content"), str):
                    updated.append({
                        "role": "system",
                        "content": [{"type": "text", "text": m["content"], "cache_control": {"type": "ephemeral"}}],
                    })
                else:
                    updated.append(m)
            result["messages"] = updated
        # Only request streaming usage from providers known to support it (REQ-ARCH-20)
        if provider in self._STREAM_USAGE_PROVIDERS:
            result["stream_options"] = {"include_usage": True}
        return result

    def create_raw(self, client: Any, wire_request: dict) -> Any:
        return client.chat.completions.create(**wire_request)

    def create_raw_stream(self, client: Any, wire_request: dict) -> Any:
        # stream_options already injected by build_request for supported providers (REQ-ARCH-20)
        return client.chat.completions.create(**wire_request, stream=True)

    def parse_response(self, raw: Any, log_fn: Callable[[str], None] | None = None) -> ParseResult:
        choice = raw.choices[0]
        msg = choice.message
        finish_reason = getattr(choice, "finish_reason", None)
        text = msg.content or ""
        tool_calls = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_calls.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                })
        usage = {}
        if raw.usage:
            usage = {
                "prompt_tokens": raw.usage.prompt_tokens or 0,
                "completion_tokens": raw.usage.completion_tokens or 0,
                "total_tokens": getattr(raw.usage, "total_tokens", 0) or 0,
                "cache_creation_input_tokens": getattr(raw.usage, "cache_creation_input_tokens", 0) or 0,
                "cache_read_input_tokens": getattr(raw.usage, "cache_read_input_tokens", 0) or 0,
            }
        return text, tool_calls, finish_reason, usage

    def iter_stream(
        self,
        stream: Any,
        emit_token: Callable[[str], None],
        log_fn: Callable[[str], None],
    ) -> ParseResult:
        collected_text = ""
        collected_tool_calls: dict[int, dict] = {}
        usage_data: dict = {}
        finish_reason: str | None = None

        in_think = False
        think_buf = ""
        pending = ""

        try:
            for chunk in stream:
                if not chunk.choices:
                    if hasattr(chunk, "usage") and chunk.usage:
                        usage_data = {
                            "prompt_tokens": chunk.usage.prompt_tokens or 0,
                            "completion_tokens": chunk.usage.completion_tokens or 0,
                            "total_tokens": chunk.usage.total_tokens or 0,
                        }
                    continue
                delta = chunk.choices[0].delta
                if chunk.choices[0].finish_reason:
                    finish_reason = chunk.choices[0].finish_reason

                if delta.content:
                    collected_text += delta.content

                    pending += delta.content
                    while pending:
                        if in_think:
                            end_idx = pending.find("</think>")
                            if end_idx != -1:
                                think_buf += pending[:end_idx]
                                if think_buf.strip():
                                    log_fn(f"[THINKING] {think_buf.strip()}")
                                think_buf = ""
                                in_think = False
                                pending = pending[end_idx + 8:].lstrip()
                            else:
                                think_buf += pending
                                pending = ""
                        else:
                            start_idx = pending.find("<think>")
                            if start_idx != -1:
                                before = pending[:start_idx]
                                if before:
                                    emit_token(before)
                                in_think = True
                                pending = pending[start_idx + 7:]
                            elif "<" in pending and not pending.endswith(">"):
                                last_lt = pending.rfind("<")
                                partial = pending[last_lt:]
                                if "<think>"[:len(partial)] == partial:
                                    before = pending[:last_lt]
                                    if before:
                                        emit_token(before)
                                    pending = partial
                                    break
                                else:
                                    emit_token(pending)
                                    pending = ""
                            else:
                                emit_token(pending)
                                pending = ""

                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in collected_tool_calls:
                            collected_tool_calls[idx] = {
                                "id": tc_delta.id or "",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        tc = collected_tool_calls[idx]
                        if tc_delta.id:
                            tc["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                tc["function"]["name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                tc["function"]["arguments"] += tc_delta.function.arguments
        finally:
            if pending and not in_think:
                emit_token(pending)
            if in_think and think_buf.strip():
                log_fn(f"[THINKING] {think_buf.strip()}")

        tool_calls_list = [collected_tool_calls[i] for i in sorted(collected_tool_calls)]
        return collected_text, tool_calls_list, finish_reason, usage_data

    def is_retryable(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        if "context length" in msg or "maximum context" in msg:
            return False
        if "token" in msg and "exceed" in msg:
            return False
        if isinstance(exc, openai.AuthenticationError):
            return False
        if isinstance(exc, (openai.APIConnectionError, openai.RateLimitError)):
            return True
        if isinstance(exc, openai.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
        if "connection" in msg or "timeout" in msg:
            return True
        return False

    def is_availability_error(self, exc: Exception) -> bool:
        if isinstance(exc, openai.RateLimitError):
            return True
        if isinstance(exc, openai.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
        return False

    def is_context_length_error(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        if "context length" in msg or "maximum context" in msg:
            return True
        if "token" in msg and "exceed" in msg:
            return True
        if isinstance(exc, openai.APIStatusError) and exc.status_code == 413:
            return True
        return False

    def is_context_truncation(self, exc: Exception) -> bool:
        msg = str(exc)
        return (
            "json_invalid" in msg
            or ("EOF while parsing" in msg and ("list" in msg or "object" in msg))
            or ("validation error" in msg and "EOF" in msg)
        )

    def get_retry_after(self, exc: Exception) -> float | None:
        if isinstance(exc, openai.APIStatusError) and exc.status_code == 429:
            header = exc.response.headers.get("retry-after")
            if header:
                try:
                    return min(float(header), 30.0)
                except (ValueError, TypeError):
                    pass
        return None

    def compact_call(self, client: Any, content: str, model_name: str) -> str:
        resp = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            max_tokens=1024,
        )
        return resp.choices[0].message.content or ""


class AnthropicAdapter(ProtocolAdapter):

    def get_client(self, model: Any) -> Any:
        return anthropic.Anthropic(
            base_url=model.api_base,
            api_key=model.api_key or "",
            timeout=600.0,
        )

    def build_request(self, openai_kwargs: dict, provider: str = "") -> dict:
        kwargs = dict(openai_kwargs)
        kwargs.pop("stream", None)
        kwargs.pop("stream_options", None)
        kwargs.pop("extra_body", None)

        messages = kwargs.pop("messages", [])
        tools = kwargs.pop("tools", None)
        tool_choice = kwargs.pop("tool_choice", None)

        # Extract system message
        system_text: str | None = None
        non_system = []
        for m in messages:
            if m.get("role") == "system":
                content = m.get("content", "")
                if isinstance(content, str):
                    system_text = content
                elif isinstance(content, list):
                    system_text = " ".join(
                        block.get("text", "") for block in content if block.get("type") == "text"
                    )
            else:
                non_system.append(m)

        result: dict = {
            "model": kwargs.get("model", ""),
            "messages": self._convert_messages(non_system),
            "max_tokens": kwargs.get("max_tokens", 16384),
        }

        if system_text is not None:
            if provider == "anthropic":
                result["system"] = [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]
            else:
                result["system"] = system_text

        if tools:
            result["tools"] = self._to_anthropic_tools(tools)

        if tool_choice is not None:
            result["tool_choice"] = self._to_anthropic_tool_choice(tool_choice)

        return result

    def create_raw(self, client: Any, wire_request: dict) -> Any:
        return client.messages.create(**wire_request)

    def create_raw_stream(self, client: Any, wire_request: dict) -> Any:
        return client.messages.create(**wire_request, stream=True)

    def parse_response(self, raw: Any, log_fn: Callable[[str], None] | None = None) -> ParseResult:
        text_parts = []
        tool_calls = []

        for block in raw.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.text)
            elif btype == "tool_use":
                tool_calls.append({
                    "id": block.id,
                    "type": "function",
                    "function": {"name": block.name, "arguments": json.dumps(block.input)},
                })
            elif btype == "thinking":
                if log_fn:
                    log_fn(f"[THINKING] {block.thinking}")

        stop_reason = getattr(raw, "stop_reason", None)
        finish_reason_map = {
            "end_turn": "stop",
            "tool_use": "tool_calls",
            "max_tokens": "length",
        }
        finish_reason = finish_reason_map.get(stop_reason, stop_reason)

        usage_obj = getattr(raw, "usage", None)
        usage: dict = {}
        if usage_obj:
            usage = {
                "prompt_tokens": getattr(usage_obj, "input_tokens", 0) or 0,
                "completion_tokens": getattr(usage_obj, "output_tokens", 0) or 0,
                "cache_creation_input_tokens": getattr(usage_obj, "cache_creation_input_tokens", 0) or 0,
                "cache_read_input_tokens": getattr(usage_obj, "cache_read_input_tokens", 0) or 0,
            }

        return "".join(text_parts), tool_calls, finish_reason, usage

    def iter_stream(
        self,
        stream: Any,
        emit_token: Callable[[str], None],
        log_fn: Callable[[str], None],
    ) -> ParseResult:
        text_parts: list[str] = []
        tool_calls_partial: dict[int, dict] = {}
        finish_reason: str | None = None
        usage: dict = {}

        current_block_type: str | None = None
        current_block_index: int | None = None
        thinking_buf = ""

        for event in stream:
            etype = getattr(event, "type", None)

            if etype == "message_start":
                msg_usage = getattr(event.message, "usage", None)
                if msg_usage:
                    usage["prompt_tokens"] = getattr(msg_usage, "input_tokens", 0) or 0
                    usage["cache_creation_input_tokens"] = getattr(msg_usage, "cache_creation_input_tokens", 0) or 0
                    usage["cache_read_input_tokens"] = getattr(msg_usage, "cache_read_input_tokens", 0) or 0

            elif etype == "content_block_start":
                current_block_type = getattr(event.content_block, "type", None)
                current_block_index = getattr(event, "index", None)
                if current_block_type == "tool_use":
                    tool_calls_partial[current_block_index] = {
                        "id": getattr(event.content_block, "id", ""),
                        "name": getattr(event.content_block, "name", ""),
                        "input_buf": "",
                        "input": None,
                    }

            elif etype == "content_block_delta":
                delta = getattr(event, "delta", None)
                if delta is None:
                    continue
                dtype = getattr(delta, "type", None)
                if dtype == "text_delta":
                    text_parts.append(delta.text)
                    emit_token(delta.text)
                elif dtype == "input_json_delta":
                    if current_block_index in tool_calls_partial:
                        tool_calls_partial[current_block_index]["input_buf"] += delta.partial_json
                elif dtype == "thinking_delta":
                    thinking_buf += delta.thinking

            elif etype == "content_block_stop":
                if current_block_type == "thinking" and thinking_buf:
                    log_fn(f"[THINKING] {thinking_buf.strip()}")
                    thinking_buf = ""
                elif current_block_type == "tool_use" and current_block_index in tool_calls_partial:
                    tc = tool_calls_partial[current_block_index]
                    try:
                        tc["input"] = json.loads(tc["input_buf"]) if tc["input_buf"] else {}
                    except (ValueError, json.JSONDecodeError):
                        tc["input"] = {}

            elif etype == "message_delta":
                delta = getattr(event, "delta", None)
                if delta:
                    stop_reason = getattr(delta, "stop_reason", None)
                    if stop_reason:
                        finish_reason_map = {
                            "end_turn": "stop",
                            "tool_use": "tool_calls",
                            "max_tokens": "length",
                        }
                        finish_reason = finish_reason_map.get(stop_reason, stop_reason)
                event_usage = getattr(event, "usage", None)
                if event_usage:
                    usage["completion_tokens"] = getattr(event_usage, "output_tokens", 0) or 0

            elif etype == "message_stop":
                break

        tool_calls_list = []
        for idx in sorted(tool_calls_partial.keys()):
            tc = tool_calls_partial[idx]
            if tc.get("input") is not None:
                tool_calls_list.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {"name": tc["name"], "arguments": json.dumps(tc["input"])},
                })

        return "".join(text_parts), tool_calls_list, finish_reason, usage

    def is_retryable(self, exc: Exception) -> bool:
        if isinstance(exc, anthropic.AuthenticationError):
            return False
        if isinstance(exc, (anthropic.APIConnectionError, anthropic.RateLimitError)):
            return True
        if isinstance(exc, anthropic.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
        return False

    def is_availability_error(self, exc: Exception) -> bool:
        if isinstance(exc, anthropic.RateLimitError):
            return True
        if isinstance(exc, anthropic.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
        return False

    def is_context_length_error(self, exc: Exception) -> bool:
        if isinstance(exc, anthropic.APIStatusError) and exc.status_code == 413:
            return True
        msg = str(exc).lower()
        if "context length" in msg or "tokens exceed" in msg:
            return True
        return False

    def is_context_truncation(self, exc: Exception) -> bool:
        return False

    def get_retry_after(self, exc: Exception) -> float | None:
        if isinstance(exc, (anthropic.RateLimitError, anthropic.APIStatusError)):
            try:
                header = exc.response.headers.get("retry-after")
                if header:
                    return min(float(header), 30.0)
            except (AttributeError, ValueError, TypeError):
                pass
        return None

    def compact_call(self, client: Any, content: str, model_name: str) -> str:
        resp = client.messages.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            max_tokens=1024,
        )
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return block.text
        return ""

    @staticmethod
    def _to_anthropic_tools(tools: list[dict]) -> list[dict]:
        """Convert OpenAI tool defs to Anthropic format."""
        result = []
        for t in tools:
            if t.get("type") == "function":
                fn = t["function"]
                result.append({
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
                })
        return result

    @staticmethod
    def _to_anthropic_tool_choice(tool_choice: Any) -> dict:
        if tool_choice == "required":
            return {"type": "any"}
        if tool_choice == "auto":
            return {"type": "auto"}
        if isinstance(tool_choice, dict) and tool_choice.get("type") == "function":
            return {"type": "tool", "name": tool_choice["function"]["name"]}
        return {"type": "auto"}

    @staticmethod
    def _convert_messages(openai_messages: list[dict]) -> list[dict]:
        """Convert OpenAI-format messages to Anthropic format.

        Rules:
        - Skip role=system (extracted separately by caller)
        - role=user with str content: pass through
        - role=user with list content: pass through
        - role=assistant with tool_calls: convert to content list with tool_use blocks
        - role=tool: batch consecutive ones into single role=user message with tool_result blocks
        """
        result = []
        i = 0
        while i < len(openai_messages):
            m = openai_messages[i]
            role = m.get("role")

            if role == "system":
                i += 1
                continue

            if role == "tool":
                tool_results = []
                while i < len(openai_messages) and openai_messages[i].get("role") == "tool":
                    tr = openai_messages[i]
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tr.get("tool_call_id", ""),
                        "content": tr.get("content", ""),
                    })
                    i += 1
                result.append({"role": "user", "content": tool_results})
                continue

            if role == "assistant" and m.get("tool_calls"):
                content = []
                if m.get("content"):
                    content.append({"type": "text", "text": m["content"]})
                for tc in m["tool_calls"]:
                    fn = tc.get("function", {})
                    try:
                        input_data = json.loads(fn.get("arguments", "{}"))
                    except (ValueError, json.JSONDecodeError):
                        input_data = {}
                    content.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": fn.get("name", ""),
                        "input": input_data,
                    })
                result.append({"role": "assistant", "content": content})
                i += 1
                continue

            result.append(m)
            i += 1

        return result


def get_adapter(protocol: str) -> ProtocolAdapter:
    if protocol == "anthropic":
        return AnthropicAdapter()
    return OpenAIAdapter()
