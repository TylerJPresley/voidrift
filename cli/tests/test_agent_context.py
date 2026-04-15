"""Tests for agent_context module — snipping, trimming, compaction."""

from voidrift_cli.agent_context import reactive_compact, snip_old_tool_results, trim_messages


class TestTrimMessages:
    def test_trim_removes_oldest_tool_call_block(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "file", "arguments": '{"action":"read"}'}}]},
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
                {"id": "tc1", "function": {"name": "file", "arguments": '{"action":"read","path":"src/a.py"}'}}
            ]},
            {"role": "tool", "tool_call_id": "tc1", "content": "x" * 600},
            {"role": "assistant", "tool_calls": [
                {"id": "tc2", "function": {"name": "file", "arguments": '{"action":"write","path":"src/b.py"}'}}
            ]},
            {"role": "tool", "tool_call_id": "tc2", "content": "wrote file"},
            {"role": "assistant", "tool_calls": [
                {"id": "tc3", "function": {"name": "file", "arguments": '{"action":"read","path":"src/c.py"}'}}
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


class TestReactiveCompact:
    def _make_messages(self, n_pairs: int = 4) -> list[dict]:
        """Build a message list with n_pairs of (user, assistant) exchanges."""
        msgs = [{"role": "system", "content": "sys"}]
        for i in range(n_pairs):
            msgs.append({"role": "user", "content": f"message {i}"})
            msgs.append({"role": "assistant", "content": f"reply {i}"})
        return msgs

    def test_compacts_old_messages(self):
        msgs = self._make_messages(4)
        summary_calls = []

        def compact_fn(content: str) -> str:
            summary_calls.append(content)
            return "summary of old messages"

        new_msgs, new_count, did_compact = reactive_compact(msgs, compact_fn, 0)

        assert did_compact is True
        assert new_count == 1
        assert len(summary_calls) == 1
        # Summary message should be present
        assert any("summary of old messages" in m.get("content", "") for m in new_msgs)
        # System messages preserved
        assert any(m["role"] == "system" for m in new_msgs)

    def test_keeps_recent_messages(self):
        msgs = self._make_messages(4)

        def compact_fn(content: str) -> str:
            return "compact"

        new_msgs, _, did_compact = reactive_compact(msgs, compact_fn, 0)

        assert did_compact is True
        # Last 4 non-system messages must be kept
        non_sys = [m for m in new_msgs if m["role"] != "system"]
        # Summary + last 4 messages
        assert len(non_sys) >= 4

    def test_no_compact_when_count_exhausted(self):
        from voidrift_cli.agent_context import _REACTIVE_COMPACT_MAX
        msgs = self._make_messages(4)
        _, _, did_compact = reactive_compact(msgs, lambda c: "x", _REACTIVE_COMPACT_MAX)
        assert did_compact is False

    def test_no_compact_when_too_few_messages(self):
        msgs = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        _, _, did_compact = reactive_compact(msgs, lambda c: "x", 0)
        assert did_compact is False

    def test_compact_fn_exception_skips_compaction(self):
        msgs = self._make_messages(4)

        def failing_fn(content: str) -> str:
            raise RuntimeError("API down")

        new_msgs, new_count, did_compact = reactive_compact(msgs, failing_fn, 0)

        assert did_compact is False
        assert new_count == 0
        assert new_msgs is msgs  # unchanged
