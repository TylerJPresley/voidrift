"""Tests for session.py (REQ-U-13)."""

from voidrift_cli.session import ChatSession


class TestChatSession:
    def test_append_writes_jsonl(self, tmp_path):
        """Messages are appended as JSONL lines."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Hello")
        s.append_message("assistant", "Hi")
        lines = s.path.read_text().strip().splitlines()
        assert len(lines) == 2

    def test_load_restores_messages(self, tmp_path):
        """Loading a session reconstructs messages in order."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Hello")
        s.append_message("assistant", "Hi")
        s.append_message("user", "Question")

        s2 = ChatSession.load_or_create(tmp_path)
        msgs = s2.reconstruct_messages()
        assert len(msgs) == 3
        assert msgs[0]["role"] == "user"
        assert msgs[0]["content"] == "Hello"
        assert msgs[2]["content"] == "Question"

    def test_compaction_boundary(self, tmp_path):
        """Reconstruction stops at compaction entry."""
        s = ChatSession.load_or_create(tmp_path)
        for i in range(5):
            s.append_message("user", f"msg{i}")
            s.append_message("assistant", f"reply{i}")
        s.append_compaction("Summary of conversation")
        s.append_message("user", "After compact")
        s.append_message("assistant", "Post reply")

        s2 = ChatSession.load_or_create(tmp_path)
        msgs = s2.reconstruct_messages()
        assert len(msgs) == 3  # system(summary) + 2 messages
        assert msgs[0]["role"] == "system"
        assert "Summary" in msgs[0]["content"]
        assert msgs[1]["content"] == "After compact"

    def test_clear_deletes_file(self, tmp_path):
        """clear() removes the session file and resets state."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Hello")
        assert s.path.exists()
        s.clear()
        assert not s.path.exists()
        assert not s.has_messages
        assert s.message_count() == 0

    def test_sanitize_strips_empty(self, tmp_path):
        """Empty and whitespace-only messages are stripped on restore."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Hello")
        s.append_message("assistant", "")
        s.append_message("assistant", "   ")
        s.append_message("assistant", "Real reply")

        s2 = ChatSession.load_or_create(tmp_path)
        msgs = s2.reconstruct_messages()
        assert len(msgs) == 2
        assert msgs[1]["content"] == "Real reply"

    def test_no_session_file_returns_empty(self, tmp_path):
        """No session file means no messages."""
        s = ChatSession.load_or_create(tmp_path)
        assert not s.has_messages
        assert s.reconstruct_messages() == []

    def test_message_count_and_timestamp(self, tmp_path):
        """message_count and last_timestamp work correctly."""
        s = ChatSession.load_or_create(tmp_path)
        assert s.message_count() == 0
        assert s.last_timestamp() is None
        s.append_message("user", "Hello")
        assert s.message_count() == 1
        assert s.last_timestamp() is not None

    def test_malformed_jsonl_lines_skipped(self, tmp_path):
        """Malformed JSONL lines are skipped on load."""
        p = tmp_path / "chat-session.jsonl"
        p.write_text('{"id":"1","parentId":null,"type":"message","timestamp":"t","role":"user","content":"Hi"}\nBAD LINE\n')
        s = ChatSession.load_or_create(tmp_path)
        assert s.message_count() == 1


class TestSearchHistory:
    """Tests for search_entries (REQ-U-18)."""

    def test_substring_match_returns_entries(self, tmp_path):
        """Matching entries are returned with timestamp and role."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Set up the auth endpoint")
        s.append_message("assistant", "I'll create the auth module")
        s.append_message("user", "Now do the database")
        results = s.search_entries("auth")
        assert len(results) == 2
        assert all("timestamp" in r and "role" in r and "content" in r for r in results)

    def test_case_insensitive(self, tmp_path):
        """Search is case-insensitive."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Configure the DATABASE")
        results = s.search_entries("database")
        assert len(results) == 1

    def test_no_matches_returns_empty(self, tmp_path):
        """No matches returns empty list."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "Hello world")
        results = s.search_entries("nonexistent")
        assert results == []

    def test_no_session_returns_empty(self, tmp_path):
        """Empty session returns empty list."""
        s = ChatSession.load_or_create(tmp_path)
        results = s.search_entries("anything")
        assert results == []

    def test_content_truncated_at_2000(self, tmp_path):
        """Long content is truncated to 2000 chars with indicator."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "x" * 5000)
        results = s.search_entries("x")
        assert len(results) == 1
        assert len(results[0]["content"]) < 5000
        assert results[0]["content"].endswith("... [truncated]")

    def test_limit_respected(self, tmp_path):
        """Only limit entries are returned."""
        s = ChatSession.load_or_create(tmp_path)
        for i in range(7):
            s.append_message("user", f"message about topic {i}")
        results = s.search_entries("topic", limit=3)
        assert len(results) == 3

    def test_limit_capped_at_10(self, tmp_path):
        """Limit is capped at 10 even if higher value passed."""
        s = ChatSession.load_or_create(tmp_path)
        for i in range(15):
            s.append_message("user", f"entry {i}")
        results = s.search_entries("entry", limit=99)
        assert len(results) == 10

    def test_newest_first(self, tmp_path):
        """Results are returned newest first."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "first mention of auth")
        s.append_message("user", "second mention of auth")
        s.append_message("user", "third mention of auth")
        results = s.search_entries("auth")
        assert "third" in results[0]["content"]
        assert "first" in results[2]["content"]

    def test_searches_compacted_entries(self, tmp_path):
        """Entries before compaction boundary are still searchable."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("user", "early decision about auth")
        s.append_message("assistant", "noted the auth approach")
        s.append_compaction("Summary: discussed auth")
        s.append_message("user", "new topic")
        results = s.search_entries("auth approach")
        assert len(results) == 1
        assert results[0]["role"] == "assistant"

    def test_list_content_handled(self, tmp_path):
        """Content that is a list (tool calls) is searchable."""
        s = ChatSession.load_or_create(tmp_path)
        s.append_message("assistant", [{"text": "reading auth file"}])
        results = s.search_entries("auth file")
        assert len(results) == 1
