"""Tests for tool builder (build_tool_guidelines, build_local_tools, build_handlers, filter_tools)."""

import ast
import importlib
import inspect
from pathlib import Path

from voidrift_cli.tool_builder import (
    build_tool_guidelines,
    build_local_tools,
    build_handlers,
    filter_tools,
    validate_schema_handler_contract,
)
from voidrift_cli.tools.registry import (
    ALL_TOOLS,
    FILESYSTEM_TOOLS,
    SKILL_TOOLS,
    MEMORY_TOOLS,
    SESSION_TOOLS,
    DOCUMENT_TOOLS,
    CODE_ANALYSIS_TOOLS,
    BASH_TOOL,
    VERIFY_TOOLS,
)


class TestAgentToolsConstants:
    def test_each_command_module_declares_agent_tools(self):
        """Each command module declares AGENT_TOOLS as a frozenset."""
        for name in ("gather", "plan", "develop", "chat"):
            mod = importlib.import_module(f"voidrift_cli.commands.{name}")
            assert hasattr(mod, "AGENT_TOOLS"), f"{name} missing AGENT_TOOLS"
            assert isinstance(mod.AGENT_TOOLS, frozenset), f"{name}.AGENT_TOOLS is not frozenset"

    def test_verify_declares_plan_and_execute_tools(self):
        """verify.py declares AGENT_TOOLS_PLAN and AGENT_TOOLS_EXECUTE."""
        import voidrift_cli.commands.verify as verify_mod
        assert isinstance(verify_mod.AGENT_TOOLS_PLAN, frozenset)
        assert isinstance(verify_mod.AGENT_TOOLS_EXECUTE, frozenset)

    def test_build_local_tools_resolves_via_dynamic_import(self, tmp_path):
        """build_local_tools('gather') returns only gather.AGENT_TOOLS tools."""
        import voidrift_cli.commands.gather as gather_mod
        tools, _ = build_local_tools("gather", project_dir=tmp_path)
        tool_names = {t["function"]["name"] for t in tools}
        # All returned tool names should be in gather.AGENT_TOOLS
        for name in tool_names:
            assert name in gather_mod.AGENT_TOOLS, f"Unexpected tool {name!r} for 'gather'"

    def test_no_command_tools_dict_in_tool_builder(self):
        """tool_builder module has no _COMMAND_TOOLS attribute after the OCP fix."""
        import voidrift_cli.tool_builder as tb_mod
        assert not hasattr(tb_mod, "_COMMAND_TOOLS"), "_COMMAND_TOOLS still exists in tool_builder"


class TestBuildToolGuidelines:
    def test_assembles_guidelines(self):
        tools = [
            {"function": {"name": "read_source_file"}, "_guidelines": ["Always check path first"]},
            {"function": {"name": "write_source_file"}, "_guidelines": ["Verify content", "Check size"]},
        ]
        result = build_tool_guidelines(tools)
        assert "## Tool Guidelines" in result
        assert "read_source_file: Always check path first" in result
        assert "write_source_file: Verify content" in result
        assert "write_source_file: Check size" in result

    def test_empty_when_no_guidelines(self):
        tools = [{"function": {"name": "read_source_file"}}]
        assert build_tool_guidelines(tools) == ""

    def test_skips_tools_without_guidelines(self):
        tools = [
            {"function": {"name": "read_source_file"}},
            {"function": {"name": "write_source_file"}, "_guidelines": ["Check size"]},
        ]
        result = build_tool_guidelines(tools)
        assert "read_source_file" not in result
        assert "write_source_file: Check size" in result


# All tool names that should exist in the system (22 unique tools)
EXPECTED_TOOL_NAMES = {
    # Filesystem + interaction
    "write_source_file", "edit_source_file", "write_framework_file",
    "read_source_file", "read_framework_file", "list_project_artifacts",
    "web_fetch", "ask_user_question",
    # Skills
    "get_skill", "list_skills",
    # Memory
    "read_memory", "write_memory", "list_memory",
    # Session
    "search_history",
    # Document
    "read_document",
    # Code analysis
    "code_analysis",
    # Bash
    "run_command",
    # Verify
    "read_process_output", "http_request",
    "browser_navigate", "browser_screenshot", "browser_click", "browser_get_text",
}


class TestRegistryCentralization:
    """V-TOOL-3: All tool schemas centralized in tools/registry.py."""

    def test_all_tools_contains_all_schemas(self):
        """ALL_TOOLS contains every tool schema in the system."""
        names = {t["function"]["name"] for t in ALL_TOOLS}
        assert names == EXPECTED_TOOL_NAMES

    def test_all_tools_count(self):
        """ALL_TOOLS has exactly 23 tool schemas."""
        assert len(ALL_TOOLS) == 23

    def test_all_tools_is_concatenation_of_groups(self):
        """ALL_TOOLS is the concatenation of all named groups."""
        expected = (
            FILESYSTEM_TOOLS + SKILL_TOOLS + MEMORY_TOOLS + SESSION_TOOLS
            + DOCUMENT_TOOLS + CODE_ANALYSIS_TOOLS + BASH_TOOL + VERIFY_TOOLS
        )
        assert ALL_TOOLS == expected

    def test_each_schema_has_valid_structure(self):
        """Every schema in ALL_TOOLS has type=function and a function dict with name and parameters."""
        for tool in ALL_TOOLS:
            assert tool["type"] == "function"
            fn = tool["function"]
            assert "name" in fn
            assert "parameters" in fn
            assert fn["parameters"]["type"] == "object"

    def test_tool_builder_has_zero_inline_schema_dicts(self):
        """tool_builder.py contains zero inline tool schema dicts with parameters.

        The bash tool constructs a dict with "type": "function" but derives its
        parameters from the registry base schema — that is not an inline schema.
        An inline schema is a dict literal that defines "parameters" directly.
        """
        src = Path(inspect.getfile(build_local_tools)).read_text()
        tree = ast.parse(src)
        # Look for dict literals that define a full tool schema inline:
        # a dict with key "name" AND key "parameters" inside a "function" dict.
        # The bash tool's dynamic construction uses **_bash_base["function"]
        # (a spread), so it won't have a literal "parameters" key.
        inline_count = 0
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            keys = [k.value for k in node.keys if isinstance(k, ast.Constant)]
            if "name" in keys and "parameters" in keys:
                inline_count += 1
        assert inline_count == 0, (
            f"tool_builder.py still contains {inline_count} inline tool schema dict(s) "
            f"with 'name' and 'parameters' keys"
        )

    def test_build_local_tools_unchanged_for_all_commands(self, tmp_path):
        """build_local_tools output tool names are unchanged for all commands."""
        expected_per_cmd = {
            "gather": {"read_source_file", "write_framework_file", "read_framework_file", "read_document", "code_analysis"},
            "plan": {"read_framework_file", "write_framework_file"},
            "develop": {"read_source_file", "write_source_file", "edit_source_file", "read_framework_file", "run_command"},
            "chat": {
                "read_source_file", "write_source_file", "edit_source_file",
                "read_framework_file", "write_framework_file", "list_project_artifacts",
                "web_fetch", "ask_user_question", "get_skill", "list_skills",
                "read_memory", "write_memory", "list_memory", "search_history",
                "read_document", "code_analysis", "run_command",
            },
        }
        for cmd, expected_names in expected_per_cmd.items():
            tools, handlers = build_local_tools(cmd, project_dir=tmp_path)
            actual_names = {t["function"]["name"] for t in tools}
            assert actual_names == expected_names, f"Mismatch for cmd={cmd!r}: {actual_names ^ expected_names}"

    def test_build_local_tools_verify_plan(self, tmp_path):
        """verify-plan returns the correct tool set."""
        tools, _ = build_local_tools("verify-plan", project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        assert names == {"read_source_file", "read_framework_file", "write_framework_file"}

    def test_build_local_tools_verify_execute(self, tmp_path):
        """verify-execute returns the correct tool set."""
        tools, _ = build_local_tools("verify-execute", project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        expected = {
            "read_framework_file", "write_framework_file",
            "read_process_output", "http_request", "run_command",
            "browser_navigate", "browser_screenshot", "browser_click", "browser_get_text",
        }
        assert names == expected

    def test_build_local_tools_no_cmd_returns_all(self, tmp_path):
        """build_local_tools(cmd=None) returns all tools."""
        tools, _ = build_local_tools(cmd=None, project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        # Should include everything except run_command (bash only built for specific commands)
        assert "read_source_file" in names
        assert "get_skill" in names
        assert "http_request" in names


class TestBuildHandlers:
    """build_handlers returns a handler dict independently testable from filtering."""

    def test_returns_dict_of_callables(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        assert isinstance(handlers, dict)
        for name, fn in handlers.items():
            assert callable(fn), f"Handler {name!r} is not callable"

    def test_contains_filesystem_handlers(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        for name in ("read_source_file", "write_source_file", "edit_source_file",
                      "read_framework_file", "write_framework_file", "list_project_artifacts"):
            assert name in handlers, f"Missing filesystem handler {name!r}"

    def test_contains_skill_handlers(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        assert "get_skill" in handlers
        assert "list_skills" in handlers

    def test_contains_memory_handlers(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        for name in ("read_memory", "write_memory", "list_memory"):
            assert name in handlers

    def test_contains_verify_handlers(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        for name in ("read_process_output", "http_request",
                      "browser_navigate", "browser_screenshot",
                      "browser_click", "browser_get_text"):
            assert name in handlers

    def test_bash_handler_present_for_develop(self, tmp_path):
        handlers = build_handlers(cmd="develop", project_dir=tmp_path)
        assert "run_command" in handlers

    def test_bash_handler_absent_for_plan(self, tmp_path):
        handlers = build_handlers(cmd="plan", project_dir=tmp_path)
        assert "run_command" not in handlers

    def test_bash_handler_absent_for_no_cmd(self, tmp_path):
        handlers = build_handlers(cmd=None, project_dir=tmp_path)
        assert "run_command" not in handlers

    def test_accepts_custom_ctx(self, tmp_path):
        from voidrift_cli.tools.filesystem import WriteContext
        ctx = WriteContext(project_dir=tmp_path)
        handlers = build_handlers(cmd=None, project_dir=tmp_path, ctx=ctx)
        # Handler should be bound to the provided ctx
        assert handlers["read_source_file"] == ctx.read_source_file


class TestFilterTools:
    """filter_tools filters schemas independently from handler creation."""

    def test_none_returns_all(self):
        schemas = [
            {"function": {"name": "a"}},
            {"function": {"name": "b"}},
        ]
        result = filter_tools(schemas, None)
        assert len(result) == 2

    def test_filters_to_allowed_set(self):
        schemas = [
            {"function": {"name": "a"}},
            {"function": {"name": "b"}},
            {"function": {"name": "c"}},
        ]
        result = filter_tools(schemas, {"a", "c"})
        names = {t["function"]["name"] for t in result}
        assert names == {"a", "c"}

    def test_empty_allowed_returns_empty(self):
        schemas = [{"function": {"name": "a"}}]
        result = filter_tools(schemas, set())
        assert result == []

    def test_does_not_mutate_input(self):
        schemas = [
            {"function": {"name": "a"}},
            {"function": {"name": "b"}},
        ]
        original_len = len(schemas)
        filter_tools(schemas, {"a"})
        assert len(schemas) == original_len

    def test_preserves_order(self):
        schemas = [
            {"function": {"name": "c"}},
            {"function": {"name": "a"}},
            {"function": {"name": "b"}},
        ]
        result = filter_tools(schemas, {"a", "b", "c"})
        names = [t["function"]["name"] for t in result]
        assert names == ["c", "a", "b"]


class TestBuildLocalToolsDecomposition:
    """build_local_tools is a thin orchestrator under 50 lines."""

    def test_under_50_lines(self):
        src = inspect.getsource(build_local_tools)
        line_count = len(src.strip().split("\n"))
        assert line_count <= 50, f"build_local_tools is {line_count} lines (max 50)"

    def test_output_matches_build_handlers_plus_filter(self, tmp_path):
        """build_local_tools output is consistent with build_handlers + filter_tools."""
        tools, handlers = build_local_tools("plan", project_dir=tmp_path)
        tool_names = {t["function"]["name"] for t in tools}
        # All returned tools should have handlers
        for name in tool_names:
            assert name in handlers, f"Tool {name!r} has no handler"


class TestSchemaHandlerContract:
    """V-TOOL-4: Schema-handler contract validation."""

    def test_all_current_tools_pass_validation(self, tmp_path):
        """All existing tools pass validation for every command."""
        for cmd in (None, "gather", "plan", "develop", "chat", "verify-plan", "verify-execute"):
            tools, handlers = build_local_tools(cmd, project_dir=tmp_path)
            # Should not raise
            validate_schema_handler_contract(tools, handlers)

    def test_catches_handler_missing_schema_parameter(self):
        """ValueError raised when handler is missing a schema-defined parameter."""
        tools = [{
            "type": "function",
            "function": {
                "name": "my_tool",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                },
            },
        }]
        # Handler only accepts 'path', missing 'content'
        def bad_handler(path: str) -> str:
            return path

        handlers = {"my_tool": bad_handler}
        try:
            validate_schema_handler_contract(tools, handlers)
            assert False, "Expected ValueError"
        except ValueError as exc:
            msg = str(exc)
            assert "my_tool" in msg
            assert "content" in msg
            assert "bad_handler" in msg

    def test_kwargs_handler_passes(self):
        """Handlers using **kwargs are not flagged."""
        tools = [{
            "type": "function",
            "function": {
                "name": "flex_tool",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "a": {"type": "string"},
                        "b": {"type": "string"},
                        "c": {"type": "string"},
                    },
                },
            },
        }]

        def flex_handler(**kwargs) -> str:
            return ""

        handlers = {"flex_tool": flex_handler}
        # Should not raise
        validate_schema_handler_contract(tools, handlers)

    def test_skips_tools_without_handler(self):
        """Tools with no matching handler are silently skipped."""
        tools = [{
            "type": "function",
            "function": {
                "name": "orphan_tool",
                "parameters": {"type": "object", "properties": {"x": {"type": "string"}}},
            },
        }]
        # No handler for orphan_tool
        validate_schema_handler_contract(tools, {})

    def test_error_message_identifies_tool_param_handler(self):
        """Error message contains tool name, missing parameter, and handler repr."""
        tools = [{
            "type": "function",
            "function": {
                "name": "write_thing",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "data": {"type": "string"},
                    },
                },
            },
        }]

        def my_writer(path: str) -> str:
            return ""

        handlers = {"write_thing": my_writer}
        try:
            validate_schema_handler_contract(tools, handlers)
            assert False, "Expected ValueError"
        except ValueError as exc:
            msg = str(exc)
            assert "write_thing" in msg
            assert "data" in msg
            assert "my_writer" in msg


class TestWebFetchBuildTime:
    """V-TOOL-5: web_fetch handler configured at build time, no placeholder."""

    def test_chat_build_handlers_with_kwargs_returns_real_handler(self, tmp_path):
        """Given web_fetch_kwargs, build_handlers returns the real web_fetch handler."""
        from voidrift_cli.models import ModelConfig
        mc = ModelConfig(
            alias="test", model_id="test", model_type="cloud",
            provider="openai", api_base="http://localhost:19999/v1", api_key="k",
        )
        kwargs = {"mc": mc, "log": "/dev/null", "web_cache": {}}
        handlers = build_handlers(cmd="chat", project_dir=tmp_path, web_fetch_kwargs=kwargs)
        handler = handlers["web_fetch"]
        # Real handler has set_confirm method
        assert hasattr(handler, "set_confirm"), "Real web_fetch handler should have set_confirm"

    def test_non_chat_build_handlers_returns_fallback(self, tmp_path):
        """Given no web_fetch_kwargs, build_handlers returns a fallback handler."""
        handlers = build_handlers(cmd="plan", project_dir=tmp_path, web_fetch_kwargs=None)
        result = handlers["web_fetch"]("http://example.com")
        assert "only available during" in result

    def test_build_local_tools_chat_with_kwargs_passes_validation(self, tmp_path):
        """build_local_tools with web_fetch_kwargs passes schema-handler validation."""
        from voidrift_cli.models import ModelConfig
        mc = ModelConfig(
            alias="test", model_id="test", model_type="cloud",
            provider="openai", api_base="http://localhost:19999/v1", api_key="k",
        )
        kwargs = {"mc": mc, "log": "/dev/null", "web_cache": {}}
        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path, web_fetch_kwargs=kwargs)
        # Should not raise
        validate_schema_handler_contract(tools, handlers)
        tool_names = {t["function"]["name"] for t in tools}
        assert "web_fetch" in tool_names

    def test_no_placeholder_in_interaction_module(self):
        """interaction.py has no web_fetch function."""
        import voidrift_cli.tools.interaction as interaction_mod
        assert not hasattr(interaction_mod, "web_fetch"), (
            "web_fetch placeholder still exists in interaction.py"
        )

    def test_set_confirm_swaps_confirm_function(self, tmp_path):
        """set_confirm on the handler replaces the confirm callback."""
        from voidrift_cli.models import ModelConfig
        mc = ModelConfig(
            alias="test", model_id="test", model_type="cloud",
            provider="openai", api_base="http://localhost:19999/v1", api_key="k",
        )
        kwargs = {"mc": mc, "log": "/dev/null", "web_cache": {}}
        handlers = build_handlers(cmd="chat", project_dir=tmp_path, web_fetch_kwargs=kwargs)
        handler = handlers["web_fetch"]
        # Swap confirm to always deny
        handler.set_confirm(lambda url: False)
        result = handler("http://example.com")
        assert "declined" in result.lower()

    def test_commands_without_web_fetch_unaffected(self, tmp_path):
        """Commands that don't include web_fetch in AGENT_TOOLS are unaffected."""
        for cmd in ("gather", "plan", "develop"):
            tools, _ = build_local_tools(cmd, project_dir=tmp_path)
            tool_names = {t["function"]["name"] for t in tools}
            if cmd == "gather":
                # gather doesn't have web_fetch
                assert "web_fetch" not in tool_names
            elif cmd == "plan":
                assert "web_fetch" not in tool_names
            elif cmd == "develop":
                assert "web_fetch" not in tool_names


class TestAskUserBuildTime:
    """V-TOOL-5a: ask_user_question handler configured at build time, no placeholder."""

    def test_chat_build_handlers_with_ask_fn_returns_configured_handler(self, tmp_path, monkeypatch):
        """Given ask_fn, build_handlers returns a handler that calls it."""
        monkeypatch.setattr("sys.stdin", type("FakeStdin", (), {"isatty": lambda self: True})())
        calls = []

        def my_ask(question, options):
            calls.append((question, options))
            return "operator answer"

        handlers = build_handlers(cmd="chat", project_dir=tmp_path, ask_fn=my_ask)
        result = handlers["ask_user_question"](question="Which DB?", options='["pg", "sqlite"]')
        assert result == "operator answer"
        assert len(calls) == 1
        assert calls[0][0] == "Which DB?"

    def test_non_chat_build_handlers_returns_fallback(self, tmp_path):
        """Given no ask_fn, handler returns non-interactive fallback."""
        handlers = build_handlers(cmd="plan", project_dir=tmp_path, ask_fn=None)
        result = handlers["ask_user_question"](question="Which DB?")
        assert "best judgment" in result.lower() or "no operator" in result.lower()

    def test_no_placeholder_in_interaction_module(self):
        """interaction.py has no ask_user_question function (only make_ask_user_handler)."""
        import voidrift_cli.tools.interaction as interaction_mod
        # make_ask_user_handler should exist
        assert hasattr(interaction_mod, "make_ask_user_handler")
        # The old placeholder function should not exist
        members = [name for name, _ in inspect.getmembers(interaction_mod, inspect.isfunction)]
        assert "ask_user_question" not in members

    def test_no_post_build_override_in_chat(self):
        """chat.py does not assign to agent.tool_handlers['ask_user_question']."""
        import voidrift_cli.commands.chat as chat_mod
        src = inspect.getsource(chat_mod)
        assert 'tool_handlers["ask_user_question"]' not in src
        assert "tool_handlers['ask_user_question']" not in src

    def test_set_ask_fn_swaps_callback(self, tmp_path, monkeypatch):
        """set_ask_fn on the handler replaces the ask callback."""
        monkeypatch.setattr("sys.stdin", type("FakeStdin", (), {"isatty": lambda self: True})())
        handlers = build_handlers(cmd="chat", project_dir=tmp_path, ask_fn=lambda q, o: "first")
        handler = handlers["ask_user_question"]
        assert hasattr(handler, "set_ask_fn")
        handler.set_ask_fn(lambda q, o: "second")
        result = handler(question="test?")
        assert result == "second"

    def test_non_interactive_fallback_when_no_tty(self, tmp_path, monkeypatch):
        """When stdin is not a TTY, handler returns fallback regardless of ask_fn."""
        monkeypatch.setattr("sys.stdin", type("FakeStdin", (), {"isatty": lambda self: False})())
        handlers = build_handlers(cmd="chat", project_dir=tmp_path, ask_fn=lambda q, o: "should not reach")
        result = handlers["ask_user_question"](question="test?")
        assert "no operator" in result.lower()

    def test_build_local_tools_chat_passes_validation(self, tmp_path):
        """build_local_tools with ask_fn passes schema-handler validation."""
        tools, handlers = build_local_tools(
            cmd="chat", project_dir=tmp_path,
            ask_fn=lambda q, o: "ok",
        )
        validate_schema_handler_contract(tools, handlers)
        tool_names = {t["function"]["name"] for t in tools}
        assert "ask_user_question" in tool_names

    def test_commands_without_ask_user_unaffected(self, tmp_path):
        """Commands that don't include ask_user_question in AGENT_TOOLS are unaffected."""
        for cmd in ("gather", "plan", "develop"):
            tools, _ = build_local_tools(cmd, project_dir=tmp_path)
            tool_names = {t["function"]["name"] for t in tools}
            assert "ask_user_question" not in tool_names
