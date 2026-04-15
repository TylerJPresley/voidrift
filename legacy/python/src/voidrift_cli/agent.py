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

from .models import ModelConfig, ModelInterface
from .token_budget import BudgetExhaustedError
from ._agent_abort import (
    AbortRequested,
    request_abort,
    clear_abort,
    is_abort_requested,
    register_loop as _register_loop,
    unregister_loop as _unregister_loop,
    abort_aware_sleep as _abort_aware_sleep,
    _active_loops,
)


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

    model: ModelInterface
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

    def _get_client(self):
        """Create the protocol client for the model's API."""
        return self.model.adapter.get_client(self.model.config)

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
        _register_loop(self)
        try:
            return self._run_loop()
        except AbortRequested:
            raise RuntimeError("Operator abort")
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
        finally:
            _unregister_loop(self)

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

    def _redact_tool_result(self, name: str, arguments: str, result: str) -> str:
        """Redact tool results for known sensitive file paths."""
        if name != "file":
            return result
        try:
            args = json.loads(arguments)
            if args.get("action") != "read":
                return result
            path = args.get("path", "")
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
        self._active_client = client  # track for cleanup (REQ-ARCH-21)
        model_name = self._model_name()
        last_call_sig: frozenset[str] | None = None
        stall_nudges = 0
        max_tokens_continuations = 0
        accumulated_text = ""
        turn_count = 0
        # Per-session token accumulators (REQ-ARCH-13, REQ-ARCH-18). Updated by
        # _sync_response/_stream_response via self._input_tokens and self._output_tokens.
        self._input_tokens: int = 0
        self._output_tokens: int = 0
        tools_called_this_turn: list[str] = []

        def _state() -> LoopState:
            inp = self.token_budget.input_tokens if self.token_budget else self._input_tokens
            out = self.token_budget.output_tokens if self.token_budget else self._output_tokens
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

        try:
            while True:
                tools_called_this_turn = []

                # Token budget check (REQ-ARCH-13)
                if self.token_budget:
                    self.token_budget.check()

                kwargs: dict[str, Any] = {
                    "model": model_name,
                    "messages": (
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
                    if self.model.adapter.is_context_truncation(exc) and self._trim_messages():
                        self._log("[CONTEXT_TRIM] Tools JSON truncated — trimmed messages, retrying")
                        _iter_log("context_trim")
                        continue
                    if self.model.adapter.is_context_length_error(exc) and self._reactive_compact(client):
                        _iter_log("reactive_compact")
                        continue
                    raise

                # Max-tokens recovery (REQ-ARCH-11)
                truncated = finish_reason == "length"
                if truncated and tool_calls:
                    n = len(tool_calls)
                    self._log(f"[MAX_TOKENS_TOOL_DISCARD] Discarded {n} truncated tool calls, requesting re-emit")
                    self.messages.append({"role": "assistant", "content": text or None})
                    from . import prompts as _prompts
                    resume = _prompts.load_prompt("system", "MAX-TOKENS-TOOL-RESUME")
                    self.messages.append({"role": "user", "content": resume})
                    _iter_log("max_tokens_recovery")
                    continue

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
                    item = self._drain_one_followup()
                    if item:
                        msgs, drain = item
                        self.messages.extend(msgs)
                        if drain == "all":
                            while (more := self._drain_one_followup()):
                                self.messages.extend(more[0])
                        _iter_log("follow_up")
                        continue
                    s = _state()
                    self._log(f"[LOOP_EXIT reason=natural_stop turns={s.turn_count} total_input={s.input_tokens_total} total_output={s.output_tokens_total}]")
                    return text

                # Stall detection — same call signature as last iteration.
                # For write tools, signature is path-only (not content) so that
                # rewriting a file with different content is still detected as a stall.
                def _tc_sig(tc: dict) -> str:
                    name = tc["function"]["name"]
                    import json as _json
                    try:
                        args = _json.loads(tc["function"].get("arguments", "{}"))
                    except (ValueError, KeyError):
                        args = {}
                    is_write = (
                        name == "file" and args.get("action") in ("write", "edit", "delete")
                    )
                    if is_write:
                        return f"{name}:{args.get('path', '')}"
                    return f"{name}:{tc['function'].get('arguments', '')}"

                call_sig = frozenset(_tc_sig(tc) for tc in tool_calls)
                should_stop, last_call_sig, stall_nudges = self._handle_stall(
                    call_sig, last_call_sig, stall_nudges
                )
                if should_stop:
                    break
                if stall_nudges > 0 and last_call_sig is None:
                    # Nudge was injected — skip the rest and retry
                    _iter_log(f"stall_nudge_{stall_nudges}")
                    continue

                # Deduplicate identical tool calls (REQ-ARCH-16)
                unique_calls, dedup_map = self._deduplicate_tool_calls(tool_calls)

                done = any(tc["function"]["name"] == "done" for tc in unique_calls)

                self.messages.append({
                    "role": "assistant",
                    "content": text or None,
                    "tool_calls": tool_calls,
                })

                # Execute unique tool calls in batches — concurrent for read tools (TASK-FW-009)
                batches = self._partition_tool_calls(unique_calls)
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
                                intercepted = self.before_tool_call(name, args) if self.before_tool_call else None
                                if intercepted is not None:
                                    result = intercepted
                                    done = False  # hook rejected done — keep looping
                                else:
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
                            # Map result to deduplicated siblings (REQ-ARCH-16)
                            for dup_id in dedup_map.get(tc["id"], []):
                                self.messages.append({"role": "tool", "tool_call_id": dup_id, "content": result})
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
                            # Map result to deduplicated siblings (REQ-ARCH-16)
                            for dup_id in dedup_map.get(tc["id"], []):
                                self.messages.append({"role": "tool", "tool_call_id": dup_id, "content": result})

                if done:
                    self.tools = []
                    _iter_log("done_tool")
                    continue

                # Steering messages — callback hook + queue drain (REQ-ARCH-14, TASK-FW-014)
                if self.get_steering_messages:
                    steering = self.get_steering_messages(_state())
                    if steering:
                        self.messages.extend(steering)
                steering = self._drain_steering()
                if steering:
                    self.messages.extend(steering)

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
                if is_abort_requested():
                    stop_reason = "operator_abort"
                elif self.max_turns > 0 and turn_count >= self.max_turns:
                    stop_reason = "max_turns"
                elif self.token_budget:
                    try:
                        self.token_budget.check()
                    except BudgetExhaustedError:
                        stop_reason = "budget_exhausted"
                if not stop_reason and self.stop_check:
                    stop_reason = self.stop_check(_state())
                if stop_reason:
                    self._log(f"[LOOP_STOP reason={stop_reason}]")
                    break

            # Stalled — force final call with only write tools
            self._log("[STALL] Forcing final text call")
            self.tools = [t for t in self.tools if t["function"]["name"] in ("file", "done")]
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
        finally:
            self._active_client.close()

    # ------------------------------------------------------------------
    # _run_loop helpers — extracted for testability (TODO-05)
    # ------------------------------------------------------------------

    def _drain_steering(self) -> list[dict]:
        """Drain the steering queue without blocking. Returns all pending messages.

        Returns:
            Flat list of all message dicts currently in the steering queue.
        """
        msgs: list[dict] = []
        while not self._steering_queue.empty():
            try:
                msgs.extend(self._steering_queue.get_nowait())
            except queue.Empty:
                break
        return msgs

    def _drain_one_followup(self) -> tuple[list[dict], str] | None:
        """Drain one item from the follow-up queue without blocking.

        Returns:
            (messages, drain_mode) tuple, or None if the queue is empty.
        """
        if self._followup_queue.empty():
            return None
        try:
            return self._followup_queue.get_nowait()
        except queue.Empty:
            return None

    def _handle_stall(
        self,
        tool_signatures: frozenset[str],
        last_sigs: frozenset[str] | None,
        stall_count: int,
    ) -> tuple[bool, frozenset[str] | None, int]:
        """Handle stall detection and nudge injection.

        Compares individual call signatures as sets. If any signature from the
        current turn appeared in the previous turn, it's a stall — regardless
        of how many times each call appears (REQ-ARCH-4).

        Args:
            tool_signatures: Set of signatures for the current tool calls.
            last_sigs: The signature set from the previous iteration (or None).
            stall_count: Current stall nudge counter.

        Returns:
            Tuple of (should_stop, new_last_sigs, new_stall_count). If
            should_stop is True the caller should break out of the loop.
            new_last_sigs is the updated signature set for the next iteration.
        """
        if last_sigs is None or not tool_signatures & last_sigs:
            return False, tool_signatures, stall_count

        new_count = stall_count + 1
        overlap = tool_signatures & last_sigs
        self._log(f"[STALL] Repeated call ({new_count}): {sorted(overlap)}")
        if new_count >= 2:
            self._log("[LOOP_STOP reason=stall_exhausted]")
            return True, last_sigs, new_count

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

    def _trim_messages(self) -> bool:
        """Drop the oldest tool call / tool result block to reduce context size."""
        new_msgs, did_trim = _trim_messages_fn(self.messages)
        if did_trim:
            removed = len(self.messages) - len(new_msgs)
            self.messages = new_msgs
            self._log(f"[TRIM] Removed {removed} messages (tool call+results) to reduce context")
        return did_trim

    def _reactive_compact(self, client: Any) -> bool:
        """Summarize old messages to free context (REQ-ARCH-12)."""
        def compact_fn(content: str) -> str:
            return self.model.adapter.compact_call(client, content, self._model_name())

        new_msgs, new_count, did_compact = _reactive_compact_fn(
            self.messages, compact_fn, self._reactive_compact_count,
        )
        if did_compact:
            freed = len(self.messages) - len(new_msgs)
            self._reactive_compact_count = new_count
            self.messages = new_msgs
            self._log(
                f"[REACTIVE_COMPACT attempt={self._reactive_compact_count} freed={freed}]"
            )
        return did_compact

    def _create_with_retry(self, client: Any, wire_request: dict, streaming: bool = False) -> Any:
        """Unified retry wrapper for sync and streaming API calls (REQ-ARCH-10)."""
        delay = self._RETRY_BASE
        last_exc: Exception | None = None
        for attempt in range(1, self._RETRY_MAX + 1):
            try:
                if streaming:
                    return self.model.adapter.create_raw_stream(client, wire_request)
                return self.model.adapter.create_raw(client, wire_request)
            except Exception as exc:
                last_exc = exc
                if is_abort_requested():
                    raise AbortRequested("Operator abort") from exc
                if not self.model.adapter.is_retryable(exc) or attempt == self._RETRY_MAX:
                    raise
                retry_after = self.model.adapter.get_retry_after(exc)
                base = retry_after if retry_after is not None else delay
                jittered = self._jitter(base)
                ra_info = f" retry-after={retry_after:.0f}s" if retry_after is not None else ""
                self._log(
                    f"[RETRY attempt={attempt} delay={jittered:.1f}s"
                    f" reason={type(exc).__name__}{ra_info}]"
                )
                _abort_aware_sleep(jittered)  # REQ-D-13
                if retry_after is None:
                    delay = min(delay * self._RETRY_MULT, self._RETRY_CAP)
        raise last_exc  # type: ignore[misc]

    def _create_completion(self, client: Any, openai_kwargs: dict) -> Any:
        """Execute a sync API call via the protocol adapter with retry (REQ-ARCH-10).

        Does NOT handle model fallback — callers that need fallback wrap this method.
        """
        wire_request = self.model.adapter.build_request(
            openai_kwargs, provider=self.model.config.provider or ""
        )
        return self._create_with_retry(client, wire_request, streaming=False)

    def _sync_response(self, client: Any, kwargs: dict) -> tuple[str, list[dict], str | None]:
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
        raw = None
        _using_fallback = getattr(self, "_using_fallback", False)
        try:
            try:
                raw = self._create_completion(client, kwargs)
            except Exception as exc:
                last_exc = exc
                # Fallback on availability error after retries exhausted (REQ-MC-4)
                if (
                    not _using_fallback
                    and self.model.fallback
                    and self.model.adapter.is_availability_error(exc)
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
                        client.close()  # close old client before fallback (REQ-ARCH-21)
                        client = self._get_client()
                        self._active_client = client  # track for cleanup (REQ-ARCH-21)
                        kwargs["model"] = self._model_name()
                        raw = self._create_completion(client, kwargs)
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

        if raw is None:
            raise RuntimeError("No response received")  # type: ignore[misc]

        text, tool_calls, finish_reason, usage = self.model.adapter.parse_response(
            raw, log_fn=self._log
        )

        # Token accumulation — unconditional so LOOP_EXIT totals are always accurate
        # and budget enforcement is never silently skipped (REQ-ARCH-13, REQ-ARCH-18).
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        total_tokens = usage.get("total_tokens", 0)
        self._input_tokens += prompt_tokens
        self._output_tokens += completion_tokens
        if self.token_budget:
            self.token_budget.record(prompt_tokens, completion_tokens)

        # UI telemetry — only when the provider returned useful counts
        if prompt_tokens or completion_tokens:
            ctx_pct: int | None = None
            if self.model.config.max_context and prompt_tokens:
                ctx_pct = min(100, round(prompt_tokens * 100 / self.model.config.max_context))
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

        # Cache efficiency logging (TASK-FW-015)
        cache_create = usage.get("cache_creation_input_tokens", 0) or 0
        cache_read = usage.get("cache_read_input_tokens", 0) or 0
        if cache_create or cache_read:
            self._log(f"[CACHE create={cache_create} read={cache_read}]")

        return text, tool_calls, finish_reason

    def _stream_response(self, client: Any, kwargs: dict) -> tuple[str, list[dict], str | None]:
        """Stream a response, printing tokens as they arrive.

        Args:
            client: Protocol client instance (OpenAI or Anthropic).
            kwargs: OpenAI-format arguments for the API call.

        Returns:
            Tuple of (collected_text, tool_calls_list, finish_reason).
        """
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

        # Build wire request once; get stream with retry (REQ-ARCH-10)
        wire_request = self.model.adapter.build_request(
            kwargs, provider=self.model.config.provider or ""
        )
        _stream_obj = self._create_with_retry(client, wire_request, streaming=True)

        # emit_token wrapper: stops spinner/ticker on first visible token
        def _emit(text: str) -> None:
            if not stop_spinner.is_set():
                stop_spinner.set()
                if spinner:
                    spinner.join()
            if not _prog_stop.is_set():
                _prog_stop.set()
            self._emit_token(text)

        try:
            text, tool_calls, finish_reason, usage = self.model.adapter.iter_stream(
                _stream_obj, emit_token=_emit, log_fn=self._log
            )
        finally:
            if not stop_spinner.is_set():
                stop_spinner.set()
            if spinner:
                spinner.join()
            if not _prog_stop.is_set():
                _prog_stop.set()
            if _prog_thread:
                _prog_thread.join(timeout=0.5)

        # Fire on_tool_call for each tool call discovered during the stream
        if tool_calls and self.on_tool_call:
            for tc in tool_calls:
                self.on_tool_call(tc["function"]["name"], tc["function"].get("arguments", ""))

        # Token accumulation — unconditional so LOOP_EXIT totals are always accurate
        # and budget enforcement is never silently skipped (REQ-ARCH-13, REQ-ARCH-18).
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        self._input_tokens += prompt_tokens
        self._output_tokens += completion_tokens
        if self.token_budget:
            self.token_budget.record(prompt_tokens, completion_tokens)

        # Cache efficiency logging (TASK-FW-015) — unconditional
        cache_create = usage.get("cache_creation_input_tokens", 0) or 0
        cache_read = usage.get("cache_read_input_tokens", 0) or 0
        if cache_create or cache_read:
            self._log(f"[CACHE create={cache_create} read={cache_read}]")

        # Emit stats on final text response (no tool calls)
        if not tool_calls:
            if text and not self.on_token:
                sys.stdout.write("\n")
                sys.stdout.flush()
            elapsed = time.time() - stream_start
            ctx_pct: int | None = None
            if self.model.config.max_context and prompt_tokens:
                ctx_pct = min(100, round(prompt_tokens * 100 / self.model.config.max_context))
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
                    **usage,
                    "elapsed": round(elapsed, 1),
                    "tokens_per_sec": round(tps, 1),
                    "ctx_pct": ctx_pct,
                })

        return text, tool_calls, finish_reason

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
        "file": [_normalize_path.__func__, _normalize_content_str.__func__],
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

    def _deduplicate_tool_calls(
        self, tool_calls: list[dict]
    ) -> tuple[list[dict], dict[str, list[str]]]:
        """Deduplicate identical tool calls before execution (REQ-ARCH-16).

        Calls with the same function name and arguments are executed once.
        The result is mapped to every tool_call ID sharing that signature.

        Args:
            tool_calls: Raw tool calls from the model response.

        Returns:
            Tuple of (unique_calls, dedup_map) where dedup_map maps a
            representative call ID to a list of duplicate call IDs.
        """
        seen: dict[str, str] = {}  # sig -> representative call ID
        dedup_map: dict[str, list[str]] = {}  # representative ID -> [dup IDs]
        unique: list[dict] = []
        for tc in tool_calls:
            sig = f"{tc['function']['name']}:{tc['function'].get('arguments', '')}"
            rep_id = seen.get(sig)
            if rep_id is None:
                seen[sig] = tc["id"]
                unique.append(tc)
            else:
                dedup_map.setdefault(rep_id, []).append(tc["id"])
        # Log deduplication events
        for rep_id, dup_ids in dedup_map.items():
            rep_tc = next(tc for tc in unique if tc["id"] == rep_id)
            name = rep_tc["function"]["name"]
            total = len(dup_ids) + 1
            self._log(f"[DEDUP] {total} identical calls to {name} reduced to 1")
        return unique, dedup_map

    _FILE_SAFE_ACTIONS = frozenset({"read", "list"})
    _HTTP_SAFE_ACTIONS = frozenset({"get"})

    def _is_concurrent_safe(self, tc: dict, schema_safe: set[str]) -> bool:
        """Return True if this tool call can be batched for parallel execution."""
        name = tc["function"]["name"]
        if name in schema_safe:
            return True
        # Action-aware checks for mixed read/write domain tools (REQ-TOOL-6).
        if name == "file":
            try:
                import json as _j
                action = _j.loads(tc["function"].get("arguments", "{}")).get("action", "")
            except (ValueError, KeyError):
                action = ""
            return action in self._FILE_SAFE_ACTIONS
        if name == "http":
            try:
                import json as _j
                action = _j.loads(tc["function"].get("arguments", "{}")).get("action", "")
            except (ValueError, KeyError):
                action = ""
            return action in self._HTTP_SAFE_ACTIONS
        return False

    def _partition_tool_calls(self, tool_calls: list[dict]) -> list[list[dict]]:
        """Group consecutive concurrent-safe tool calls into batches (TASK-FW-009)."""
        schema_safe = {
            t["function"]["name"]
            for t in self.tools
            if t.get("concurrent_safe")
        }
        batches: list[list[dict]] = []
        current: list[dict] = []
        for tc in tool_calls:
            if self._is_concurrent_safe(tc, schema_safe):
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
