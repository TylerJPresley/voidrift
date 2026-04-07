"""Tests for plan command — integration tests with mocked model API."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import ModelConfig
from helpers import make_openai_response


class TestPromptFormatting:
    """V-RES-1: Prompt format variable substitution — task format loaded from template."""

    def test_task_format_loads_from_template(self):
        """TASK-FORMAT template loads from resources/templates/."""
        from voidrift_cli.prompts import load_template
        result = load_template("TASK-FORMAT")
        assert "skills:" in result
        assert "reqs:" in result

    def test_task_format_contains_structure(self):
        """TASK-FORMAT template describes multi-line block structure."""
        from voidrift_cli.prompts import load_template
        result = load_template("TASK-FORMAT")
        assert "- [ ]" in result


class TestPlanPreflightChecks:
    def test_missing_requirements(self, tmp_project, cloud_model):
        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_produces_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """Simulate a model that creates the required artifacts via all five stages."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Stage 1: write ARCHITECTURE.md with module reference
                def send(msg):
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Architecture complete."
                mock.send.side_effect = send
            elif agent_count == 2:
                # Stage 2: write arch/backend.md
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend module\n")
                    return "Module arch done."
                mock.send.side_effect = send
            elif agent_count == 3:
                # Stage 3: write tasks/outline/backend.md
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Create entry point\n"
                        "    files:\n      - backend/main.py (create)\n    depends: []\n"
                        "---\n\n## Task 1: Create entry point\nCreates the main entry point.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                # Stage 5: write task file (stage 4 skipped — single module)
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Create entry point\n"
                    )
                    return "Task complete."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "tasks" / "active" / "TASK-1.md").exists()

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_retries_on_missing_artifacts(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        """Stage 1 retries once when ARCHITECTURE.md is not written on first send."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Stage 1: first send omits file, retry writes it
                call_count = 0
                def send(msg):
                    nonlocal call_count
                    call_count += 1
                    if call_count == 1:
                        return "Oops, forgot."
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            elif agent_count == 2:
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\n")
                    return "Done."
                mock.send.side_effect = send
            elif agent_count == 3:
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Task\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Task\nDoes something.\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            else:
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Task\n"
                    )
                    return "Done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_fails_after_retry(self, MockAgent, tmp_project, cloud_model, sample_requirements):
        mock_instance = MagicMock()
        mock_instance.send.return_value = "I didn't create anything."
        MockAgent.return_value = mock_instance

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 1

    def test_overwrite_clears_artifacts(self, tmp_project, cloud_model, sample_requirements):
        vd = tmp_project / ".voidrift"
        (vd / "ARCHITECTURE.md").write_text("old arch")
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        (active / "TASK-1.md").write_text("old task")
        (vd / "arch").mkdir(exist_ok=True)
        (vd / "arch" / "backend.md").write_text("old module arch")
        (vd / "spec").mkdir(exist_ok=True)
        (vd / "spec" / "auth.md").write_text("gather spec")

        (vd / "STATE.md").write_text(
            "## 2026-01-01T00:00:00 — plan (test)\nOld plan.\n### Files\n"
            "- created: .voidrift/ARCHITECTURE.md\n"
            "- created: .voidrift/arch/backend.md\n\n"
        )

        with patch("voidrift_cli.commands.plan.AgentLoop") as MockAgent:
            mock_instance = MagicMock()
            mock_instance.send.return_value = "nothing"
            MockAgent.return_value = mock_instance

            from voidrift_cli.commands.plan import run_plan
            run_plan(cloud_model, overwrite=True)

        assert not (vd / "ARCHITECTURE.md").exists()
        assert not (active / "TASK-1.md").exists()
        assert not (vd / "arch" / "backend.md").exists()
        assert (vd / "spec" / "auth.md").exists(), "Gather specs must be preserved"


class TestPlanSkillValidation:
    """V-P-4: REQ-P-9 — skill tag validation with word-overlap resolution."""

    def test_valid_skill_preserved(self, tmp_project):
        """Valid skill tags are kept as-is."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [BACKEND-ENG]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == ["BACKEND-ENG"]

    def test_invalid_skill_resolved_by_word_overlap(self):
        """Invalid skill with a shared word is resolved to the closest valid skill (REQ-P-9 AC2)."""
        from voidrift_cli.commands.plan import _resolve_skill
        valid = {"BACKEND-ENG", "WEB-ENG", "CLOUD-OPS"}
        assert _resolve_skill("BACKEND-ENGINEERING", valid) == "BACKEND-ENG"

    def test_invalid_skill_stripped_when_no_overlap(self):
        """Invalid skill with no word overlap is stripped (REQ-P-9 AC3)."""
        from voidrift_cli.commands.plan import _resolve_skill
        valid = {"BACKEND-ENG", "WEB-ENG", "CLOUD-OPS"}
        assert _resolve_skill("documentation", valid) is None

    def test_resolve_picks_highest_overlap(self):
        """When multiple valid skills share words, the one with most overlap wins."""
        from voidrift_cli.commands.plan import _resolve_skill
        # BACKEND-ENG shares 2 words (BACKEND, ENG) with invalid "BACKEND-ENG-EXTRA"
        # CLOUD-OPS shares 0 words
        valid = {"BACKEND-ENG", "CLOUD-OPS"}
        assert _resolve_skill("BACKEND-ENG-EXTRA", valid) == "BACKEND-ENG"

    def test_valid_skills_prompt_includes_descriptions(self, tmp_project):
        """valid_skills string uses '- NAME: description' format (REQ-P-9 AC1)."""
        from voidrift_cli.commands.plan import _available_skills_with_desc
        skill_dir = tmp_project / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend API engineering.\n---\n# Backend\n"
        )
        result = _available_skills_with_desc()
        assert "BACKEND-ENG" in result
        assert result["BACKEND-ENG"] == "Backend API engineering."

    def test_invalid_skill_substituted_in_task_file(self, tmp_project):
        """An invalid skill resolved via word-overlap is written back into the task file."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [BACKEND-ENGINEERING]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == ["BACKEND-ENG"]

    def test_unresolvable_skill_stripped_from_task_file(self, tmp_project):
        """An invalid skill with no word overlap is removed from the task file."""
        import yaml
        from voidrift_cli.commands.plan import _build_task_files
        vd = tmp_project / ".voidrift"
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        skill_dir = vd / "skills"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "BACKEND-ENG.md").write_text(
            "---\nname: BACKEND-ENG\ndescription: Backend engineering.\n---\n# Backend\n"
        )
        task = active / "TASK-1.md"
        task.write_text("---\nid: 1\nmodule: backend\nskills: [documentation]\ndepends: []\n---\n# Task\n")

        _build_task_files(vd, "", "")

        content = task.read_text()
        fm = yaml.safe_load(content.split("---")[1])
        assert fm["skills"] == []


class TestPlanUpdateMode:
    """V-P-5: plan auto-detects update mode when artifacts exist; fresh-plan when absent."""

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_fresh_plan_when_no_artifacts(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """run_plan() runs all stages when no artifacts exist."""
        vd = tmp_project / ".voidrift"
        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                def send(msg):
                    (vd / "ARCHITECTURE.md").write_text(
                        "---\nmodules:\n  - backend\n---\n# Architecture\n"
                    )
                    return "Arch done."
                mock.send.side_effect = send
            elif agent_count == 2:
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\n")
                    return "Module done."
                mock.send.side_effect = send
            elif agent_count == 3:
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Stub\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Stub\nCreates the stub.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                def send(msg):
                    active = vd / "tasks" / "active"
                    active.mkdir(parents=True, exist_ok=True)
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Stub\n"
                    )
                    return "Tasks done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        assert (vd / "ARCHITECTURE.md").exists()
        assert (vd / "tasks" / "active" / "TASK-1.md").exists()

    @patch("voidrift_cli.commands.plan.AgentLoop")
    def test_auto_detects_update_mode(
        self, MockAgent, tmp_project, cloud_model, sample_requirements
    ):
        """run_plan() runs delta analysis when plan artifacts already exist (REQ-P-11)."""
        vd = tmp_project / ".voidrift"
        # Pre-existing arch artifacts from a previous plan run
        (vd / "ARCHITECTURE.md").write_text("---\nmodules:\n  - backend\n---\n# Architecture\n")
        (vd / "arch").mkdir(parents=True, exist_ok=True)
        (vd / "arch" / "backend.md").write_text("# Backend\nExisting module arch.")
        active = vd / "tasks" / "active"
        active.mkdir(parents=True, exist_ok=True)
        (active / "TASK-1.md").write_text(
            "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Done task\n"
        )
        # manifest.yml triggers update mode detection
        import yaml as _yaml
        tasks_dir = vd / "tasks"
        (tasks_dir / "manifest.yml").write_text(_yaml.dump(
            {"tasks": {1: {"status": "implemented", "module": "backend"}},
             "modules": {"backend": [1]}, "dependencies": {}, "next_id": 2, "next_bug_id": 1},
            default_flow_style=False,
        ))
        # A source file so delta analysis has something to scan
        src = tmp_project / "src"
        src.mkdir()
        (src / "main.py").write_text("print('hello')")

        agent_count = 0

        def make_agent(**kwargs):
            nonlocal agent_count
            agent_count += 1
            mock = MagicMock()
            if agent_count == 1:
                # Delta analysis agent (REQ-P-11)
                mock.send.return_value = "## Implemented\n- REQ-1: main.py exists\n## Unimplemented\n- REQ-2: no files"
            elif agent_count == 2:
                # Stage 1: ARCHITECTURE.md already exists; agent updates it
                mock.send.return_value = "Updated."
            elif agent_count == 3:
                # Stage 2: arch/backend.md
                def send(msg):
                    (vd / "arch").mkdir(parents=True, exist_ok=True)
                    (vd / "arch" / "backend.md").write_text("# Backend\nUpdated module arch.")
                    return "Module updated."
                mock.send.side_effect = send
            elif agent_count == 4:
                # Stage 3: write outline
                def send(msg):
                    outline = vd / "tasks" / "outline"
                    outline.mkdir(parents=True, exist_ok=True)
                    (outline / "backend.md").write_text(
                        "---\nmodule: backend\ntasks:\n"
                        "  - id: 1\n    title: Existing task\n    files: []\n    depends: []\n"
                        "---\n\n## Task 1: Existing task\nUpdates the existing task.\n"
                    )
                    return "Outline done."
                mock.send.side_effect = send
            else:
                # Stage 5: task agent
                def send(msg):
                    (active / "TASK-1.md").write_text(
                        "---\nid: 1\nmodule: backend\nskills: []\ndepends: []\n---\n# Updated\n"
                    )
                    return "Task done."
                mock.send.side_effect = send
            return mock

        MockAgent.side_effect = make_agent

        from voidrift_cli.commands.plan import run_plan
        result = run_plan(cloud_model)
        assert result == 0
        # Delta agent was called (agent_count >= 2 means delta + at least stage 1)
        assert agent_count >= 2

