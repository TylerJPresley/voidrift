"""Agent loop — sends messages to model APIs, handles MCP tool calls, streams responses (AC-CLI3)."""

from __future__ import annotations

import itertools
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

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

        # Log system prompt and latest user message
        if self.log_path:
            for m in self.messages:
                if m["role"] == "system":
                    self._log(f"[SYSTEM] {m['content'][:500]}")
            self._log(f"[USER] {self.messages[-1]['content'][:500]}")

        while True:
            kwargs: dict[str, Any] = {
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

            if not tool_calls:
                self.messages.append({"role": "assistant", "content": text})
                self._log(f"[ASSISTANT] {text}")
                return text

            # Stall detection — same call signature as last iteration
            call_sig = "|".join(
                f"{tc['function']['name']}:{tc['function'].get('arguments', '')}"
                for tc in tool_calls
            )
            if call_sig == last_call_sig:
                break  # stalled — force final text call
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
                self._log(f"[TOOL_RESULT] {name} -> {result[:500]}")
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            if done:
                self.tools = []
                continue

        # Stalled — force a final text call with no tools
        self._log("[STALL] Forcing final text call")
        self.tools = []
        kwargs = {
            "model": model_name,
            "messages": self.messages,
            "max_tokens": self.max_tokens,
        }
        if self.extra_body:
            kwargs["extra_body"] = self.extra_body
        if self.stream:
            text, _ = self._stream_response(client, kwargs)
        else:
            text, _ = self._sync_response(client, kwargs)
        self._log(f"[ASSISTANT] {text}")
        return text

    def _sync_response(self, client: OpenAI, kwargs: dict) -> tuple[str, list[dict]]:
        """Non-streaming response.

        Returns:
            Tuple of (text, tool_calls_list).
        """
        response = client.chat.completions.create(**kwargs)
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

        # Spinner until first token arrives (blank line for spacing)
        if self.on_token:
            self.on_token("\n")
        else:
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

        try:
            stream = client.chat.completions.create(**kwargs)
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
                    if self.on_token:
                        self.on_token(delta.content)
                    else:
                        sys.stdout.write(delta.content)
                        sys.stdout.flush()
                    collected_text += delta.content
                    token_count += 1

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


def build_mcp_tools(mcp_server_module: Any) -> tuple[list[dict], dict[str, Callable]]:
    """Build OpenAI-format tool definitions from the MCP server's registered tools.

    Args:
        mcp_server_module: The imported ``voidrift_mcp.server`` module.

    Returns:
        Tuple of (tool_definitions, tool_handlers) for use with AgentLoop.
    """
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
        get_agent,
        get_skill,
        get_template,
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
        "get_agent": (get_agent, {
            "type": "object",
            "properties": {
                "role": {"type": "string", "description": "Role name ('analyst', 'architect', or 'developer')"},
                "topic": {"type": "string", "description": "Optional heading within the agent file", "default": ""},
            },
            "required": ["role"],
        }),
        "get_skill": (get_skill, {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill name (e.g. 'backend')"},
                "topic": {"type": "string", "description": "Optional heading within the skill", "default": ""},
            },
            "required": ["name"],
        }),
        "get_template": (get_template, {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Template name (e.g. 'adr-template')"},
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
    }

    for name, (func, params) in tool_map.items():
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
    tools.extend(LOCAL_TOOLS)
    handlers.update(LOCAL_HANDLERS)

    return tools, handlers
