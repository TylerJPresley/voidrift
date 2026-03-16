"""Tests for session_store.py — pure unit tests (in-memory SQLite)."""

from voidrift_mcp.session_store import SessionStore


class TestSessionStore:
    def test_start_session(self):
        store = SessionStore()
        sid = store.start_session(phase="gather", project_dir="/tmp/test")
        assert sid == 1

    def test_multiple_sessions(self):
        store = SessionStore()
        s1 = store.start_session(phase="gather")
        s2 = store.start_session(phase="plan")
        assert s2 == s1 + 1

    def test_log_and_retrieve(self):
        store = SessionStore()
        sid = store.start_session()
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
        sid = store.start_session()
        assert store.get_session_log(sid) == []

    def test_logs_isolated_per_session(self):
        store = SessionStore()
        s1 = store.start_session()
        s2 = store.start_session()
        store.log_action(s1, "action_a")
        store.log_action(s2, "action_b")
        assert len(store.get_session_log(s1)) == 1
        assert len(store.get_session_log(s2)) == 1
        assert store.get_session_log(s1)[0]["action"] == "action_a"

    def test_close(self):
        store = SessionStore()
        store.start_session()
        store.close()
        # After close, operations should fail
        try:
            store.start_session()
            assert False, "Should have raised"
        except Exception:
            pass

    def test_persistent_db(self, tmp_path):
        db = tmp_path / "test.db"
        store = SessionStore(db)
        sid = store.start_session(phase="test")
        store.log_action(sid, "write", "file", "main.py")
        store.close()
        # Reopen and verify data persisted
        store2 = SessionStore(db)
        log = store2.get_session_log(sid)
        assert len(log) == 1
        assert log[0]["resource_key"] == "main.py"
        store2.close()
