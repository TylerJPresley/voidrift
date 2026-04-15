"""Tests for DevelopDashboard (REQ-UI-11)."""

from voidrift_cli.ui import DevelopDashboard


class TestDevelopDashboard:
    def test_three_rows_rendered(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1 API")
        dash.add_task("T-2", "TASK-2 Models")
        dash.add_task("T-3", "TASK-3 Tests")
        table = dash._render()
        assert table.row_count == 3

    def test_tracker_updates_state(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        cb = dash.tracker("T-1")
        cb({"prompt_tokens": 5000, "completion_tokens": 1200, "ctx_pct": 42, "turn": 3, "last_tool": "write_source_file"})
        with dash._lock:
            r = dash._rows["T-1"]
        assert r["status"] == "running"
        assert r["turn"] == 3
        assert r["last_tool"] == "write_source_file"
        assert r["pt"] == 5000

    def test_mark_done_failed(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        dash.mark_done("T-1", failed=True)
        with dash._lock:
            assert dash._rows["T-1"]["status"] == "failed"

    def test_mark_done_success(self):
        dash = DevelopDashboard()
        dash.add_task("T-1", "TASK-1")
        dash.mark_done("T-1")
        with dash._lock:
            assert dash._rows["T-1"]["status"] == "done"
