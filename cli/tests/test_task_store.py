"""Tests for TaskStore — REQ-D-14: completed tasks move to TASKS-DONE.md."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from voidrift_cli.task_store import Task, TaskStore


@pytest.fixture()
def store_dir(tmp_path: Path) -> Path:
    return tmp_path


def make_store(store_dir: Path, content: str) -> TaskStore:
    tasks_file = store_dir / "TASKS.md"
    tasks_file.write_text(content)
    store = TaskStore()
    store.load(tasks_file)
    return store


# ── load / basic access ──────────────────────────────────────────────────────


def test_load_single_module(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n- [ ] Task B\n")
    counts = store.load(store_dir / "TASKS.md")
    assert counts["_default"] == 2


def test_get_next_returns_pending(store_dir: Path) -> None:
    store = make_store(store_dir, "- [!] Blocked\n- [ ] Pending\n")
    task = store.get_next()
    assert task is not None
    assert task.text == "Pending"


def test_get_next_returns_none_when_empty(store_dir: Path) -> None:
    store = make_store(store_dir, "- [!] All blocked\n")
    assert store.get_next() is None


# ── complete(): task removed from TASKS.md ───────────────────────────────────


def test_complete_removes_task_from_tasks_md(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n- [ ] Task B\n")
    store.complete()
    text = (store_dir / "TASKS.md").read_text()
    assert "Task A" not in text
    assert "Task B" in text


def test_complete_does_not_write_done_marker_to_tasks_md(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n")
    store.complete()
    text = (store_dir / "TASKS.md").read_text()
    assert "[x]" not in text


def test_complete_second_task_after_first(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n- [ ] Task B\n- [ ] Task C\n")
    store.complete()
    store.complete()
    text = (store_dir / "TASKS.md").read_text()
    assert "Task A" not in text
    assert "Task B" not in text
    assert "Task C" in text


def test_complete_returns_none_when_no_pending(store_dir: Path) -> None:
    store = make_store(store_dir, "- [!] Blocked\n")
    assert store.complete() is None


# ── complete(): task appended to TASKS-DONE.md ──────────────────────────────


def test_complete_appends_to_tasks_done(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n")
    task = store.complete()
    done_path = store_dir / "TASKS-DONE.md"
    assert done_path.exists()
    assert task is not None
    assert task.text in done_path.read_text()


def test_complete_done_entry_has_timestamp(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n")
    store.complete()
    done_text = (store_dir / "TASKS-DONE.md").read_text()
    # Entry format: - [x] <text>  <!-- <ISO timestamp> -->
    assert re.search(r"<!-- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2} -->", done_text)


def test_complete_multiple_appends_to_tasks_done(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n- [ ] Task B\n")
    store.complete()
    store.complete()
    done_text = (store_dir / "TASKS-DONE.md").read_text()
    assert done_text.count("[x]") == 2
    assert "Task A" in done_text
    assert "Task B" in done_text


# ── complete(): multi-module ─────────────────────────────────────────────────


def test_complete_multi_module(store_dir: Path) -> None:
    content = "## Module: backend\n- [ ] BE task\n## Module: frontend\n- [ ] FE task\n"
    store = make_store(store_dir, content)
    store.complete("backend")
    store.complete("frontend")
    tasks_text = (store_dir / "TASKS.md").read_text()
    done_text = (store_dir / "TASKS-DONE.md").read_text()
    assert "[x]" not in tasks_text
    assert done_text.count("[x]") == 2


# ── block() ─────────────────────────────────────────────────────────────────


def test_block_marks_task_in_tasks_md(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] Task A\n")
    store.block()
    text = (store_dir / "TASKS.md").read_text()
    assert "- [!] Task A" in text


# ── status() ────────────────────────────────────────────────────────────────


def test_status_counts(store_dir: Path) -> None:
    store = make_store(store_dir, "- [ ] A\n- [ ] B\n- [!] C\n")
    s = store.status()
    assert s["remaining"] == 2
    assert s["blocked"] == 1
    assert s["done"] == 0
