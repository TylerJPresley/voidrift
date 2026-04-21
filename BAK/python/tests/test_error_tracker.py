"""Tests for error_tracker.py (REQ-LOG-6)."""

import json

from voidrift_cli.error_tracker import ErrorTracker


class TestErrorTracker:
    def test_summary_by_category(self):
        et = ErrorTracker()
        et.record("context", "ContextLengthError", "too long", task="TASK-1")
        et.record("context", "ContextLengthError", "too long", task="TASK-2")
        et.record("context", "ContextLengthError", "too long", task="TASK-3")
        et.record("api", "HTTP429", "rate limited")
        assert et.summary_by_category() == {"context": 3, "api": 1}

    def test_has_errors(self):
        et = ErrorTracker()
        assert not et.has_errors()
        et.record("api", "HTTP500", "server error")
        assert et.has_errors()

    def test_to_state_dict_structure(self):
        et = ErrorTracker()
        et.record("context", "CtxErr", "msg1", task="T-1")
        et.record("context", "CtxErr", "msg2", task="T-2")
        et.record("api", "HTTP429", "rate limit")
        result = et.to_state_dict()
        assert len(result) == 2
        ctx_entry = [r for r in result if r["category"] == "context"][0]
        assert ctx_entry["count"] == 2
        assert len(ctx_entry["examples"]) == 2

    def test_to_state_dict_caps_examples_at_3(self):
        et = ErrorTracker()
        for i in range(10):
            et.record("api", "HTTP500", f"error {i}")
        result = et.to_state_dict()
        assert result[0]["count"] == 10
        assert len(result[0]["examples"]) == 3

    def test_render_summary_table(self):
        et = ErrorTracker()
        et.record("context", "CtxErr", "too long")
        et.record("api", "HTTP429", "rate limited", recoverable=False)
        table = et.render_summary_table()
        assert table.row_count == 2

    def test_no_errors_empty_table(self):
        et = ErrorTracker()
        table = et.render_summary_table()
        assert table.row_count == 0

    def test_write_jsonl(self, tmp_path):
        et = ErrorTracker()
        et.record("context", "CtxErr", "too long", task="T-1")
        et.record("api", "HTTP429", "rate limited")
        log = tmp_path / "develop-20260405.log"
        log.write_text("")
        et.write_jsonl(log)
        jsonl = tmp_path / "develop-20260405.errors.jsonl"
        assert jsonl.exists()
        lines = jsonl.read_text().strip().splitlines()
        assert len(lines) == 2
        for line in lines:
            obj = json.loads(line)
            assert "category" in obj
            assert "timestamp" in obj

    def test_recoverable_flag(self):
        et = ErrorTracker()
        et.record("tool", "OSError", "file not found", recoverable=True)
        et.record("budget", "BudgetExhausted", "limit hit", recoverable=False)
        state = et.to_state_dict()
        tool_entry = [s for s in state if s["category"] == "tool"][0]
        assert tool_entry["examples"][0]["recoverable"] is True
        budget_entry = [s for s in state if s["category"] == "budget"][0]
        assert budget_entry["examples"][0]["recoverable"] is False
