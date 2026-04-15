"""Tests for FauxProvider record/replay (REQ-TEST-1)."""

import json
from pathlib import Path
from unittest.mock import MagicMock

from voidrift_cli.testing.faux_provider import (
    CassetteNotFoundError,
    FauxProvider,
    _hash_request,
)


class TestFauxProvider:
    """FauxProvider replay, record, and hashing tests."""

    def test_replay_returns_recorded_response(self, tmp_path):
        """Replay mode returns the exact recorded response."""
        cassette = tmp_path / "test.jsonl"
        req = {"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]}
        resp = {"choices": [{"message": {"content": "hello"}}]}
        entry = {
            "request_hash": _hash_request(req),
            "request": req,
            "response": resp,
            "recorded_at": "2026-01-01T00:00:00Z",
        }
        cassette.write_text(json.dumps(entry) + "\n")

        fp = FauxProvider(cassette, mode="replay")
        result = fp.chat.completions.create(**req)
        assert result == resp

    def test_replay_missing_cassette_raises(self, tmp_path):
        """Missing fixture in replay mode raises CassetteNotFoundError."""
        cassette = tmp_path / "empty.jsonl"
        cassette.write_text("")
        fp = FauxProvider(cassette, mode="replay")
        try:
            fp.chat.completions.create(model="x", messages=[])
            assert False, "Should have raised"
        except CassetteNotFoundError as e:
            assert "VCR_MODE=record" in str(e)
            assert str(cassette) in str(e)

    def test_api_key_excluded_from_hash(self):
        """Two requests identical except for api_key produce the same hash."""
        req1 = {"model": "gpt-4", "messages": [], "api_key": "key-1"}
        req2 = {"model": "gpt-4", "messages": [], "api_key": "key-2"}
        assert _hash_request(req1) == _hash_request(req2)

    def test_record_saves_to_cassette(self, tmp_path):
        """Record mode saves the response and returns it."""
        cassette = tmp_path / "rec.jsonl"
        mock_client = MagicMock()
        mock_resp = {"choices": [{"message": {"content": "recorded"}}]}
        mock_client.chat.completions.create.return_value = mock_resp

        fp = FauxProvider(cassette, mode="record", real_client=mock_client)
        result = fp.chat.completions.create(model="gpt-4", messages=[])
        assert result == mock_resp
        assert cassette.exists()

        # Verify cassette is valid JSONL
        lines = [l for l in cassette.read_text().strip().split("\n") if l]
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert "request_hash" in entry
        assert "request" in entry
        assert "response" in entry
        assert "recorded_at" in entry

    def test_cassette_valid_jsonl(self, tmp_path):
        """Cassette file is valid JSONL — each line parses independently."""
        cassette = tmp_path / "multi.jsonl"
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = {"ok": True}

        fp = FauxProvider(cassette, mode="record", real_client=mock_client)
        fp.chat.completions.create(model="a", messages=[{"role": "user", "content": "1"}])
        fp.chat.completions.create(model="b", messages=[{"role": "user", "content": "2"}])

        lines = [l for l in cassette.read_text().strip().split("\n") if l]
        assert len(lines) == 2
        for line in lines:
            parsed = json.loads(line)
            assert set(parsed.keys()) == {"request_hash", "request", "response", "recorded_at"}

    def test_passthrough_forwards_to_real_client(self, tmp_path):
        """Passthrough mode forwards to real client without recording."""
        cassette = tmp_path / "pass.jsonl"
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = {"passthrough": True}

        fp = FauxProvider(cassette, mode="passthrough", real_client=mock_client)
        result = fp.chat.completions.create(model="x", messages=[])
        assert result == {"passthrough": True}
        mock_client.chat.completions.create.assert_called_once()
        # No cassette written
        assert not cassette.exists()
