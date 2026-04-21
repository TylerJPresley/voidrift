"""Tests for git_checkpoint.py (REQ-D-20)."""

import json
import subprocess
from unittest.mock import patch

from voidrift_cli.git_checkpoint import GitCheckpointManager, Checkpoint


class TestGitCheckpointManager:
    def test_dirty_tree_creates_checkpoint(self):
        """Dirty working tree produces a checkpoint with stash ref."""
        def mock_run(cmd, **kw):
            class R:
                returncode = 0
                stdout = "abc123def456\n"
            return R()

        with patch("subprocess.run", mock_run):
            mgr = GitCheckpointManager("/tmp/proj")
            cp = mgr.create(turn=1, task_id="TASK-1")
        assert cp is not None
        assert cp.stash_ref == "abc123def456"
        assert cp.task_id == "TASK-1"
        assert cp.turn == 1

    def test_clean_tree_returns_none(self):
        """Clean working tree returns None (nothing to snapshot)."""
        def mock_run(cmd, **kw):
            class R:
                returncode = 0
                stdout = "\n"
            return R()

        with patch("subprocess.run", mock_run):
            mgr = GitCheckpointManager("/tmp/proj")
            assert mgr.create(turn=1) is None

    def test_git_unavailable_returns_none(self):
        """FileNotFoundError (no git) returns None."""
        with patch("subprocess.run", side_effect=FileNotFoundError):
            mgr = GitCheckpointManager("/tmp/proj")
            assert mgr.create(turn=1) is None

    def test_restore_calls_git_checkout(self):
        """restore() calls git checkout with the stash ref."""
        calls = []
        def mock_run(cmd, **kw):
            calls.append(cmd)
            class R:
                returncode = 0
            return R()

        cp = Checkpoint(stash_ref="abc123", task_id="TASK-1", turn=1)
        with patch("subprocess.run", mock_run):
            mgr = GitCheckpointManager("/tmp/proj")
            assert mgr.restore(cp) is True
        assert any("abc123" in str(c) for c in calls)

    def test_save_and_load_jsonl(self, tmp_path):
        """Checkpoints round-trip through JSONL."""
        mgr = GitCheckpointManager("/tmp/proj")
        mgr._checkpoints = [
            Checkpoint(stash_ref="ref1", task_id="TASK-1", turn=1, timestamp="2026-01-01T00:00:00"),
            Checkpoint(stash_ref="ref2", task_id="TASK-2", turn=2, timestamp="2026-01-01T00:01:00"),
        ]
        path = tmp_path / "checkpoints.jsonl"
        mgr.save(path)

        loaded = GitCheckpointManager.load_checkpoints(path)
        assert len(loaded) == 2
        assert loaded[0].stash_ref == "ref1"
        assert loaded[1].task_id == "TASK-2"

    def test_load_nonexistent_returns_empty(self, tmp_path):
        """Loading from nonexistent file returns empty list."""
        assert GitCheckpointManager.load_checkpoints(tmp_path / "nope.jsonl") == []

    def test_checkpoints_accumulate(self):
        """Multiple creates accumulate in the list."""
        def mock_run(cmd, **kw):
            class R:
                returncode = 0
                stdout = f"ref-{mock_run.n}\n"
            mock_run.n += 1
            return R()
        mock_run.n = 0

        with patch("subprocess.run", mock_run):
            mgr = GitCheckpointManager("/tmp/proj")
            mgr.create(turn=1, task_id="T-1")
            mgr.create(turn=2, task_id="T-2")
            mgr.create(turn=3, task_id="T-3")
        assert len(mgr.checkpoints) == 3
