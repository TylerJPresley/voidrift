"""Tests for session_store.py — pure unit tests (in-memory SQLite)."""

from voidrift_mcp.session_store import SessionStore


class TestSessionStore:
    def test_start_session(self):
        store = SessionStore()
        sid = store.start_session(run_id="gather-20260318-101048", phase="gather", project_dir="/tmp/test")
        assert sid == 1

    def test_multiple_sessions(self):
        store = SessionStore()
        s1 = store.start_session(run_id="run-1", phase="gather")
        s2 = store.start_session(run_id="run-2", phase="plan")
        assert s2 == s1 + 1

    def test_log_and_retrieve(self):
        store = SessionStore()
        sid = store.start_session(run_id="run-1")
        store.log_action(sid, "load", "framework", "/resources", "Loaded 50 sections")
        store.log_action(sid, "get", "skill", "backend")
        log = store.get_session_log(sid)
        assert len(log) == 2
        assert log[0]["action"] == "load"
        assert log[0]["detail"] == "Loaded 50 sections"
        assert log[1]["action"] == "get"
        assert log[1]["resource_key"] == "backend"

    def test_empty_session_log(self):
        store = SessionStore()
        sid = store.start_session(run_id="run-1")
        assert store.get_session_log(sid) == []

    def test_logs_isolated_per_session(self):
        store = SessionStore()
        s1 = store.start_session(run_id="run-1")
        s2 = store.start_session(run_id="run-2")
        store.log_action(s1, "action_a")
        store.log_action(s2, "action_b")
        assert len(store.get_session_log(s1)) == 1
        assert len(store.get_session_log(s2)) == 1
        assert store.get_session_log(s1)[0]["action"] == "action_a"

    def test_close(self):
        store = SessionStore()
        store.start_session(run_id="run-1")
        store.close()
        try:
            store.start_session(run_id="run-2")
            assert False, "Should have raised"
        except Exception:
            pass

    def test_persistent_db(self, tmp_path):
        db = tmp_path / "test.db"
        store = SessionStore(db)
        sid = store.start_session(run_id="run-1", phase="test")
        store.log_action(sid, "write", "file", "main.py")
        store.close()
        store2 = SessionStore(db)
        log = store2.get_session_log(sid)
        assert len(log) == 1
        assert log[0]["resource_key"] == "main.py"
        store2.close()

    def test_ephemeral_put_get(self):
        store = SessionStore()
        store.put("run-1", "analysis", "src/main.py", "Entry point module")
        assert store.get("run-1", "analysis", "src/main.py") == "Entry point module"
        assert store.get("run-1", "analysis", "missing.py") is None

    def test_ephemeral_get_all(self):
        store = SessionStore()
        store.put("run-1", "analysis", "a.py", "File A")
        store.put("run-1", "analysis", "b.py", "File B")
        store.put("run-2", "analysis", "c.py", "File C")
        result = store.get_all("run-1", "analysis")
        assert result == {"a.py": "File A", "b.py": "File B"}

    def test_ephemeral_isolated_by_run(self):
        store = SessionStore()
        store.put("run-1", "analysis", "x.py", "Run 1 version")
        store.put("run-2", "analysis", "x.py", "Run 2 version")
        assert store.get("run-1", "analysis", "x.py") == "Run 1 version"
        assert store.get("run-2", "analysis", "x.py") == "Run 2 version"

    def test_ephemeral_upsert(self):
        store = SessionStore()
        store.put("run-1", "analysis", "x.py", "v1")
        store.put("run-1", "analysis", "x.py", "v2")
        assert store.get("run-1", "analysis", "x.py") == "v2"
