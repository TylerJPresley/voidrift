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

import httpx
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
            raise RuntimeError(msg) from e

    def _run_loop(self, force_tool: bool = True) -> str:
        """Run the agent loop until a final text response (no more tool calls).

        Args:
            force_tool: If True and tools are present, set tool_choice=required.

        Returns:
            Final assistant response text.
        """
        client = self._get_client()
        model_name = self._model_name()

        while True:
            kwargs: dict[str, Any] = {
                "model": model_name,
                "messages": self.messages,
                "max_tokens": self.max_tokens,
            }
            if self.tools and force_tool:
                kwargs["tools"] = self.tools
                kwargs["tool_choice"] = "required"
            if self.extra_body:
                kwargs["extra_body"] = self.extra_body

            if self.stream:
                return self._stream_response(client, kwargs)
            else:
                response = client.chat.completions.create(**kwargs)
                choice = response.choices[0]
                msg = choice.message

                if msg.tool_calls:
                    # Handle tool calls
                    self.messages.append(msg.model_dump())
                    for tc in msg.tool_calls:
                        result = self._handle_tool_call(tc)
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result,
                        })
                    continue  # Loop back for next response

                # Final text response
                text = msg.content or ""
                self.messages.append({"role": "assistant", "content": text})
                return text

    def _stream_response(self, client: OpenAI, kwargs: dict) -> str:
        """Stream a response, printing tokens as they arrive.

        Args:
            client: OpenAI client instance.
            kwargs: Arguments for the chat completions API call.

        Returns:
            Collected response text.
        """
        kwargs["stream"] = True
        kwargs["stream_options"] = {"include_usage": True}
        collected_text = ""
        collected_tool_calls: dict[int, dict] = {}
        token_count = 0
        usage_data: dict = {}
        stream_start = time.time()

        # Spinner until first token arrives
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
                    # Final chunk may have usage data
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

        # If we got tool calls, handle them and loop
        if collected_tool_calls:
            if collected_text and not self.on_token:
                sys.stdout.write("\n")
                sys.stdout.flush()
            tool_calls_list = [collected_tool_calls[i] for i in sorted(collected_tool_calls)]
            self.messages.append({
                "role": "assistant",
                "content": collected_text or None,
                "tool_calls": tool_calls_list,
            })
            for tc in tool_calls_list:
                result = self._handle_tool_call_dict(tc)
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })
            # Continue the loop
            return self._run_loop(force_tool=False)

        # Final text response
        if collected_text and not self.on_token:
            sys.stdout.write("\n")
            sys.stdout.flush()

        self.messages.append({"role": "assistant", "content": collected_text})

        # Emit stats
        if self.on_complete:
            elapsed = time.time() - stream_start
            completion_tokens = usage_data.get("completion_tokens", token_count)
            tps = completion_tokens / elapsed if elapsed > 0 else 0
            self.on_complete({
                **usage_data,
                "elapsed": round(elapsed, 1),
                "tokens_per_sec": round(tps, 1),
            })

        return collected_text

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

    def _handle_tool_call(self, tool_call: Any) -> str:
        """Execute a tool call from an SDK object.

        Args:
            tool_call: OpenAI tool call object with .function.name and .function.arguments.

        Returns:
            Tool result string.
        """
        return self._execute_tool(tool_call.function.name, tool_call.function.arguments)

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
