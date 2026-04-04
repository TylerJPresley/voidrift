"""Agent loop — sends messages to model APIs, handles agent tool calls, streams responses (AC-CLI3)."""

from __future__ import annotations

import itertools
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

import httpx
import openai

from openai import OpenAI
from pydantic import BaseModel, Field

from .models import ModelConfig


class Message(BaseModel):
    role: str
    content: str
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class AgentLoop(BaseModel):
    """Core agent loop that sends messages to model APIs and handles tool calls (AC-CLI3).

    Supports OpenAI-compatible APIs (local, kiro) and native cloud APIs (Anthropic, Gemini).
    """

    model: ModelConfig
    system_prompt: str = ""
    tools: list[dict] = Field(default_factory=list)
    tool_handlers: dict[str, Callable] = Field(default_factory=dict)
    messages: list[dict] = Field(default_factory=list)
    stream: bool = True
    max_tokens: int = 16384
    tool_choice: str = "required"
    extra_body: dict | None = None
    on_token: Callable[[str], None] | None = None
    on_complete: Callable[[dict], None] | None = None
    on_tool_call: Callable[[str], None] | None = None
    on_tool_result: Callable[[str, str], None] | None = None
    on_progress: Callable[[dict], None] | None = None
    log_path: Path | None = None
    show_spinner: bool = True  # set False when caller owns the spinner display

    model_config = {"arbitrary_types_allowed": True}

    def model_post_init(self, __context: Any) -> None:
        """Insert system prompt as first message if provided."""
        if self.system_prompt:
            self.messages.insert(0, {"role": "system", "content": self.system_prompt})

    def _get_client(self) -> OpenAI:
        """Create an OpenAI-compatible client configured for the model's API.

        Returns:
            Configured OpenAI client instance.
        """
        from .config import get_api_key

        kwargs: dict[str, Any] = {}
        if self.model.api_base:
            kwargs["base_url"] = self.model.api_base
        if self.model.api_key:
            kwargs["api_key"] = self.model.api_key
        elif self.model.provider == "anthropic":
            kwargs["api_key"] = get_api_key("anthropic") or ""
            kwargs["base_url"] = "https://api.anthropic.com/v1/"
        elif self.model.provider == "gemini":
            kwargs["api_key"] = get_api_key("gemini") or ""
            kwargs["base_url"] = "https://generativelanguage.googleapis.com/v1beta/openai/"
        else:
            kwargs["api_key"] = "no-key"
        return OpenAI(
            timeout=httpx.Timeout(connect=30.0, read=600.0, write=60.0, pool=30.0),
            **kwargs,
        )

    def _model_name(self) -> str:
        """Get the model name to pass to the API, stripping provider prefixes.

        Returns:
            Clean model identifier string.
        """
        mid = self.model.model_id
        # Strip provider prefixes for the actual API call
        for prefix in ("openai/", "anthropic/", "gemini/"):
            if mid.startswith(prefix):
                mid = mid[len(prefix):]
                break
        return mid

    def send(self, user_message: str) -> str:
        """Send a user message and get the full response, handling tool calls.

        Args:
            user_message: The user's input text.

        Returns:
            Final assistant response text.

        Raises:
            RuntimeError: If the API call fails (wraps OpenAI/network errors).
        """
        self.messages.append({"role": "user", "content": user_message})
        try:
            return self._run_loop()
        except RuntimeError:
            raise
        except Exception as e:
            msg = str(e)
            if "Connection" in msg:
                base = self.model.api_base or "unknown"
                msg = f"Cannot connect to {base} — is the model/gateway running?"
            elif "context length" in msg.lower() or "maximum context" in msg.lower() or ("token" in msg.lower() and "exceed" in msg.lower()):
                msg = f"Context length exceeded. The input is too large for {self.model.alias}. Use a model with a larger context window."
            elif "json_invalid" in msg or ("EOF while parsing" in msg and "list" in msg):
                msg = f"Tool results exceeded context window for {self.model.alias}. The agent accumulated too much content in tool call results. Try a model with a larger context window or reduce the input size."
            raise RuntimeError(msg) from e

    # done tool definition — auto-injected when tools are present (REQ-ARCH-4)
    _DONE_TOOL: dict = {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Call this when you have finished all tool calls and are ready to give your final response.",
            "parameters": {"type": "object", "properties": {}},
        },
    }

    _THINK_RE = re.compile(r"<think>(.*?)</think>\s*", re.DOTALL)
    _THINK_ORPHAN_RE = re.compile(r"^(.*?)</think>\s*", re.DOTALL)

    def _strip_think(self, text: str) -> str:
        """Remove <think>...</think> blocks from model output, logging content (REQ-ARCH-8)."""
        for m in self._THINK_RE.finditer(text):
            content = m.group(1).strip()
            if content:
                self._log(f"[THINKING] {content}")
        text = self._THINK_RE.sub("", text)
        # Handle orphaned </think> (closing tag without opening)
        m = self._THINK_ORPHAN_RE.match(text)
        if m:
            content = m.group(1).strip()
            if content:
                self._log(f"[THINKING] {content}")
            text = text[m.end():]
        return text.strip()

    def _emit_token(self, text: str) -> None:
        """Emit a token to the callback or stdout."""
        if self.on_token:
            self.on_token(text)
        else:
            sys.stdout.write(text)
            sys.stdout.flush()

    def _log(self, entry: str) -> None:
        """Append a line to the log file if log_path is set."""
        if self.log_path:
            with open(self.log_path, "a") as f:
                f.write(entry + "\n")

    def _run_loop(self) -> str:
        """Run the agent loop until a final text response (REQ-ARCH-4).

        When tools are present: tool_choice=required on every call, done() triggers
        a final call with no tools. When no tools: single call, text response.
        Stall detection: if the model makes the same tool call (name+args) on
        consecutive iterations, force a final text call.

        Returns:
            Final assistant response text.
        """
        client = self._get_client()
        model_name = self._model_name()
        last_call_sig: str | None = None
        stall_nudges = 0
        max_tokens_continuations = 0
        accumulated_text = ""

        # Log system prompt and latest user message
        if self.log_path:
            for m in self.messages:
                if m["role"] == "system":
                    self._log(f"[SYSTEM] {m['content'][:2000]}")
            self._log(f"[USER] {self.messages[-1]['content'][:2000]}")

        while True:
            kwargs: dict[str, Any] = {
                "model": model_name,
                "messages": self.messages,
                "max_tokens": self.max_tokens,
            }
            if self.tools:
                if self.tool_choice == "auto":
                    kwargs["tools"] = self.tools
                    kwargs["tool_choice"] = "auto"
                else:
                    kwargs["tools"] = self.tools + [self._DONE_TOOL]
                    kwargs["tool_choice"] = "required"
            if self.extra_body:
                kwargs["extra_body"] = self.extra_body

            try:
                if self.stream:
                    text, tool_calls, finish_reason = self._stream_response(client, kwargs)
                else:
                    text, tool_calls, finish_reason = self._sync_response(client, kwargs)
            except Exception as exc:
                if self._is_context_truncation(exc) and self._trim_messages():
                    self._log("[CONTEXT_TRIM] Tools JSON truncated — trimmed messages, retrying")
                    continue
                raise

            # Max-tokens recovery (REQ-ARCH-11)
            truncated = finish_reason == "length"
            if truncated and tool_calls:
                self._log("[MAX_TOKENS_TOOL_TRUNCATION] Response truncated with tool calls present")

            if not tool_calls:
                # Handle text truncation via continuation (REQ-ARCH-11)
                if truncated and max_tokens_continuations < 2:
                    max_tokens_continuations += 1
                    accumulated_text += text
                    self._log(f"[MAX_TOKENS_RECOVERY] attempt {max_tokens_continuations}/2")
                    self.messages.append({"role": "assistant", "content": text})
                    from . import prompts as _prompts
                    resume = _prompts.load_prompt("system", "MAX-TOKENS-RESUME")
                    self.messages.append({"role": "user", "content": resume})
                    continue
                text = self._strip_think(accumulated_text + text)
                self.messages.append({"role": "assistant", "content": text})
                if truncated:
                    self._log("[MAX_TOKENS_EXHAUSTED] 2 continuations exhausted, returning partial")
                self._log(f"[ASSISTANT] {text}")
                return text

            # Stall detection — same call signature as last iteration.
            # For write tools, signature is path-only (not content) so that
            # rewriting a file with different content is still detected as a stall.
            def _tc_sig(tc: dict) -> str:
                name = tc["function"]["name"]
                if name in ("write_framework_file", "write_source_file"):
                    import json as _json
                    try:
                        args = _json.loads(tc["function"].get("arguments", "{}"))
                        return f"{name}:{args.get('path', '')}"
                    except (ValueError, KeyError):
                        return name
                return f"{name}:{tc['function'].get('arguments', '')}"

            call_sig = "|".join(_tc_sig(tc) for tc in tool_calls)
            if call_sig == last_call_sig:
                stall_nudges += 1
                self._log(f"[STALL] Repeated call ({stall_nudges}): {call_sig}")
                if stall_nudges >= 2:
                    break  # give up after 2 nudges
                # Inject a nudge instead of stripping tools — the model
                # is looping on reads and needs to move to writes.
                from . import prompts as _prompts
                self.messages.append({
                    "role": "user",
                    "content": _prompts.load_prompt("system", "STALL-NUDGE"),
                })
                last_call_sig = None  # reset so next iteration isn't auto-stall
                continue
            last_call_sig = call_sig

            done = any(tc["function"]["name"] == "done" for tc in tool_calls)

            self.messages.append({
                "role": "assistant",
                "content": text or None,
                "tool_calls": tool_calls,
            })

            for tc in tool_calls:
                name = tc["function"]["name"]
                self._log(f"[TOOL_CALL] {name}({tc['function'].get('arguments', '')})")
                if name == "done":
                    result = "OK"
                else:
                    result = self._handle_tool_call_dict(tc)
                    if self.on_tool_result:
                        self.on_tool_result(name, result)
                self._log(f"[TOOL_RESULT] {name} -> {result[:2000]}")
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            if done:
                self.tools = []
                continue

        # Stalled — force final call with only write tools
        self._log("[STALL] Forcing final text call")
        self.tools = [t for t in self.tools if t["function"]["name"] in ("write_source_file", "write_framework_file", "done")]
        if not self.tools:
            self.tools = []
        kwargs = {
            "model": model_name,
            "messages": self.messages,
            "max_tokens": self.max_tokens,
        }
        if self.tools:
            kwargs["tools"] = self.tools + [self._DONE_TOOL]
            kwargs["tool_choice"] = "required"
        if self.extra_body:
            kwargs["extra_body"] = self.extra_body
        if self.stream:
            text, tool_calls, _fr = self._stream_response(client, kwargs)
        else:
            text, tool_calls, _fr = self._sync_response(client, kwargs)

        # Process any write_file/done calls from the final attempt
        if tool_calls:
            self.messages.append({
                "role": "assistant",
                "content": text or None,
                "tool_calls": tool_calls,
            })
            for tc in tool_calls:
                name = tc["function"]["name"]
                self._log(f"[TOOL_CALL] {name}({tc['function'].get('arguments', '')})")
                if name == "done":
                    result = "OK"
                else:
                    result = self._handle_tool_call_dict(tc)
                    if self.on_tool_result:
                        self.on_tool_result(name, result)
                self._log(f"[TOOL_RESULT] {name} -> {result[:2000]}")
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })
            text = ""

        text = self._strip_think(text)
        self._log(f"[ASSISTANT] {text}")
        return text

    _RETRY_MAX = 3
    _RETRY_BASE = 1.0
    _RETRY_MULT = 2.0
    _RETRY_CAP = 30.0

    def _is_retryable(self, exc: Exception) -> bool:
        """Return True if the exception warrants a retry (REQ-ARCH-10)."""
        msg = str(exc).lower()
        # Never retry context length or auth errors
        if "context length" in msg or "maximum context" in msg:
            return False
        if ("token" in msg and "exceed" in msg):
            return False
        if isinstance(exc, openai.AuthenticationError):
            return False
        # Retry on connection errors and rate limits
        if isinstance(exc, (openai.APIConnectionError, openai.RateLimitError)):
            return True
        # Retry on 5xx and 429
        if isinstance(exc, openai.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
        # Retry on generic connection failures
        if "connection" in msg or "timeout" in msg:
            return True
        return False

    def _is_context_truncation(self, exc: Exception) -> bool:
        """Return True if the error is a 400 caused by the request body being truncated.

        Local model servers (llama.cpp, vllm, etc.) truncate the request when the
        context is full, producing malformed JSON for the tools parameter.
        """
        msg = str(exc)
        return (
            "json_invalid" in msg
            or ("EOF while parsing" in msg and ("list" in msg or "object" in msg))
            or ("validation error" in msg and "EOF" in msg)
        )

    def _trim_messages(self) -> bool:
        """Drop the oldest tool call / tool result block to reduce context size.

        Keeps the system prompt, the first user message, and the most recent
        messages intact.  Returns True if anything was removed.
        """
        system_msgs = [m for m in self.messages if m.get("role") == "system"]
        other_msgs = [m for m in self.messages if m.get("role") != "system"]

        # Need at least: first user + assistant-with-tools + tool-result + something after
        if len(other_msgs) < 4:
            return False

        # Find and remove the first assistant message that carries tool_calls,
        # plus all immediately following tool-result messages.
        for i, msg in enumerate(other_msgs):
            if msg.get("role") == "assistant" and msg.get("tool_calls"):
                # Only trim if there's content after this block (keep the last exchange)
                j = i + 1
                while j < len(other_msgs) and other_msgs[j].get("role") == "tool":
                    j += 1
                if j < len(other_msgs):  # at least one message remains after block
                    removed = j - i
                    other_msgs = other_msgs[:i] + other_msgs[j:]
                    self.messages = system_msgs + other_msgs
                    self._log(f"[TRIM] Removed {removed} messages (tool call+results) to reduce context")
                    return True

        return False

    def _sync_response(self, client: OpenAI, kwargs: dict) -> tuple[str, list[dict], str | None]:
        """Non-streaming response with exponential backoff retry (REQ-ARCH-10).

        Returns:
            Tuple of (text, tool_calls_list, finish_reason).
        """
        _call_start = time.time()

        # Background timer fires on_progress every 250ms while the API call blocks
        _tick_stop = threading.Event()
        _tick_thread: threading.Thread | None = None
        if self.on_progress:
            def _tick() -> None:
                while not _tick_stop.wait(0.25):
                    self.on_progress({"elapsed": time.time() - _call_start, "state": "thinking"})  # type: ignore[misc]
            _tick_thread = threading.Thread(target=_tick, daemon=True)
            _tick_thread.start()

        last_exc: Exception | None = None
        response = None
        delay = self._RETRY_BASE
        try:
            for attempt in range(1, self._RETRY_MAX + 1):
                try:
                    response = client.chat.completions.create(**kwargs)
                    break
                except Exception as exc:
                    last_exc = exc
                    if not self._is_retryable(exc) or attempt == self._RETRY_MAX:
                        raise
                    self._log(f"[RETRY] attempt {attempt}/{self._RETRY_MAX} after {delay:.0f}s: {exc}")
                    time.sleep(delay)
                    delay = min(delay * self._RETRY_MULT, self._RETRY_CAP)
        finally:
            _tick_stop.set()
            if _tick_thread:
                _tick_thread.join(timeout=0.5)

        if response is None:
            raise last_exc  # type: ignore[misc]
        choice = response.choices[0]
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

        # Emit token telemetry from usage data
        if response.usage:
            prompt_tokens = response.usage.prompt_tokens or 0
            completion_tokens = response.usage.completion_tokens or 0
            total_tokens = response.usage.total_tokens or 0
            ctx_pct: int | None = None
            if self.model.max_context and prompt_tokens:
                ctx_pct = min(100, round(prompt_tokens * 100 / self.model.max_context))
            elapsed = time.time() - _call_start
            if self.on_progress:
                self.on_progress({
                    "elapsed": elapsed,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "ctx_pct": ctx_pct,
                    "state": "done",
                })
            if self.on_complete and not tool_calls:
                self.on_complete({
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "elapsed": round(elapsed, 1),
                    "tokens_per_sec": round(completion_tokens / elapsed if elapsed > 0 else 0, 1),
                    "ctx_pct": ctx_pct,
                })

        return text, tool_calls, finish_reason

    def _stream_response(self, client: OpenAI, kwargs: dict) -> tuple[str, list[dict], str | None]:
        """Stream a response, printing tokens as they arrive.

        Args:
            client: OpenAI client instance.
            kwargs: Arguments for the chat completions API call.

        Returns:
            Tuple of (collected_text, tool_calls_list).
        """
        kwargs["stream"] = True
        kwargs["stream_options"] = {"include_usage": True}
        collected_text = ""
        collected_tool_calls: dict[int, dict] = {}
        token_count = 0
        usage_data: dict = {}
        finish_reason: str | None = None
        stream_start = time.time()

        # Background on_progress timer — fires every 250ms while waiting for first token.
        # Fires even when the caller owns the display (on_token set); stops on first content.
        _prog_stop = threading.Event()
        _prog_thread: threading.Thread | None = None
        if self.on_progress:
            def _prog() -> None:
                while not _prog_stop.wait(0.25):
                    self.on_progress({"elapsed": time.time() - stream_start, "state": "thinking"})  # type: ignore[misc]
            _prog_thread = threading.Thread(target=_prog, daemon=True)
            _prog_thread.start()

        # Spinner until first token arrives — only when caller has no on_token
        # callback. When on_token is set, the caller owns the display (e.g. a
        # Rich Live context) and manages its own "Thinking..." indicator.
        stop_spinner = threading.Event()
        spinner: threading.Thread | None = None
        if not self.on_token and self.show_spinner:
            from .ui import random_label
            _spinner_label = random_label()
            sys.stderr.write("\n")
            sys.stderr.flush()
            def _spin():
                for ch in itertools.cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"):
                    if stop_spinner.wait(0.1):
                        break
                    sys.stderr.write(f"\r\033[2m  {ch} {_spinner_label}\033[0m")
                    sys.stderr.flush()
                sys.stderr.write("\r\033[K")
                sys.stderr.flush()
            spinner = threading.Thread(target=_spin, daemon=True)
            spinner.start()

        in_think = False
        think_buf = ""
        pending = ""

        # Retry wrapper for the stream creation (REQ-ARCH-10)
        _s_delay = self._RETRY_BASE
        _s_last_exc: Exception | None = None
        _stream_obj = None
        for _s_attempt in range(1, self._RETRY_MAX + 1):
            try:
                _stream_obj = client.chat.completions.create(**kwargs)
                break
            except Exception as _s_exc:
                _s_last_exc = _s_exc
                if not self._is_retryable(_s_exc) or _s_attempt == self._RETRY_MAX:
                    raise
                self._log(f"[RETRY] attempt {_s_attempt}/{self._RETRY_MAX} after {_s_delay:.0f}s: {_s_exc}")
                time.sleep(_s_delay)
                _s_delay = min(_s_delay * self._RETRY_MULT, self._RETRY_CAP)
        if _stream_obj is None:
            raise _s_last_exc  # type: ignore[misc]

        try:
            stream = _stream_obj
            # Stateful filter for <think> tags in streaming.
            # Only enter think mode when an explicit <think> tag is seen.
            # Starting in think mode caused short responses from non-thinking
            # models (e.g. Claude via Kiro) to be silently discarded when they
            # fell under the flush threshold.
            in_think = False
            think_buf = ""

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

                # Accumulate text
                if delta.content:
                    if not stop_spinner.is_set():
                        stop_spinner.set()
                        if spinner:
                            spinner.join()
                    if not _prog_stop.is_set():
                        _prog_stop.set()
                    collected_text += delta.content
                    token_count += 1

                    # Filter think tags from streamed output
                    pending += delta.content
                    while pending:
                        if in_think:
                            end_idx = pending.find("</think>")
                            if end_idx != -1:
                                think_buf += pending[:end_idx]
                                if think_buf.strip():
                                    self._log(f"[THINKING] {think_buf.strip()}")
                                think_buf = ""
                                in_think = False
                                pending = pending[end_idx + 8:].lstrip()
                            else:
                                think_buf += pending
                                pending = ""
                        else:
                            start_idx = pending.find("<think>")
                            if start_idx != -1:
                                # Emit text before the tag, then enter think mode
                                before = pending[:start_idx]
                                if before:
                                    self._emit_token(before)
                                in_think = True
                                pending = pending[start_idx + 7:]
                            elif "<" in pending and not pending.endswith(">"):
                                # Might be a partial <think> tag — hold it
                                last_lt = pending.rfind("<")
                                partial = pending[last_lt:]
                                if "<think>"[:len(partial)] == partial:
                                    before = pending[:last_lt]
                                    if before:
                                        self._emit_token(before)
                                    pending = partial
                                    break
                                else:
                                    self._emit_token(pending)
                                    pending = ""
                            else:
                                self._emit_token(pending)
                                pending = ""

                # Accumulate tool calls
                if delta.tool_calls:
                    if not stop_spinner.is_set():
                        stop_spinner.set()
                        if spinner:
                            spinner.join()
                    if not _prog_stop.is_set():
                        _prog_stop.set()
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
                                if self.on_tool_call:
                                    self.on_tool_call(tc_delta.function.name)
                            if tc_delta.function.arguments:
                                tc["function"]["arguments"] += tc_delta.function.arguments
        finally:
            # Flush any remaining pending text (e.g. partial tag that never completed)
            if pending and not in_think:
                self._emit_token(pending)
            if in_think and think_buf.strip():
                self._log(f"[THINKING] {think_buf.strip()}")
            if not stop_spinner.is_set():
                stop_spinner.set()
            if spinner:
                spinner.join()
            if not _prog_stop.is_set():
                _prog_stop.set()
            if _prog_thread:
                _prog_thread.join(timeout=0.5)

        tool_calls_list = [collected_tool_calls[i] for i in sorted(collected_tool_calls)]

        # Emit stats on final text response (no tool calls)
        if not tool_calls_list:
            if collected_text and not self.on_token:
                sys.stdout.write("\n")
                sys.stdout.flush()
            elapsed = time.time() - stream_start
            prompt_tokens = usage_data.get("prompt_tokens", 0)
            completion_tokens = usage_data.get("completion_tokens", token_count)
            ctx_pct: int | None = None
            if self.model.max_context and prompt_tokens:
                ctx_pct = min(100, round(prompt_tokens * 100 / self.model.max_context))
            if self.on_progress:
                self.on_progress({
                    "elapsed": elapsed,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "ctx_pct": ctx_pct,
                    "state": "done",
                })
            if self.on_complete:
                tps = completion_tokens / elapsed if elapsed > 0 else 0
                self.on_complete({
                    **usage_data,
                    "elapsed": round(elapsed, 1),
                    "tokens_per_sec": round(tps, 1),
                    "ctx_pct": ctx_pct,
                })

        return collected_text, tool_calls_list, finish_reason

    def _execute_tool(self, name: str, arguments: str) -> str:
        """Parse arguments and execute a tool handler by name.

        Args:
            name: Tool function name.
            arguments: JSON-encoded arguments string.

        Returns:
            Tool result as a string, or an error message.
        """
        try:
            args = json.loads(arguments)
        except json.JSONDecodeError:
            return f"Error: Invalid JSON arguments for tool {name}"

        handler = self.tool_handlers.get(name)
        if not handler:
            return f"Error: Unknown tool '{name}'"

        try:
            return str(handler(**args))
        except Exception as e:  # Broad: tool handlers may raise any exception
            return f"Error calling {name}: {e}"

    def _handle_tool_call_dict(self, tc: dict) -> str:
        """Execute a tool call from a dict representation.

        Args:
            tc: Dict with ``function.name`` and ``function.arguments`` keys.

        Returns:
            Tool result string.
        """
        return self._execute_tool(tc["function"]["name"], tc["function"]["arguments"])


def build_local_tools(cmd: str = "") -> tuple[list[dict], dict[str, Callable]]:
    """Build OpenAI-format agent tool definitions from CLI-native filesystem tools.

    Args:
        cmd: Command name to filter agent tools. Empty string returns all agent tools.

    Returns:
        Tuple of (agent_tool_definitions, agent_tool_handlers) for use with AgentLoop.
    """
    _COMMAND_TOOLS: dict[str, set[str]] = {
        "gather": {"read_source_file", "write_framework_file", "read_framework_file"},
        "plan": {"read_framework_file", "write_framework_file"},
        "develop": {"read_source_file", "write_source_file", "read_framework_file"},
        "chat": {
            "read_source_file", "write_source_file",
            "read_framework_file", "write_framework_file",
            "list_project_artifacts", "web_fetch",
            "get_skill", "list_skills",
        },
        "verify-plan": {"read_source_file", "read_framework_file", "write_framework_file"},
        "verify-execute": {
            "read_framework_file", "write_framework_file",
            "read_process_output", "http_request", "run_command",
            "browser_navigate", "browser_screenshot", "browser_click", "browser_get_text",
        },
    }
    allowed = _COMMAND_TOOLS.get(cmd) if cmd else None

    from .tools import LOCAL_TOOLS, LOCAL_HANDLERS
    from .skills import find_skill as _find_skill, list_skills as _list_skills
    from .config import _voidrift_home as _vh

    import re as _re

    def _get_skill_handler(name: str, topic: str = "") -> str:
        content = _find_skill(name)
        if content is None:
            return f"Skill '{name}' not found."
        if not topic:
            return content
        parts = _re.split(r"^## (.+)$", content, flags=_re.MULTILINE)
        for i in range(1, len(parts), 2):
            if parts[i].strip().lower() == topic.strip().lower():
                return parts[i + 1].strip() if i + 1 < len(parts) else ""
        return f"Section '{topic}' not found in skill '{name}'."

    def _list_skills_handler() -> str:
        return _list_skills()

    skill_tools = [
        {
            "type": "function",
            "function": {
                "name": "get_skill",
                "description": "Retrieve a skill document by name, optionally scoped to an H2 section.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Skill name as returned by list_skills()"},
                        "topic": {"type": "string", "description": "Optional H2 heading within the skill to retrieve a specific section"},
                    },
                    "required": ["name"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_skills",
                "description": "List all available skill documents grouped by layer (project, domain, north star).",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]
    skill_handlers: dict[str, Callable] = {
        "get_skill": _get_skill_handler,
        "list_skills": _list_skills_handler,
    }

    # Verify execution tools (process lifecycle, HTTP, browser)
    from .tools import process_manager as _pm, http_client as _http, browser as _browser

    verify_tools = [
        {
            "type": "function",
            "function": {
                "name": "read_process_output",
                "description": "Read buffered stdout/stderr from a running process (up to 500 lines).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "handle_id": {"type": "string", "description": "Handle ID returned by start_process"},
                    },
                    "required": ["handle_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "http_request",
                "description": (
                    "Make an HTTP request with session-scoped cookie and auth header persistence. "
                    "Cookies and Authorization headers are preserved across calls in the same session."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "method": {"type": "string", "description": "HTTP method (GET, POST, PUT, PATCH, DELETE)"},
                        "url": {"type": "string", "description": "Full URL including scheme"},
                        "headers": {"type": "string", "description": "JSON object of request headers (default {})"},
                        "body": {"type": "string", "description": "Request body (default empty)"},
                        "session_id": {"type": "string", "description": "Named session for persistence (default 'default')"},
                    },
                    "required": ["method", "url"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Run a shell command synchronously and return its stdout, stderr, and exit code.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "cmd": {"type": "string", "description": "Shell command to run"},
                        "cwd": {"type": "string", "description": "Working directory (default current)"},
                    },
                    "required": ["cmd"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "browser_navigate",
                "description": "Navigate the browser to a URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "URL to navigate to"},
                        "session_id": {"type": "string", "description": "Browser session ID (default 'default')"},
                    },
                    "required": ["url"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "browser_screenshot",
                "description": "Take a full-page screenshot. Returns base64 PNG or saves to .voidrift/ path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "session_id": {"type": "string", "description": "Browser session ID"},
                        "save_path": {"type": "string", "description": "Optional path relative to .voidrift/ to save PNG"},
                    },
                    "required": [],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "browser_click",
                "description": "Click an element on the current page using a CSS or text selector.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "CSS or text selector (e.g. 'button.submit' or 'text=Login')"},
                        "session_id": {"type": "string", "description": "Browser session ID"},
                    },
                    "required": ["selector"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "browser_get_text",
                "description": "Get visible text content of an element (default: full page body).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string", "description": "CSS selector (default 'body')"},
                        "session_id": {"type": "string", "description": "Browser session ID"},
                    },
                    "required": [],
                },
            },
        },
    ]
    verify_handlers: dict[str, Callable] = {
        "read_process_output": _pm.read_process_output,
        "http_request": _http.http_request,
        "run_command": _pm.run_command,
        "browser_navigate": _browser.browser_navigate,
        "browser_screenshot": _browser.browser_screenshot,
        "browser_click": _browser.browser_click,
        "browser_get_text": _browser.browser_get_text,
    }

    tools: list[dict] = []
    handlers: dict[str, Callable] = {}

    # Include CLI-native filesystem agent tools, filtered by command
    for tool_def in LOCAL_TOOLS:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = LOCAL_HANDLERS[name]
            continue
        tools.append(tool_def)
        handlers[name] = LOCAL_HANDLERS[name]

    # Include skill agent tools (chat command only)
    for tool_def in skill_tools:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = skill_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = skill_handlers[name]

    # Include verify execution tools (verify-execute only; never registered for other commands)
    for tool_def in verify_tools:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = verify_handlers[name]
            continue
        tools.append(tool_def)
        handlers[name] = verify_handlers[name]

    return tools, handlers
