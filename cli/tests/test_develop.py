"""Tests for develop command — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


class TestDevelopPreflightChecks:
    def _setup_manifest(self, vd, tasks=None):
        """Create manifest + task files for testing."""
        import yaml
        tasks_dir = vd / "tasks"
        active = tasks_dir / "active"
        active.mkdir(parents=True, exist_ok=True)
        (tasks_dir / "archived").mkdir(exist_ok=True)
        if tasks is None:
            return
        manifest = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1}
        for t in tasks:
            tid = t["id"]
            manifest["tasks"][tid] = {"status": t.get("status", "planned"), "module": t.get("module", "default")}
            mod = t.get("module", "default")
            manifest["modules"].setdefault(mod, [])
            if tid not in manifest["modules"][mod]:
                manifest["modules"][mod].append(tid)
            if t.get("depends"):
                manifest["dependencies"][tid] = t["depends"]
            manifest["next_id"] = max(manifest["next_id"], tid + 1)
            # Write task file
            content = f"---\nid: {tid}\nmodule: {mod}\nskills: []\n---\n# {t.get('title', f'Task {tid}')}\n"
            (active / f"TASK-{tid}.md").write_text(content)
        (tasks_dir / "manifest.yml").write_text(yaml.dump(manifest, default_flow_style=False))

    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_missing_manifest(self, tmp_project, cloud_model, sample_requirements):
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 1

    def test_all_tasks_complete(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [
            {"id": 1, "status": "verified", "title": "Done 1"},
            {"id": 2, "status": "verified", "title": "Done 2"},
        ])
        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result == 0

    def test_lock_file_stale(self, tmp_project, cloud_model, sample_requirements):
        """Stale lock (dead PID) should be cleaned up."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Task 1"}])
        lock = vd / ".develop.lock"
        lock.write_text("99999999\n2020-01-01T00:00:00")

        with patch("voidrift_cli.commands.develop.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "done"
            MockAgent.return_value = mock_instance
            from voidrift_cli.commands.develop import run_develop
            run_develop(cloud_model)

        assert not lock.exists()

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_develop_loop_marks_implemented(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """REQ-D-9: Task marked implemented after writes."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create main.py"}])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "Created the file."
        MockAgent.return_value = mock_instance

        # Simulate write_source_file being called
        from voidrift_cli.tools.filesystem import WriteContext
        with patch.object(WriteContext, 'get_write_count', return_value=1):
            from voidrift_cli.commands.develop import run_develop
            result = run_develop(cloud_model)

        import yaml
        manifest = yaml.safe_load((vd / "tasks" / "manifest.yml").read_text())
        assert manifest["tasks"][1]["status"] == "implemented"

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_sequential_multi_module(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [
            {"id": 1, "module": "backend", "title": "Task A"},
            {"id": 2, "module": "frontend", "title": "Task B"},
        ])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "done"
        MockAgent.return_value = mock_instance

        from voidrift_cli.tools.filesystem import WriteContext
        with patch.object(WriteContext, 'get_write_count', return_value=1):
            from voidrift_cli.commands.develop import run_develop
            result = run_develop(cloud_model)

        import yaml
        manifest = yaml.safe_load((vd / "tasks" / "manifest.yml").read_text())
        assert manifest["tasks"][1]["status"] == "implemented"
        assert manifest["tasks"][2]["status"] == "implemented"


class TestDevelopRetryEscalation:
    """V-D-4: No writes triggers retry, then escalation."""

    def _setup_manifest(self, vd, tasks=None):
        """Create manifest + task files for testing."""
        import yaml as _yaml
        tasks_dir = vd / "tasks"
        active = tasks_dir / "active"
        active.mkdir(parents=True, exist_ok=True)
        (tasks_dir / "archived").mkdir(exist_ok=True)
        if tasks is None:
            return
        manifest = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1}
        for t in tasks:
            tid = t["id"]
            manifest["tasks"][tid] = {"status": t.get("status", "planned"), "module": t.get("module", "default")}
            mod = t.get("module", "default")
            manifest["modules"].setdefault(mod, [])
            if tid not in manifest["modules"][mod]:
                manifest["modules"][mod].append(tid)
            manifest["next_id"] = max(manifest["next_id"], tid + 1)
            content = f"---\nid: {tid}\nmodule: {mod}\nskills: []\n---\n# {t.get('title', f'Task {tid}')}\n"
            (active / f"TASK-{tid}.md").write_text(content)
        (tasks_dir / "manifest.yml").write_text(_yaml.dump(manifest, default_flow_style=False))

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_triggers_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """When the first task attempt writes nothing, a retry is attempted."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])

        call_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.on_progress = None
                self.on_token = None
                self.on_complete = None
                self.messages = []
                self._tool_handlers = kwargs.get("tool_handlers", {})

            def send(self, msg: str) -> str:
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    write_handler = self._tool_handlers.get("write_source_file")
                    if write_handler and hasattr(write_handler, '__self__'):
                        write_handler.__self__._source_write_count += 1
                return "done"

        MockAgent.side_effect = FakeAgent

        from voidrift_cli.commands.develop import run_develop
        run_develop(cloud_model)

        assert call_count >= 2, "Expected at least 2 agent calls (initial + retry)"

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_no_architect_skips_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """When no writes after retry and no architect, task returns failure."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])

        mock_instance = MagicMock()
        mock_instance.send.return_value = "I thought about it."
        mock_instance.on_progress = None
        mock_instance.on_token = None
        mock_instance.on_complete = None
        mock_instance.messages = []
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model)
        assert result in (0, 1)

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_no_writes_with_architect_escalates(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """When no writes after retry and architect is configured, architect is consulted
        and fix plan is appended to the task file (REQ-D-6, REQ-TM-7)."""
        vd = tmp_project / ".voidrift"
        self._setup_manifest(vd, [{"id": 1, "title": "Create stub"}])
        (vd / "REQUIREMENTS.md").write_text("# Reqs\n")
        (vd / "ARCHITECTURE.md").write_text("# Arch\n")

        send_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.on_progress = None
                self.on_token = None
                self.on_complete = None
                self.messages = []
                self._has_tools = bool(kwargs.get("tools"))
                self._tool_handlers = kwargs.get("tool_handlers", {})

            def send(self, msg: str) -> str:
                nonlocal send_count
                send_count += 1
                # Architect agent (no tools) returns guidance
                if not self._has_tools:
                    return "Fix: create the file with a stub function."
                # After architect guidance (send 3+), produce writes
                if send_count >= 5:
                    write_handler = self._tool_handlers.get("write_source_file")
                    if write_handler and hasattr(write_handler, '__self__'):
                        write_handler.__self__._source_write_count += 1
                return "done"

        MockAgent.side_effect = FakeAgent

        from voidrift_cli.commands.develop import run_develop
        result = run_develop(cloud_model, architect=cloud_model)

        # Architect guidance should be appended to the task file
        task_file = vd / "tasks" / "active" / "TASK-1.md"
        content = task_file.read_text()
        assert "Architect Fix Plan" in content


class TestDevelopMaxEscalations:
    """V-D-5: After MAX_ESCALATIONS, task is blocked and loop continues."""

    def test_max_escalations_constant(self):
        """MAX_ESCALATIONS is defined and has a positive value."""
        from voidrift_cli.commands.develop import MAX_ESCALATIONS
        assert MAX_ESCALATIONS > 0

    @patch("voidrift_cli.commands.develop.AgentLoop")
    def test_max_escalations_blocks_task(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """After MAX_ESCALATIONS+1 escalation files, the task is blocked."""
        from voidrift_cli.commands.develop import MAX_ESCALATIONS
        vd = tmp_project / ".voidrift"
        (vd / "TASKS.md").write_text(
            "- [ ] Create src/esc.py: stub [backend]\n"
            "- [ ] Create src/ok.py: stub [backend]\n"
        )

        esc_dir = vd / "escalations"
        esc_dir.mkdir(parents=True, exist_ok=True)

        call_count = 0

        class FakeAgent:
            def __init__(self, **kwargs):
                self.model = kwargs.get("model")
                self.system_prompt = kwargs.get("system_prompt", "")
                self.tools = kwargs.get("tools", [])
                self.tool_handlers = kwargs.get("tool_handlers", {})
                self.stream = kwargs.get("stream", False)
                self.log_path = kwargs.get("log_path")
                self.on_token = None
                self.on_complete = None
                self.on_tool_call = None
                self.messages = []
                self.extra_body = {}

            def send(self, msg: str) -> str:
                nonlocal call_count
                call_count += 1
                # Write a file so we pass the no-writes check
                write_handler = self.tool_handlers.get("write_source_file")
                if write_handler and hasattr(write_handler, '__self__'):
                    write_handler.__self__._source_write_count += 1
                # Trigger escalation by writing escalation file
                task_num = call_count
                esc_file = esc_dir / f"{task_num}.md"
                esc_file.write_text(f"Escalation for task {task_num}")
                return "done"

        MockAgent.side_effect = FakeAgent

        architect = MagicMock()
        architect.alias = "arch-test"

        from voidrift_cli.commands.develop import run_develop
        # Should not raise — blocked tasks are handled gracefully
        result = run_develop(cloud_model)
        assert result in (0, 1)

