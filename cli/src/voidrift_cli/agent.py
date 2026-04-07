"""Agent loop — sends messages to model APIs, handles agent tool calls, streams responses (AC-CLI3)."""

from __future__ import annotations

import itertools
import json
import os
import queue
import random
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

# Module-level abort flag for signal-based loop stop (REQ-ARCH-14, TASK-FW-007)
_abort_requested = False


def request_abort() -> None:
    """Set the abort flag — called from signal handlers."""
    global _abort_requested
    _abort_requested = True


def clear_abort() -> None:
    """Reset the abort flag — called at command start."""
    global _abort_requested
    _abort_requested = False


class Message(BaseModel):
    role: str
    content: str
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class LoopState(BaseModel):
    """Snapshot of agent loop state passed to hook callbacks (REQ-ARCH-14)."""
    messages: list[dict] = Field(default_factory=list)
    turn_count: int = 0
    input_tokens_total: int = 0
    output_tokens_total: int = 0
    tools_called_this_turn: list[str] = Field(default_factory=list)

    model_config = {"arbitrary_types_allowed": True}

_SENSITIVE_PATH_RE = re.compile(
    r"(^|/)(\.env(\.\w+)?|secrets?\.\w+|.*\.pem|.*\.key|.*\.p12|.*\.pfx|"
    r"id_rsa|id_ed25519|credentials\.json|service.account\.json)$",
    re.IGNORECASE,
)


# Context management — moved to agent_context.py; re-exported for back-compat
from .agent_context import (
    snip_old_tool_results,
    _SNIP_READ_TOOLS,
    _SNIP_MIN_CHARS,
    _REACTIVE_COMPACT_MAX,
    trim_messages as _trim_messages_fn,
    reactive_compact as _reactive_compact_fn,
)


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
    token_budget: Any | None = None  # Optional TokenBudget instance (REQ-ARCH-13)
    max_turns: int = 0  # 0 = unlimited; positive = stop after N tool rounds (REQ-ARCH-14)
    stop_check: Callable[["LoopState"], str | None] | None = None  # returns stop reason or None (REQ-ARCH-14)
    transform_context: Callable[[list[dict]], list[dict]] | None = None  # filter messages before API call (REQ-ARCH-14)
    before_tool_call: Callable[[str, str], str | None] | None = None  # (name, args) → result or None (REQ-ARCH-14)
    after_tool_call: Callable[[str, str], str] | None = None  # (name, result) → result (REQ-ARCH-14)
    get_steering_messages: Callable[["LoopState"], list[dict]] | None = None  # inject after tool round (REQ-ARCH-14)
    get_follow_up_messages: Callable[["LoopState"], list[dict]] | None = None  # inject on natural stop (REQ-ARCH-14)
    on_payload: Callable[[dict], dict] | None = None  # inspect/modify raw API kwargs before send (REQ-ARCH-14)
    # Per-instance skill state (REQ-SKL-9) — replaces module-level side-channel
    active_skill_allowed_tools: list[str] | None = None
    active_skill_name: str = ""

    model_config = {"arbitrary_types_allowed": True}

    def model_post_init(self, __context: Any) -> None:
        """Insert system prompt as first message if provided."""
        if self.system_prompt:
            self.messages.insert(0, {"role": "system", "content": self.system_prompt})
        # Thread-safe message queues (TASK-FW-014)
        import queue
        self._steering_queue: queue.SimpleQueue = queue.SimpleQueue()
        self._followup_queue: queue.SimpleQueue = queue.SimpleQueue()
        self._reactive_compact_count: int = 0
        # System prompt hash for cache debugging (TASK-FW-015)
        if self.system_prompt and self.log_path:
            import hashlib
            h = hashlib.sha256(self.system_prompt.encode()).hexdigest()[:16]
            self._log(f"[PROMPT_HASH {h}]")

    def steer(self, messages: list[dict]) -> None:
        """Thread-safe: inject messages after the current tool round (TASK-FW-014)."""
        self._steering_queue.put_nowait(messages)

    def follow_up(self, messages: list[dict], drain: str = "one-at-a-time") -> None:
        """Thread-safe: queue messages for after natural stop (TASK-FW-014)."""
        self._followup_queue.put_nowait((messages, drain))

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

    def _apply_cache_control(self, messages: list[dict]) -> list[dict]:
        """Add Anthropic cache_control markers to system messages (TASK-FW-015).

        Only applies when the model provider is anthropic. Marks the system
        message with cache_control so the static prefix is cached across
        concurrent agents sharing the same system prompt.
        """
        if self.model.provider != "anthropic":
            return messages
        result = []
        for m in messages:
            if m.get("role") == "system" and isinstance(m.get("content"), str):
                result.append({
                    "role": "system",
                    "content": [{"type": "text", "text": m["content"], "cache_control": {"type": "ephemeral"}}],
                })
            else:
                result.append(m)
        return result

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

    def _redact_tool_result(self, name: str, arguments: str, result: str) -> str:
        """Redact tool results for known sensitive file paths."""
        if name not in ("read_source_file", "read_framework_file"):
            return result
        try:
            path = json.loads(arguments).get("path", "")
        except (ValueError, KeyError):
            return result
        if _SENSITIVE_PATH_RE.search(path):
            return f"[REDACTED — sensitive path: {path}]"
        return result

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
        turn_count = 0
        input_tokens_total = 0
        output_tokens_total = 0
        tools_called_this_turn: list[str] = []

        def _state() -> LoopState:
            inp = self.token_budget.input_tokens if self.token_budget else input_tokens_total
            out = self.token_budget.output_tokens if self.token_budget else output_tokens_total
            return LoopState(
                messages=self.messages,
                turn_count=turn_count,
                input_tokens_total=inp,
                output_tokens_total=out,
                tools_called_this_turn=tools_called_this_turn,
            )

        def _iter_log(reason: str) -> None:
            """Log an iteration transition (TASK-FW-016)."""
            s = _state()
            tools_str = json.dumps(s.tools_called_this_turn) if s.tools_called_this_turn else "[]"
            self._log(f"[ITERATION turn={s.turn_count} reason={reason} tools={tools_str}]")

        # Log system prompt and latest user message
        if self.log_path:
            for m in self.messages:
                if m["role"] == "system":
                    self._log(f"[SYSTEM] {m['content'][:8000]}")
            self._log(f"[USER] {self.messages[-1]['content'][:2000]}")

        while True:
            tools_called_this_turn = []

            # Token budget check (REQ-ARCH-13)
            if self.token_budget:
                self.token_budget.check()

            kwargs: dict[str, Any] = {
                "model": model_name,
                "messages": self._apply_cache_control(
                    self.transform_context(list(self.messages)) if self.transform_context else self.messages
                ),
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
            if self.on_payload:
                kwargs = self.on_payload(kwargs)

            try:
                if self.stream:
                    text, tool_calls, finish_reason = self._stream_response(client, kwargs)
                else:
                    text, tool_calls, finish_reason = self._sync_response(client, kwargs)
            except Exception as exc:
                if self._is_context_truncation(exc) and self._trim_messages():
                    self._log("[CONTEXT_TRIM] Tools JSON truncated — trimmed messages, retrying")
                    _iter_log("context_trim")
                    continue
                if self._is_context_length_error(exc) and self._reactive_compact(client):
                    _iter_log("reactive_compact")
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
                    _iter_log("max_tokens_recovery")
                    continue
                text = self._strip_think(accumulated_text + text)
                self.messages.append({"role": "assistant", "content": text})
                if truncated:
                    self._log("[MAX_TOKENS_EXHAUSTED] 2 continuations exhausted, returning partial")
                self._log(f"[ASSISTANT] {text}")

                # Follow-up — callback hook + queue drain (REQ-ARCH-14, TASK-FW-014)
                if self.get_follow_up_messages:
                    follow_ups = self.get_follow_up_messages(_state())
                    if follow_ups:
                        self.messages.extend(follow_ups)
                        _iter_log("follow_up")
                        continue
                if not self._followup_queue.empty():
                    try:
                        msgs, drain = self._followup_queue.get_nowait()
                        self.messages.extend(msgs)
                        if drain == "all":
                            while not self._followup_queue.empty():
                                more_msgs, _ = self._followup_queue.get_nowait()
                                self.messages.extend(more_msgs)
                        _iter_log("follow_up")
                        continue
                    except queue.Empty:
                        pass
                s = _state()
                self._log(f"[LOOP_EXIT reason=natural_stop turns={s.turn_count} total_input={s.input_tokens_total} total_output={s.output_tokens_total}]")
                return text

            # Stall detection — same call signature as last iteration.
            # For write tools, signature is path-only (not content) so that
            # rewriting a file with different content is still detected as a stall.
            def _tc_sig(tc: dict) -> str:
                name = tc["function"]["name"]
                if name in ("write_framework_file", "write_source_file", "edit_source_file"):
                    import json as _json
                    try:
                        args = _json.loads(tc["function"].get("arguments", "{}"))
                        return f"{name}:{args.get('path', '')}"
                    except (ValueError, KeyError):
                        return name
                return f"{name}:{tc['function'].get('arguments', '')}"

            call_sig = "|".join(_tc_sig(tc) for tc in tool_calls)
            should_stop, last_call_sig, stall_nudges = self._handle_stall(
                call_sig, last_call_sig, stall_nudges
            )
            if should_stop:
                break
            if stall_nudges > 0 and last_call_sig is None:
                # Nudge was injected — skip the rest and retry
                _iter_log(f"stall_nudge_{stall_nudges}")
                continue

            done = any(tc["function"]["name"] == "done" for tc in tool_calls)

            self.messages.append({
                "role": "assistant",
                "content": text or None,
                "tool_calls": tool_calls,
            })

            # Execute tool calls in batches — concurrent for read tools (TASK-FW-009)
            batches = self._partition_tool_calls(tool_calls)
            for batch in batches:
                has_done = any(tc["function"]["name"] == "done" for tc in batch)
                # Run serially if: single item, has done tool, or before_tool_call hook set
                if len(batch) == 1 or has_done or self.before_tool_call:
                    for tc in batch:
                        name = tc["function"]["name"]
                        args = tc["function"].get("arguments", "")
                        tools_called_this_turn.append(name)
                        self._log(f"[TOOL_CALL] {name}({args})")
                        if name == "done":
                            result = "OK"
                        else:
                            intercepted = self.before_tool_call(name, args) if self.before_tool_call else None
                            if intercepted is not None:
                                result = intercepted
                            else:
                                result = self._handle_tool_call_dict(tc)
                            if self.after_tool_call:
                                result = self.after_tool_call(name, result)
                            if self.on_tool_result:
                                self.on_tool_result(name, result)
                        self._log(f"[TOOL_RESULT] {name} -> {self._redact_tool_result(name, tc['function'].get('arguments', ''), result)[:2000]}")
                        self.messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
                else:
                    # Concurrent batch — log, execute, then process results
                    for tc in batch:
                        self._log(f"[TOOL_CALL] {tc['function']['name']}({tc['function'].get('arguments', '')})")
                    pairs = self._execute_tool_batch(batch)
                    for tc, result in pairs:
                        name = tc["function"]["name"]
                        tools_called_this_turn.append(name)
                        if self.after_tool_call:
                            result = self.after_tool_call(name, result)
                        if self.on_tool_result:
                            self.on_tool_result(name, result)
                        self._log(f"[TOOL_RESULT] {name} -> {self._redact_tool_result(name, tc['function'].get('arguments', ''), result)[:2000]}")
                        self.messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})

            if done:
                self.tools = []
                _iter_log("done_tool")
                continue

            # Steering messages — callback hook + queue drain (REQ-ARCH-14, TASK-FW-014)
            if self.get_steering_messages:
                steering = self.get_steering_messages(_state())
                if steering:
                    self.messages.extend(steering)
            while not self._steering_queue.empty():
                try:
                    self.messages.extend(self._steering_queue.get_nowait())
                except queue.Empty:
                    break

            # Loop control checks after each tool round (REQ-ARCH-14)
            turn_count += 1
            _iter_log("tool_call")
            # Fire on_progress with turn/tool data for dashboard (REQ-UI-11)
            if self.on_progress and tools_called_this_turn:
                self.on_progress({
                    "turn": turn_count,
                    "last_tool": tools_called_this_turn[-1],
                })
            stop_reason: str | None = None
            if _abort_requested:
                stop_reason = "operator_abort"
            elif self.max_turns > 0 and turn_count >= self.max_turns:
                stop_reason = "max_turns"
            elif self.token_budget:
                try:
                    self.token_budget.check()
                except Exception:
                    stop_reason = "budget_exhausted"
            if not stop_reason and self.stop_check:
                stop_reason = self.stop_check(_state())
            if stop_reason:
                self._log(f"[LOOP_STOP reason={stop_reason}]")
                break

        # Stalled — force final call with only write tools
        self._log("[STALL] Forcing final text call")
        self.tools = [t for t in self.tools if t["function"]["name"] in ("write_source_file", "edit_source_file", "write_framework_file", "done")]
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
                self._log(f"[TOOL_RESULT] {name} -> {self._redact_tool_result(name, tc['function'].get('arguments', ''), result)[:2000]}")
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })
            text = ""

        text = self._strip_think(text)
        self._log(f"[ASSISTANT] {text}")
        s = _state()
        self._log(f"[LOOP_EXIT reason=forced_stop turns={s.turn_count} total_input={s.input_tokens_total} total_output={s.output_tokens_total}]")
        return text

    # ------------------------------------------------------------------
    # _run_loop helpers — extracted for testability (TODO-05)
    # ------------------------------------------------------------------

    def _drain_queues(self) -> tuple[list[dict], list[tuple[list[dict], str]]]:
        """Drain steering and follow-up queues without blocking.

        Returns:
            Tuple of (steering_msgs, followup_items) where followup_items is
            a list of (messages, drain_mode) tuples.
        """
        steering_msgs: list[dict] = []
        while not self._steering_queue.empty():
            try:
                steering_msgs.extend(self._steering_queue.get_nowait())
            except queue.Empty:
                break
        followup_items: list[tuple[list[dict], str]] = []
        while not self._followup_queue.empty():
            try:
                followup_items.append(self._followup_queue.get_nowait())
            except queue.Empty:
                break
        return steering_msgs, followup_items

    def _handle_stall(
        self,
        tool_signature: str,
        last_sig: str | None,
        stall_count: int,
    ) -> tuple[bool, str | None, int]:
        """Handle stall detection and nudge injection.

        Args:
            tool_signature: Signature string for the current tool calls.
            last_sig: The signature from the previous iteration (or None).
            stall_count: Current stall nudge counter.

        Returns:
            Tuple of (should_stop, new_last_sig, new_stall_count). If
            should_stop is True the caller should break out of the loop.
            new_last_sig is the updated last_call_sig for the next iteration.
        """
        if tool_signature != last_sig:
            return False, tool_signature, stall_count

        new_count = stall_count + 1
        self._log(f"[STALL] Repeated call ({new_count}): {tool_signature}")
        if new_count >= 2:
            self._log("[LOOP_STOP reason=stall_exhausted]")
            return True, last_sig, new_count

        from . import prompts as _prompts
        self.messages.append({
            "role": "user",
            "content": _prompts.load_prompt("system", "STALL-NUDGE"),
        })
        # Reset sig so next iteration isn't immediately flagged as stall
        return False, None, new_count

    _RETRY_MAX = 3
    _RETRY_BASE = 1.0
    _RETRY_MULT = 2.0
    _RETRY_CAP = 30.0

    @staticmethod
    def _jitter(delay: float) -> float:
        """Apply ±30% random jitter to a delay value (REQ-ARCH-10)."""
        return delay * (0.7 + random.random() * 0.6)

    @staticmethod
    def _get_retry_after(exc: Exception) -> float | None:
        """Extract Retry-After header value from a 429 response (REQ-ARCH-10)."""
        if isinstance(exc, openai.APIStatusError) and exc.status_code == 429:
            header = exc.response.headers.get("retry-after")
            if header:
                try:
                    return min(float(header), 30.0)
                except (ValueError, TypeError):
                    pass
        return None

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

    def _is_availability_error(self, exc: Exception) -> bool:
        """Return True if the error is a transient availability issue (429/5xx) for fallback (REQ-MC-4)."""
        if isinstance(exc, openai.RateLimitError):
            return True
        if isinstance(exc, openai.APIStatusError):
            return exc.status_code == 429 or exc.status_code >= 500
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
        """Drop the oldest tool call / tool result block to reduce context size."""
        new_msgs, did_trim = _trim_messages_fn(self.messages)
        if did_trim:
            removed = len(self.messages) - len(new_msgs)
            self.messages = new_msgs
            self._log(f"[TRIM] Removed {removed} messages (tool call+results) to reduce context")
        return did_trim

    def _is_context_length_error(self, exc: Exception) -> bool:
        """Return True if the error is a context-length overflow (REQ-ARCH-12)."""
        msg = str(exc).lower()
        if "context length" in msg or "maximum context" in msg:
            return True
        if "token" in msg and "exceed" in msg:
            return True
        if isinstance(exc, openai.APIStatusError) and exc.status_code == 413:
            return True
        return False

    def _reactive_compact(self, client: OpenAI) -> bool:
        """Summarize old messages to free context (REQ-ARCH-12)."""
        new_msgs, new_count, did_compact = _reactive_compact_fn(
            self.messages, client, self._model_name(), self._reactive_compact_count,
        )
        if did_compact:
            freed = len(self.messages) - len(new_msgs)
            self._reactive_compact_count = new_count
            self.messages = new_msgs
            self._log(
                f"[REACTIVE_COMPACT attempt={self._reactive_compact_count} freed={freed}]"
            )
        return did_compact

    def _create_completion(self, client: OpenAI, kwargs: dict) -> Any:
        """Call client.chat.completions.create with exponential backoff retry (REQ-ARCH-10).

        Does NOT handle model fallback — callers that need fallback wrap this method.
        """
        delay = self._RETRY_BASE
        last_exc: Exception | None = None
        for attempt in range(1, self._RETRY_MAX + 1):
            try:
                return client.chat.completions.create(**kwargs)
            except Exception as exc:
                last_exc = exc
                if not self._is_retryable(exc) or attempt == self._RETRY_MAX:
                    raise
                retry_after = self._get_retry_after(exc)
                base = retry_after if retry_after is not None else delay
                jittered = self._jitter(base)
                ra_info = f" retry-after={retry_after:.0f}s" if retry_after is not None else ""
                self._log(
                    f"[RETRY attempt={attempt} delay={jittered:.1f}s"
                    f" reason={type(exc).__name__}{ra_info}]"
                )
                time.sleep(jittered)
                if retry_after is None:
                    delay = min(delay * self._RETRY_MULT, self._RETRY_CAP)
        raise last_exc  # type: ignore[misc]

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
        _using_fallback = getattr(self, "_using_fallback", False)
        try:
            try:
                response = self._create_completion(client, kwargs)
            except Exception as exc:
                last_exc = exc
                # Fallback on availability error after retries exhausted (REQ-MC-4)
                if (
                    not _using_fallback
                    and self.model.fallback
                    and self._is_availability_error(exc)
                ):
                    from .models import resolve_model
                    try:
                        fb = resolve_model(self.model.fallback)
                        self._log(
                            f"[MODEL_FALLBACK primary={self.model.alias}"
                            f" fallback={fb.alias} reason=retries_exhausted]"
                        )
                        self.model = fb
                        self._using_fallback = True
                        client = self._get_client()
                        kwargs["model"] = self._model_name()
                        response = self._create_completion(client, kwargs)
                        last_exc = None
                    except Exception as _fb_exc:
                        self._log(
                            f"[MODEL_FALLBACK_FAILED fallback={self.model.fallback}"
                            f" reason={type(_fb_exc).__name__}: {_fb_exc}]"
                        )
                        raise
                if last_exc is not None:
                    raise last_exc
        finally:
            _tick_stop.set()
            if _tick_thread:
                _tick_thread.join(timeout=0.5)

        if response is None:
            raise RuntimeError("No response received")  # type: ignore[misc]
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
            # Token budget recording (REQ-ARCH-13)
            if self.token_budget:
                self.token_budget.record(prompt_tokens, completion_tokens)
            # Cache efficiency logging (TASK-FW-015)
            cache_create = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
            if cache_create or cache_read:
                self._log(f"[CACHE create={cache_create} read={cache_read}]")

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
        _stream_obj = self._create_completion(client, kwargs)

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
            # Token budget recording (REQ-ARCH-13)
            if self.token_budget:
                self.token_budget.record(prompt_tokens, completion_tokens)
            # Cache efficiency logging (TASK-FW-015)
            cache_create = usage_data.get("cache_creation_input_tokens", 0) or 0
            cache_read = usage_data.get("cache_read_input_tokens", 0) or 0
            if cache_create or cache_read:
                self._log(f"[CACHE create={cache_create} read={cache_read}]")

        return collected_text, tool_calls_list, finish_reason

    # --- Tool argument normalization (TASK-FW-010) ---

    @staticmethod
    def _normalize_path(args: dict) -> dict:
        """Normalize file path arguments — strip leading / and project root."""
        p = args.get("path", "")
        if isinstance(p, str):
            p = p.lstrip("/")
            # Strip common project root prefixes models hallucinate
            for prefix in ("home/", "src/../", "./"):
                if p.startswith(prefix) and prefix == "./":
                    p = p[2:]
            args["path"] = p
        return args

    @staticmethod
    def _normalize_content_str(args: dict) -> dict:
        """Ensure content is a string."""
        c = args.get("content")
        if isinstance(c, list):
            args["content"] = "\n".join(str(x) for x in c)
        return args

    _TOOL_NORMALIZERS: dict[str, list[Callable]] = {
        "read_source_file": [_normalize_path.__func__],
        "read_framework_file": [_normalize_path.__func__],
        "write_source_file": [_normalize_path.__func__, _normalize_content_str.__func__],
        "edit_source_file": [_normalize_path.__func__],
    }

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

        # Normalize arguments (TASK-FW-010)
        normalizers = self._TOOL_NORMALIZERS.get(name)
        if normalizers:
            raw = dict(args)
            for norm in normalizers:
                args = norm(args)
            for k in set(raw) | set(args):
                if raw.get(k) != args.get(k):
                    self._log(f"[TOOL_NORMALIZE tool={name} field={k} raw={raw.get(k)!r} normalized={args.get(k)!r}]")

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

    def _partition_tool_calls(self, tool_calls: list[dict]) -> list[list[dict]]:
        """Group consecutive concurrent-safe tool calls into batches (TASK-FW-009)."""
        concurrent_safe = {
            t["function"]["name"]
            for t in self.tools
            if t.get("concurrent_safe")
        }
        batches: list[list[dict]] = []
        current: list[dict] = []
        for tc in tool_calls:
            name = tc["function"]["name"]
            if name in concurrent_safe:
                current.append(tc)
            else:
                if current:
                    batches.append(current)
                    current = []
                batches.append([tc])
        if current:
            batches.append(current)
        return batches

    def _execute_tool_batch(self, batch: list[dict]) -> list[tuple[dict, str]]:
        """Execute a batch of tool calls, concurrently if safe (TASK-FW-009).

        Returns list of (tool_call, result) tuples in original order.
        """
        if len(batch) <= 1:
            tc = batch[0]
            return [(tc, self._handle_tool_call_dict(tc))]

        from concurrent.futures import ThreadPoolExecutor, as_completed
        results: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=min(len(batch), 10)) as pool:
            futures = {
                pool.submit(self._handle_tool_call_dict, tc): tc["id"]
                for tc in batch
            }
            for fut in as_completed(futures):
                tc_id = futures[fut]
                try:
                    results[tc_id] = fut.result()
                except Exception as e:
                    results[tc_id] = f"Error: {e}"
        return [(tc, results[tc["id"]]) for tc in batch]


# Tool builder — moved to tool_builder.py; re-exported for back-compat
from .tool_builder import (
    build_local_tools,
    build_tool_guidelines,
)
