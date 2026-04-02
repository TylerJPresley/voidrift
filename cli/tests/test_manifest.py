"""Tests for ManifestManager — REQ-TM-1 through REQ-TM-7."""

from pathlib import Path

import pytest
import yaml

from voidrift_cli.manifest import ManifestManager


@pytest.fixture
def mm(tmp_path):
    """ManifestManager with a temp project dir."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".voidrift").mkdir()
    m = ManifestManager(project_dir=project)
    m.ensure_dirs()
    return m


class TestManifestLifecycle:
    """REQ-TM-1: ManifestManager reads/writes manifest.yml."""

    def test_empty_manifest(self, mm):
        mm.load()
        assert mm.tasks() == {}
        assert mm.modules() == {}

    def test_add_task_persists(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.load()  # re-read from disk
        assert mm.get_status(1) == "planned"

    def test_next_id_increments(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend")
        assert mm.next_id == 3

    def test_module_grouping(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "frontend")
        assert 1 in mm.modules()["backend"]
        assert 2 in mm.modules()["frontend"]


class TestStatusTransitions:
    """REQ-TM-2: Task lifecycle states."""

    def test_planned_to_in_progress(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.set_status(1, "in-progress")
        assert mm.get_status(1) == "in-progress"

    def test_in_progress_to_implemented(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.set_status(1, "implemented")
        assert mm.get_status(1) == "implemented"

    def test_implemented_to_verified(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.set_status(1, "verified")
        assert mm.get_status(1) == "verified"

    def test_implemented_to_failed(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.set_status(1, "failed")
        assert mm.get_status(1) == "failed"


class TestDependencyResolution:
    """REQ-TM-3: Dispatch, blocking, unblocking."""

    def test_dispatchable_no_deps(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        assert 1 in mm.dispatchable()

    def test_dispatchable_deps_met(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend", depends=[1])
        mm.set_status(1, "implemented")
        assert 2 in mm.dispatchable()

    def test_not_dispatchable_deps_unmet(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend", depends=[1])
        assert 2 not in mm.dispatchable()

    def test_failed_blocks_dependents(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend", depends=[1])
        mm.set_status(1, "failed")
        assert mm.get_status(2) == "blocked"

    def test_transitive_blocking(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend", depends=[1])
        mm.add_task(3, "backend", depends=[2])
        mm.set_status(1, "failed")
        assert mm.get_status(2) == "blocked"
        assert mm.get_status(3) == "blocked"

    def test_unblock_on_resolve(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend", depends=[1])
        mm.set_status(1, "failed")
        assert mm.get_status(2) == "blocked"
        mm.set_status(1, "implemented")
        assert mm.get_status(2) == "planned"

    def test_has_work_true(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        assert mm.has_work()

    def test_has_work_false_all_verified(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.set_status(1, "verified")
        assert not mm.has_work()


class TestArchive:
    """REQ-TM-5, REQ-TM-6: Archive and history log."""

    def test_archive_moves_file(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.task_path(1).write_text("# Task 1")
        mm.set_status(1, "verified")
        mm.archive(1)
        assert not mm.task_path(1).exists()
        assert (mm._archived_dir / "TASK-1.md").exists()

    def test_archive_removes_from_manifest(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.task_path(1).write_text("# Task 1")
        mm.set_status(1, "verified")
        mm.archive(1)
        assert mm.get_task(1) is None

    def test_archive_appends_history(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.task_path(1).write_text("# Task 1")
        mm.set_status(1, "verified")
        mm.archive(1)
        history = mm._history_path.read_text()
        assert "TASK-1 verified module=backend" in history

    def test_archive_bug_follows_task(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.task_path(1).write_text("# Task 1")
        mm.add_bug(1, refs=[1])
        mm.bug_path(1).write_text("# Bug 1")
        mm.set_status(1, "verified")
        mm.archive(1)
        assert (mm._archived_dir / "BUG-1.md").exists()

    def test_bug_stays_if_other_refs_active(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend")
        mm.task_path(1).write_text("# Task 1")
        mm.add_bug(1, refs=[1, 2])
        mm.bug_path(1).write_text("# Bug 1")
        mm.set_status(1, "verified")
        mm.archive(1)
        assert mm.bug_path(1).exists()  # stays — task 2 still active


class TestBugs:
    """REQ-TM-7: Independent bug tracking."""

    def test_add_bug_standalone(self, mm):
        mm.load()
        mm.add_bug(1)
        assert mm._data["bugs"][1]["status"] == "open"

    def test_add_bug_with_task_ref(self, mm):
        mm.load()
        mm.add_task(5, "backend")
        mm.add_bug(1, refs=[5])
        assert 1 in mm.tasks()[5].get("refs", [])

    def test_next_bug_id(self, mm):
        mm.load()
        mm.add_bug(1)
        mm.add_bug(2)
        assert mm.next_bug_id == 3


class TestSummary:
    def test_counts_by_status(self, mm):
        mm.load()
        mm.add_task(1, "backend")
        mm.add_task(2, "backend")
        mm.add_task(3, "frontend")
        mm.set_status(1, "implemented")
        mm.set_status(2, "verified")
        s = mm.summary()
        assert s["planned"] == 1
        assert s["implemented"] == 1
        assert s["verified"] == 1


class TestIdeas:
    """REQ-IDEA-1, REQ-IDEA-3: Idea tracking in manifest."""

    def test_add_idea(self, mm):
        mm.load()
        mm.add_idea(1)
        assert mm.ideas()[1]["status"] == "draft"
        assert mm.next_idea_id == 2

    def test_set_idea_status(self, mm):
        mm.load()
        mm.add_idea(1)
        mm.set_idea_status(1, "now")
        assert mm.ideas()[1]["status"] == "now"

    def test_idea_path(self, mm):
        assert mm.idea_path(3).name == "IDEA-3.md"

    def test_read_idea(self, mm):
        mm.load()
        mm.ensure_dirs()
        mm.add_idea(1)
        mm.idea_path(1).write_text("# My idea\n")
        assert mm.read_idea(1) == "# My idea\n"

    def test_read_idea_missing(self, mm):
        mm.load()
        assert mm.read_idea(99) == ""

    def test_idea_id_sequence(self, mm):
        mm.load()
        mm.add_idea(1)
        mm.add_idea(5)
        assert mm.next_idea_id == 6
