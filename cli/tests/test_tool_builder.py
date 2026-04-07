"""Tests for tool builder (build_tool_guidelines, build_local_tools)."""

import importlib
from pathlib import Path

from voidrift_cli.tool_builder import build_tool_guidelines, build_local_tools


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
