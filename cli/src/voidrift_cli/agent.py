"""Agent loop — sends messages to model APIs, handles MCP tool calls, streams responses (AC-CLI3)."""

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
    log_path: Path | None = None

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
        from .config import get_api_key, get_worker_config

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
            kwargs["api_key"] = get_worker_config().get("api_key", "no-key")
        return OpenAI(timeout=120.0, **kwargs)

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

            if self.stream:
                text, tool_calls = self._stream_response(client, kwargs)
            else:
                text, tool_calls = self._sync_response(client, kwargs)

            if not tool_calls:
                text = self._strip_think(text)
                self.messages.append({"role": "assistant", "content": text})
                self._log(f"[ASSISTANT] {text}")
                return text

            # Stall detection — same call signature as last iteration
            call_sig = "|".join(
                f"{tc['function']['name']}:{tc['function'].get('arguments', '')}"
                for tc in tool_calls
            )
            if call_sig == last_call_sig:
                stall_nudges += 1
                self._log(f"[STALL] Repeated call ({stall_nudges}): {call_sig}")
                if stall_nudges >= 2:
                    break  # give up after 2 nudges
                # Inject a nudge instead of stripping tools — the model
                # is looping on reads and needs to move to writes.
                self.messages.append({
                    "role": "user",
                    "content": (
                        "You are repeating the same tool calls. You already have "
                        "all the information you need. Compose the COMPLETE content "
                        "for each file, then call write_source_file() or write_framework_file() with the FULL content. "
                        "Do NOT use placeholder content like '...' or 'TODO'."
                    ),
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
            text, tool_calls = self._stream_response(client, kwargs)
        else:
            text, tool_calls = self._sync_response(client, kwargs)

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

    def _sync_response(self, client: OpenAI, kwargs: dict) -> tuple[str, list[dict]]:
        """Non-streaming response with exponential backoff retry (REQ-ARCH-10).

        Returns:
            Tuple of (text, tool_calls_list).
        """
        last_exc: Exception | None = None
        response = None
        delay = self._RETRY_BASE
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
        if response is None:
            raise last_exc  # type: ignore[misc]
        msg = response.choices[0].message
        text = msg.content or ""
        tool_calls = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_calls.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                })
        return text, tool_calls

    def _stream_response(self, client: OpenAI, kwargs: dict) -> tuple[str, list[dict]]:
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
        stream_start = time.time()

        # Spinner until first token arrives
        if not self.on_token:
            sys.stderr.write("\n")
            sys.stderr.flush()
        stop_spinner = threading.Event()
        def _spin():
            for ch in itertools.cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"):
                if stop_spinner.wait(0.1):
                    break
                sys.stderr.write(f"\r\033[2m  {ch} Thinking...\033[0m")
                sys.stderr.flush()
            sys.stderr.write("\r\033[K")
            sys.stderr.flush()
        spinner = threading.Thread(target=_spin, daemon=True)
        spinner.start()

        in_think = True
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
            # Start assuming we're in a think block — models often emit
            # thinking content without an opening <think> tag.  If we
            # accumulate more than a threshold without seeing </think>,
            # flush the buffer as real content (it wasn't thinking).
            in_think = True
            think_buf = ""
            _THINK_FLUSH = 200  # chars before we decide it's not thinking

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

                # Accumulate text
                if delta.content:
                    if not stop_spinner.is_set():
                        stop_spinner.set()
                        spinner.join()
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
                                pending = pending[end_idx + 8:]
                                # Skip whitespace after closing tag
                                pending = pending.lstrip()
                            elif len(think_buf) + len(pending) > _THINK_FLUSH:
                                # Too much content without </think> — not thinking
                                in_think = False
                                self._emit_token(think_buf + pending)
                                think_buf = ""
                                pending = ""
                            else:
                                think_buf += pending
                                pending = ""
                        else:
                            # Check for orphaned </think> (no opening tag)
                            end_idx = pending.find("</think>")
                            start_idx = pending.find("<think>")
                            if end_idx != -1 and (start_idx == -1 or end_idx < start_idx):
                                # Orphaned closing tag — everything before it is thinking
                                before = pending[:end_idx]
                                if before.strip():
                                    self._log(f"[THINKING] {before.strip()}")
                                pending = pending[end_idx + 8:].lstrip()
                            elif start_idx != -1:
                                # Emit text before the tag
                                before = pending[:start_idx]
                                if before:
                                    self._emit_token(before)
                                in_think = True
                                pending = pending[start_idx + 7:]
                            elif "<" in pending and not pending.endswith(">"):
                                # Might be a partial tag — hold it
                                last_lt = pending.rfind("<")
                                partial = pending[last_lt:]
                                if "<think>"[:len(partial)] == partial or "</think>"[:len(partial)] == partial:
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
                        spinner.join()
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
            spinner.join()

        tool_calls_list = [collected_tool_calls[i] for i in sorted(collected_tool_calls)]

        # Emit stats on final text response (no tool calls)
        if not tool_calls_list:
            if collected_text and not self.on_token:
                sys.stdout.write("\n")
                sys.stdout.flush()
            if self.on_complete:
                elapsed = time.time() - stream_start
                completion_tokens = usage_data.get("completion_tokens", token_count)
                tps = completion_tokens / elapsed if elapsed > 0 else 0
                self.on_complete({
                    **usage_data,
                    "elapsed": round(elapsed, 1),
                    "tokens_per_sec": round(tps, 1),
                })

        return collected_text, tool_calls_list

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


def build_mcp_tools(mcp_server_module: Any, phase: str = "") -> tuple[list[dict], dict[str, Callable]]:
    """Build OpenAI-format tool definitions from the MCP server's registered tools.

    Args:
        mcp_server_module: The imported ``voidrift_mcp.server`` module.
        phase: Phase name to filter tools. Empty string returns all tools.

    Returns:
        Tuple of (tool_definitions, tool_handlers) for use with AgentLoop.
    """
    # Per-phase tool filtering — which MCP tools each phase can see
    _PHASE_TOOLS: dict[str, set[str]] = {
        "gather": {
            "store_file_analysis", "get_file_analysis", "get_all_analyses",
            "store_requirements", "get_requirements", "export_to_file",
            "get_skill", "get_template", "list_skills", "list_templates",
            "read_source_file", "read_framework_file", "write_framework_file",
        },
        "plan": {
            "get_skill", "get_template", "list_skills", "list_templates",
            "read_framework_file", "write_framework_file",
        },
        "develop": {
            "get_skill", "list_skills",
            "read_source_file", "write_source_file", "read_framework_file",
        },
        "chat": {
            "get_requirements", "get_task_status",
            "get_skill", "get_template", "list_skills", "list_templates",
            "list_documents", "list_project_artifacts",
            "read_source_file", "write_source_file",
            "read_framework_file", "write_framework_file",
        },
    }
    allowed = _PHASE_TOOLS.get(phase) if phase else None
    tools = []
    handlers = {}

    # Import the MCP server to access its tool registry
    from voidrift_mcp.server import (
        store_file_analysis,
        get_file_analysis,
        get_all_analyses,
        store_requirements,
        get_requirements,
        load_tasks,
        get_next_task,
        complete_task,
        get_task_status,
        get_skill,
        get_template,
        get_prompt,
        list_skills,
        list_templates,
        list_documents,
        list_prompts,
        export_to_file,
    )

    tool_map = {
        "store_file_analysis": (store_file_analysis, {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Relative path of the analyzed file"},
                "analysis": {"type": "string", "description": "Analysis text"},
            },
            "required": ["file_path", "analysis"],
        }),
        "get_file_analysis": (get_file_analysis, {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Relative path of the file"},
            },
            "required": ["file_path"],
        }),
        "get_all_analyses": (get_all_analyses, {
            "type": "object", "properties": {},
        }),
        "store_requirements": (store_requirements, {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Requirements markdown text"},
                "key": {"type": "string", "description": "'project' or feature name", "default": "project"},
            },
            "required": ["content"],
        }),
        "get_requirements": (get_requirements, {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "'project' or feature name", "default": "project"},
            },
        }),
        "load_tasks": (load_tasks, {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to TASKS.md", "default": ".voidrift/TASKS.md"},
            },
        }),
        "get_next_task": (get_next_task, {
            "type": "object",
            "properties": {
                "module": {"type": "string", "description": "Module name (empty for single-module)", "default": ""},
            },
        }),
        "complete_task": (complete_task, {
            "type": "object",
            "properties": {
                "module": {"type": "string", "description": "Module name (empty for single-module)", "default": ""},
            },
        }),
        "get_task_status": (get_task_status, {
            "type": "object",
            "properties": {
                "module": {"type": "string", "description": "Module name (empty for all modules)", "default": ""},
            },
        }),
        "get_skill": (get_skill, {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill name as returned by list_skills()"},
                "topic": {"type": "string", "description": "Optional H2 heading within the skill to retrieve a specific section", "default": ""},
            },
            "required": ["name"],
        }),
        "get_template": (get_template, {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Template name as returned by list_templates()"},
            },
            "required": ["name"],
        }),
        "export_to_file": (export_to_file, {
            "type": "object",
            "properties": {
                "artifact_type": {"type": "string", "description": "Type of artifact"},
                "path": {"type": "string", "description": "Relative path to write to"},
            },
            "required": ["artifact_type", "path"],
        }),
        "get_prompt": (get_prompt, {
            "type": "object",
            "properties": {
                "phase": {"type": "string", "description": "Phase name as returned by list_prompts()"},
                "section": {"type": "string", "description": "Section name (H2 heading) as returned by list_prompts(phase)"},
            },
            "required": ["phase", "section"],
        }),
        "list_skills": (list_skills, {
            "type": "object", "properties": {},
        }),
        "list_templates": (list_templates, {
            "type": "object", "properties": {},
        }),
        "list_documents": (list_documents, {
            "type": "object", "properties": {},
        }),
        "list_prompts": (list_prompts, {
            "type": "object",
            "properties": {
                "phase": {"type": "string", "description": "Phase name to filter by", "default": ""},
            },
        }),
    }

    for name, (func, params) in tool_map.items():
        if allowed is not None and name not in allowed:
            # Still register handler so phases can call it programmatically
            handlers[name] = func
            continue
        # Strip 'default' from properties — Anthropic rejects it
        for prop in params.get("properties", {}).values():
            prop.pop("default", None)
        tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": func.__doc__ or "",
                "parameters": params,
            },
        })
        handlers[name] = func

    # Include CLI-native filesystem tools (REQ-MCP-4a)
    from .tools import LOCAL_TOOLS, LOCAL_HANDLERS
    for tool_def in LOCAL_TOOLS:
        name = tool_def["function"]["name"]
        if allowed is not None and name not in allowed:
            handlers[name] = LOCAL_HANDLERS[name]
            continue
        tools.append(tool_def)
        handlers[name] = LOCAL_HANDLERS[name]

    return tools, handlers
