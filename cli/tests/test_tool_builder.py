"""Tests for tool builder (build_tool_guidelines, build_local_tools, filter_tools)."""

import ast
import importlib
import inspect
from pathlib import Path

from voidrift_cli.tool_builder import (
    build_tool_guidelines,
    build_local_tools,
    filter_tools,
    validate_schema_handler_contract,
)
from voidrift_cli.tools.registry import DOMAIN_TOOLS


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
        for name in tool_names:
            assert name in gather_mod.AGENT_TOOLS, f"Unexpected tool {name!r} for 'gather'"

    def test_no_command_tools_dict_in_tool_builder(self):
        """tool_builder module has no _COMMAND_TOOLS attribute after the OCP fix."""
        import voidrift_cli.tool_builder as tb_mod
        assert not hasattr(tb_mod, "_COMMAND_TOOLS"), "_COMMAND_TOOLS still exists in tool_builder"


class TestBuildToolGuidelines:
    def test_assembles_guidelines(self):
        tools = [
            {"function": {"name": "file"}, "_guidelines": ["Always check path first"]},
            {"function": {"name": "shell"}, "_guidelines": ["Verify command", "Check output"]},
        ]
        result = build_tool_guidelines(tools)
        assert "## Tool Guidelines" in result
        assert "file: Always check path first" in result
        assert "shell: Verify command" in result
        assert "shell: Check output" in result

    def test_empty_when_no_guidelines(self):
        tools = [{"function": {"name": "file"}}]
        assert build_tool_guidelines(tools) == ""

    def test_skips_tools_without_guidelines(self):
        tools = [
            {"function": {"name": "file"}},
            {"function": {"name": "shell"}, "_guidelines": ["Check output"]},
        ]
        result = build_tool_guidelines(tools)
        assert "file" not in result
        assert "shell: Check output" in result


class TestDomainToolsRegistry:
    """DOMAIN_TOOLS contains all 10 domain tool schemas."""

    def test_domain_tools_count(self):
        assert len(DOMAIN_TOOLS) == 10

    def test_domain_tools_names(self):
        names = {t["function"]["name"] for t in DOMAIN_TOOLS}
        assert names == {"file", "http", "shell", "browser", "process",
                         "skill", "memory", "session", "analyze", "ask"}

    def test_each_schema_has_valid_structure(self):
        for tool in DOMAIN_TOOLS:
            assert tool["type"] == "function"
            fn = tool["function"]
            assert "name" in fn
            assert "parameters" in fn
            assert fn["parameters"]["type"] == "object"

    def test_tool_builder_has_zero_inline_schema_dicts(self):
        """tool_builder.py contains zero inline tool schema dicts with parameters."""
        src = Path(inspect.getfile(build_local_tools)).read_text()
        tree = ast.parse(src)
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
        """build_local_tools output tool names match AGENT_TOOLS for all commands."""
        expected_per_cmd = {
            "gather": {"file", "analyze"},
            "plan": {"file"},
            "develop": {"file", "shell"},
            "chat": {"file", "http", "shell", "skill", "memory", "session", "analyze", "ask"},
        }
        for cmd, expected_names in expected_per_cmd.items():
            tools, handlers = build_local_tools(cmd, project_dir=tmp_path)
            actual_names = {t["function"]["name"] for t in tools}
            assert actual_names == expected_names, f"Mismatch for cmd={cmd!r}: {actual_names ^ expected_names}"

    def test_build_local_tools_verify_plan(self, tmp_path):
        tools, _ = build_local_tools("verify-plan", project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        assert names == {"file"}

    def test_build_local_tools_verify_execute(self, tmp_path):
        tools, _ = build_local_tools("verify-execute", project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        assert names == {"file", "http", "shell", "browser", "process"}

    def test_build_local_tools_no_cmd_returns_all(self, tmp_path):
        tools, _ = build_local_tools(cmd=None, project_dir=tmp_path)
        names = {t["function"]["name"] for t in tools}
        assert "file" in names
        assert "skill" in names
        assert "http" in names


class TestDomainHandlers:
    """Domain handlers return a handler dict with domain tool names."""

    def test_returns_dict_of_callables(self, tmp_path):
        _, handlers = build_local_tools(cmd=None, project_dir=tmp_path)
        assert isinstance(handlers, dict)
        for name, fn in handlers.items():
            assert callable(fn), f"Handler {name!r} is not callable"

    def test_contains_file_handler(self, tmp_path):
        _, handlers = build_local_tools(cmd=None, project_dir=tmp_path)
        assert "file" in handlers

    def test_contains_skill_handlers(self, tmp_path):
        _, handlers = build_local_tools(cmd="chat", project_dir=tmp_path)
        assert "skill" in handlers

    def test_contains_memory_handler(self, tmp_path):
        _, handlers = build_local_tools(cmd="chat", project_dir=tmp_path)
        assert "memory" in handlers

    def test_shell_handler_present_for_develop(self, tmp_path):
        _, handlers = build_local_tools(cmd="develop", project_dir=tmp_path)
        assert "shell" in handlers

    def test_shell_handler_absent_for_plan(self, tmp_path):
        _, handlers = build_local_tools(cmd="plan", project_dir=tmp_path)
        # shell is not in the tool list for plan, but handler exists as fallback
        tools, _ = build_local_tools(cmd="plan", project_dir=tmp_path)
        tool_names = {t["function"]["name"] for t in tools}
        assert "shell" not in tool_names


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

    def test_output_matches_handlers_plus_filter(self, tmp_path):
        """build_local_tools output is consistent — all tools have handlers."""
        tools, handlers = build_local_tools("plan", project_dir=tmp_path)
        tool_names = {t["function"]["name"] for t in tools}
        for name in tool_names:
            assert name in handlers, f"Tool {name!r} has no handler"


class TestSchemaHandlerContract:
    """V-TOOL-4: Schema-handler contract validation."""

    def test_all_current_tools_pass_validation(self, tmp_path):
        for cmd in (None, "gather", "plan", "develop", "chat", "verify-plan", "verify-execute"):
            tools, handlers = build_local_tools(cmd, project_dir=tmp_path)
            validate_schema_handler_contract(tools, handlers)

    def test_catches_handler_missing_schema_parameter(self):
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
        validate_schema_handler_contract(tools, handlers)

    def test_skips_tools_without_handler(self):
        tools = [{
            "type": "function",
            "function": {
                "name": "orphan_tool",
                "parameters": {"type": "object", "properties": {"x": {"type": "string"}}},
            },
        }]
        validate_schema_handler_contract(tools, {})

    def test_error_message_identifies_tool_param_handler(self):
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
    """V-TOOL-5: http handler configured at build time via build_local_tools."""

    def test_chat_with_kwargs_returns_real_handler(self, tmp_path):
        from voidrift_cli.models import ModelConfig
        mc = ModelConfig(
            alias="test", model_id="test", model_type="cloud",
            provider="openai", api_base="http://localhost:19999/v1", api_key="k",
        )
        kwargs = {"mc": mc, "log": "/dev/null", "web_cache": {}}
        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path, web_fetch_kwargs=kwargs)
        handler = handlers["http"]
        assert callable(handler)

    def test_chat_with_kwargs_passes_validation(self, tmp_path):
        from voidrift_cli.models import ModelConfig
        mc = ModelConfig(
            alias="test", model_id="test", model_type="cloud",
            provider="openai", api_base="http://localhost:19999/v1", api_key="k",
        )
        kwargs = {"mc": mc, "log": "/dev/null", "web_cache": {}}
        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path, web_fetch_kwargs=kwargs)
        validate_schema_handler_contract(tools, handlers)
        tool_names = {t["function"]["name"] for t in tools}
        assert "http" in tool_names

    def test_no_placeholder_in_interaction_module(self):
        import voidrift_cli.tools.interaction as interaction_mod
        assert not hasattr(interaction_mod, "web_fetch")

    def test_commands_without_http_unaffected(self, tmp_path):
        for cmd in ("gather", "plan", "develop"):
            tools, _ = build_local_tools(cmd, project_dir=tmp_path)
            tool_names = {t["function"]["name"] for t in tools}
            assert "http" not in tool_names


class TestAskUserBuildTime:
    """V-TOOL-5a: ask handler configured at build time via build_local_tools."""

    def test_chat_with_ask_fn_returns_configured_handler(self, tmp_path, monkeypatch):
        monkeypatch.setattr("sys.stdin", type("FakeStdin", (), {"isatty": lambda self: True})())
        calls = []

        def my_ask(question, options):
            calls.append((question, options))
            return "operator answer"

        tools, handlers = build_local_tools(cmd="chat", project_dir=tmp_path, ask_fn=my_ask)
        result = handlers["ask"](question="Which DB?", options='["pg", "sqlite"]')
        assert result == "operator answer"
        assert len(calls) == 1
        assert calls[0][0] == "Which DB?"

    def test_no_placeholder_in_interaction_module(self):
        import voidrift_cli.tools.interaction as interaction_mod
        assert hasattr(interaction_mod, "make_ask_user_handler")
        members = [name for name, _ in inspect.getmembers(interaction_mod, inspect.isfunction)]
        assert "ask_user_question" not in members

    def test_no_post_build_override_in_chat(self):
        import voidrift_cli.commands.chat as chat_mod
        src = inspect.getsource(chat_mod)
        assert 'tool_handlers["ask_user_question"]' not in src
        assert "tool_handlers['ask_user_question']" not in src

    def test_build_local_tools_chat_passes_validation(self, tmp_path):
        tools, handlers = build_local_tools(
            cmd="chat", project_dir=tmp_path,
            ask_fn=lambda q, o: "ok",
        )
        validate_schema_handler_contract(tools, handlers)
        tool_names = {t["function"]["name"] for t in tools}
        assert "ask" in tool_names

    def test_commands_without_ask_unaffected(self, tmp_path):
        for cmd in ("gather", "plan", "develop"):
            tools, _ = build_local_tools(cmd, project_dir=tmp_path)
            tool_names = {t["function"]["name"] for t in tools}
            assert "ask" not in tool_names
