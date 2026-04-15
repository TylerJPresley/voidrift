"""Tests for git_context.py (REQ-D-18) and git_utils.py (REQ-GIT-4)."""

from unittest.mock import patch
import subprocess

from voidrift_cli.git_context import capture_git_snapshot, GitSnapshot
from voidrift_cli.git_utils import get_bounded_diff


class TestGitSnapshot:
    def test_capture_in_git_repo(self, tmp_path):
        """capture_git_snapshot returns snapshot with branch and commits."""
        def mock_run(cmd, **kw):
            class R:
                returncode = 0
            r = R()
            if "rev-parse" in cmd:
                r.stdout = "main\n"
            elif "log" in cmd:
                r.stdout = "abc1234 First commit\ndef5678 Second commit\n"
            elif "status" in cmd:
                r.stdout = " M src/api.py\n"
            else:
                r.stdout = ""
            return r

        with patch("subprocess.run", mock_run):
            snap = capture_git_snapshot(str(tmp_path))
        assert snap is not None
        assert snap.branch == "main"
        assert len(snap.recent_commits) == 2
        assert len(snap.changed_files) == 1

    def test_non_git_returns_none(self, tmp_path):
        """Non-git directory returns None."""
        def mock_run(cmd, **kw):
            class R:
                returncode = 128
                stdout = ""
            return R()

        with patch("subprocess.run", mock_run):
            assert capture_git_snapshot(str(tmp_path)) is None

    def test_git_unavailable_returns_none(self):
        """FileNotFoundError (git not installed) returns None."""
        with patch("subprocess.run", side_effect=FileNotFoundError):
            assert capture_git_snapshot(".") is None

    def test_timeout_returns_none(self):
        """Subprocess timeout returns None."""
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 5)):
            assert capture_git_snapshot(".") is None

    def test_prompt_block_format(self):
        snap = GitSnapshot(branch="feature/auth", recent_commits=["abc Fix bug"], changed_files=[" M api.py"])
        block = snap.to_prompt_block()
        assert "## Git Context" in block
        assert "Branch: feature/auth" in block
        assert "abc Fix bug" in block
        assert "M api.py" in block

    def test_changed_files_capped_at_20(self):
        snap = GitSnapshot(branch="main", changed_files=[f" M file{i}.py" for i in range(25)])
        block = snap.to_prompt_block()
        assert "... and 5 more" in block
        assert "file24.py" not in block

    def test_clean_working_tree(self):
        snap = GitSnapshot(branch="main", changed_files=[])
        assert "Working tree: clean" in snap.to_prompt_block()


class TestBoundedDiff:
    def _mock_run(self, name_only_out, diff_out=""):
        def mock(cmd, **kw):
            class R:
                returncode = 0
            r = R()
            if "--name-only" in cmd:
                r.stdout = name_only_out
            else:
                r.stdout = diff_out
            return r
        return mock

    def test_total_lines_truncated(self):
        diff = "diff --git a/f.py b/f.py\n" + "".join(f"+line{i}\n" for i in range(3000))
        with patch("subprocess.run", self._mock_run("f.py\n", diff)):
            result = get_bounded_diff(".", max_lines=2000, max_file_lines=5000)
        assert result.truncated
        assert "total lines" in result.diff_text

    def test_file_limit(self):
        names = "\n".join(f"src/f{i}.py" for i in range(60))
        diff = "\n".join(f"diff --git a/src/f{i}.py b/src/f{i}.py\n+x" for i in range(50))
        with patch("subprocess.run", self._mock_run(names, diff)):
            result = get_bounded_diff(".", max_files=50)
        assert result.truncated
        assert "showing 50/60" in result.diff_text

    def test_binary_excluded(self):
        with patch("subprocess.run", self._mock_run("src/main.py\nassets/logo.png\n", "diff --git a/src/main.py b/src/main.py\n+x\n")):
            result = get_bounded_diff(".")
        assert "assets/logo.png" in result.binary_files
        assert "BINARY FILES SKIPPED" in result.diff_text

    def test_per_file_limit(self):
        diff = "diff --git a/big.py b/big.py\n" + "".join(f"+line{i}\n" for i in range(500))
        with patch("subprocess.run", self._mock_run("big.py\n", diff)):
            result = get_bounded_diff(".", max_file_lines=400)
        assert result.truncated
        assert "file diff exceeds 400" in result.diff_text

    def test_within_bounds_not_truncated(self):
        diff = "diff --git a/a.py b/a.py\n+x\n"
        with patch("subprocess.run", self._mock_run("a.py\n", diff)):
            result = get_bounded_diff(".")
        assert not result.truncated
        assert result.total_files == 1
