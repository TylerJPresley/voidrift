"""Tests for agent_context module — snipping, trimming, compaction."""

from voidrift_cli.agent_context import snip_old_tool_results, trim_messages


class TestTrimMessages:
    def test_trim_removes_oldest_tool_call_block(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "read_source_file"}}]},
            {"role": "tool", "tool_call_id": "1", "content": "file content"},
            {"role": "assistant", "content": "done"},
        ]
        new_msgs, did_trim = trim_messages(msgs)
        assert did_trim is True
        assert len(new_msgs) == 3  # system + user + final assistant

    def test_trim_returns_false_when_nothing_to_trim(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
        ]
        new_msgs, did_trim = trim_messages(msgs)
        assert did_trim is False
        assert new_msgs == msgs


class TestSnipOldToolResults:
    def _make_messages(self):
        return [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "read the file"},
            {"role": "assistant", "tool_calls": [
                {"id": "tc1", "function": {"name": "read_source_file", "arguments": '{"path":"src/a.py"}'}}
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": "x" * 600},
            {"role": "assistant", "tool_calls": [
                {"id": "tc2", "function": {"name": "write_source_file", "arguments": '{"path":"src/b.py"}'}}
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": "wrote file"},
            {"role": "assistant", "tool_calls": [
                {"id": "tc3", "function": {"name": "read_source_file", "arguments": '{"path":"src/c.py"}'}}
            ]},
            {"role": "tool", "tool_call_id": "tc3", "content": "y" * 600},
            {"role": "assistant", "content": "Done."},
        ]

    def test_old_read_snipped(self):
        msgs = self._make_messages()
        result = snip_old_tool_results(msgs, max_age_turns=2)
        tc1_result = [m for m in result if m.get("tool_call_id") == "tc1"][0]
        assert "snipped" in tc1_result["content"]

    def test_recent_read_preserved(self):
        msgs = self._make_messages()
        result = snip_old_tool_results(msgs, max_age_turns=2)
        tc3_result = [m for m in result if m.get("tool_call_id") == "tc3"][0]
        assert "snipped" not in tc3_result["content"]

    def test_write_never_snipped(self):
        msgs = self._make_messages()
        result = snip_old_tool_results(msgs, max_age_turns=0)
        tc2_result = [m for m in result if m.get("tool_call_id") == "tc2"][0]
        assert tc2_result["content"] == "wrote file"

    def test_original_not_modified(self):
        msgs = self._make_messages()
        original_tc1 = [m for m in msgs if m.get("tool_call_id") == "tc1"][0]["content"]
        snip_old_tool_results(msgs, max_age_turns=2)
        after_tc1 = [m for m in msgs if m.get("tool_call_id") == "tc1"][0]["content"]
        assert after_tc1 == original_tc1

    def test_disabled_when_zero(self):
        msgs = self._make_messages()
        result = snip_old_tool_results(msgs, max_age_turns=0)
        assert result is msgs
