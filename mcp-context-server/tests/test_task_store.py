"""Tests for task_store.py."""

from voidrift_mcp.task_store import TaskStore


class TestTaskStore:
    def test_load_single_module(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("## Tasks\n- [ ] Create foo.py: do stuff [web-eng]\n- [ ] Create bar.py: more stuff [arch-design]\n")
        store = TaskStore()
        counts = store.load(f)
        assert counts == {"_default": 2}

    def test_load_multi_module(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text(
            "## Module: backend\n"
            "- [ ] Create api.py: routes [web-eng]\n"
            "- [ ] Create models.py: data [web-eng]\n"
            "## Module: frontend\n"
            "- [ ] Create App.vue: shell [web-eng]\n"
        )
        store = TaskStore()
        counts = store.load(f)
        assert counts == {"backend": 2, "frontend": 1}

    def test_modules(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("## Module: a\n- [ ] task1 [x]\n## Module: b\n- [ ] task2 [y]\n")
        store = TaskStore()
        store.load(f)
        assert store.modules() == ["a", "b"]

    def test_get_next(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [x] done task [a]\n- [ ] pending task [web-eng]\n")
        store = TaskStore()
        store.load(f)
        task = store.get_next()
        assert task is not None
        assert "pending task" in task.text
        assert task.skills == ["web-eng"]

    def test_get_next_none_remaining(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [x] done [a]\n")
        store = TaskStore()
        store.load(f)
        assert store.get_next() is None

    def test_get_next_by_module(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text(
            "## Module: api\n- [x] done [a]\n- [ ] next api task [web-eng]\n"
            "## Module: ui\n- [ ] ui task [web-eng]\n"
        )
        store = TaskStore()
        store.load(f)
        task = store.get_next("api")
        assert task is not None
        assert "next api task" in task.text

    def test_complete_writes_through(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [ ] first [a]\n- [ ] second [b]\n")
        store = TaskStore()
        store.load(f)
        task = store.complete()
        assert task is not None
        assert "first" in task.text
        assert task.status == "x"
        # Verify disk
        content = f.read_text()
        assert "- [x] first" in content
        assert "- [ ] second" in content

    def test_complete_advances(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [ ] first [a]\n- [ ] second [b]\n")
        store = TaskStore()
        store.load(f)
        store.complete()
        task = store.get_next()
        assert task is not None
        assert "second" in task.text

    def test_block_writes_through(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [ ] blocked task [a]\n")
        store = TaskStore()
        store.load(f)
        task = store.block()
        assert task is not None
        assert task.status == "!"
        assert "- [!] blocked task" in f.read_text()

    def test_status_single_module(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [x] done [a]\n- [!] blocked [b]\n- [ ] pending [c]\n- [ ] pending2 [d]\n")
        store = TaskStore()
        store.load(f)
        s = store.status()
        assert s == {"done": 1, "blocked": 1, "remaining": 2}

    def test_status_by_module(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text(
            "## Module: api\n- [x] done [a]\n- [ ] pending [b]\n"
            "## Module: ui\n- [ ] pending [c]\n"
        )
        store = TaskStore()
        store.load(f)
        assert store.status("api") == {"done": 1, "blocked": 0, "remaining": 1}
        assert store.status("ui") == {"done": 0, "blocked": 0, "remaining": 1}

    def test_skill_parsing(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("- [ ] Create foo.py: stuff [web-eng, arch-design]\n")
        store = TaskStore()
        store.load(f)
        task = store.get_next()
        assert task is not None
        assert task.skills == ["web-eng", "arch-design"]

    def test_preserves_non_task_lines(self, tmp_path):
        f = tmp_path / "TASKS.md"
        f.write_text("# Project Tasks\n\nSome context.\n\n- [ ] task [a]\n")
        store = TaskStore()
        store.load(f)
        store.complete()
        content = f.read_text()
        assert "# Project Tasks" in content
        assert "Some context." in content
        assert "- [x] task" in content
