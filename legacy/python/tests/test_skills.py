"""Tests for 3-layer skill resolution (REQ-SKL-2, REQ-CTX-1)."""

from __future__ import annotations

from pathlib import Path

import voidrift_cli.skills as skills_mod
from voidrift_cli.skills import find_skill, get_skill_allowed_tools, make_skill_tool_guard


def _write_skill(base: Path, name: str, content: str) -> None:
    base.mkdir(parents=True, exist_ok=True)
    (base / f"{name}.md").write_text(content, encoding="utf-8")


class TestSkillResolution:

    def test_project_layer_wins(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        _write_skill(tmp_path / ".voidrift" / "skills", "FOO", "---\nname: FOO\n---\nproject")
        _write_skill(tmp_path / "voidrift_home" / "domain-skills", "FOO", "---\nname: FOO\n---\ndomain")
        _write_skill(tmp_path / "voidrift_home" / "resources" / "skills", "FOO", "---\nname: FOO\n---\nnorth-star")
        result = find_skill("FOO", project_dir=tmp_path)
        assert "project" in result
        assert "---" not in result

    def test_domain_layer_fallback(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        _write_skill(tmp_path / "voidrift_home" / "domain-skills", "FOO", "---\nname: FOO\n---\ndomain")
        result = find_skill("FOO", project_dir=tmp_path)
        assert "domain" in result
        assert "---" not in result

    def test_north_star_fallback(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        _write_skill(tmp_path / "voidrift_home" / "resources" / "skills", "FOO", "---\nname: FOO\n---\nnorth-star")
        result = find_skill("FOO", project_dir=tmp_path)
        assert "north-star" in result
        assert "---" not in result

    def test_missing_skill_returns_none(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        result = find_skill("FOO", project_dir=tmp_path)
        assert result is None

    def test_frontmatter_stripped(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        _write_skill(tmp_path / ".voidrift" / "skills", "FOO", "---\nname: FOO\n---\n# Content\nBody text")
        result = find_skill("FOO", project_dir=tmp_path)
        assert "---" not in result
        assert "name: FOO" not in result
        assert "# Content\nBody text" in result

    def test_case_insensitive(self, tmp_path, monkeypatch):
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        _write_skill(tmp_path / ".voidrift" / "skills", "BACKEND-ENG", "---\nname: BE\n---\nbackend content")
        result = find_skill("backend-eng", project_dir=tmp_path)
        assert "backend content" in result


class TestAllowedTools:
    def test_blocks_unlisted_tool(self):
        guard = make_skill_tool_guard(["read_source_file"], "SEC")
        result = guard("write_source_file", "{}")
        assert result is not None
        assert "blocked" in result
        assert "read_source_file" in result

    def test_allows_listed_tool(self):
        guard = make_skill_tool_guard(["read_source_file"], "SEC")
        assert guard("read_source_file", "{}") is None

    def test_none_returns_no_guard(self):
        assert make_skill_tool_guard(None, "ANY") is None

    def test_empty_list_blocks_all(self):
        guard = make_skill_tool_guard([], "RO")
        result = guard("read_source_file", "{}")
        assert result is not None
        assert "none" in result

    def test_parse_from_frontmatter(self, tmp_path):
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "TEST-SKILL.md").write_text(
            "---\nname: TEST-SKILL\nallowed_tools:\n  - read_source_file\n---\n# Test\n"
        )
        at = get_skill_allowed_tools("TEST-SKILL", project_dir=tmp_path)
        assert at == ["read_source_file"]

    def test_absent_field_returns_none(self, tmp_path):
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "OPEN.md").write_text("---\nname: OPEN\n---\n# Open\n")
        assert get_skill_allowed_tools("OPEN", project_dir=tmp_path) is None

    def test_nonexistent_skill_returns_none(self, tmp_path):
        assert get_skill_allowed_tools("NOPE", project_dir=tmp_path) is None


class TestAllowedToolsIsolation:
    def test_skill_state_stored_on_agent_instance(self, cloud_model):
        """Active skill state is per-instance, not shared globally."""
        from voidrift_cli.agent import AgentLoop
        agent1 = AgentLoop(model=cloud_model)
        agent2 = AgentLoop(model=cloud_model)
        agent1.active_skill_allowed_tools = ["read_source_file"]
        agent1.active_skill_name = "TEST"
        # Second agent should be unaffected
        assert agent2.active_skill_allowed_tools is None
        assert agent2.active_skill_name == ""

    def test_no_module_level_side_channel(self):
        """tool_builder module has no _active_skill_allowed_tools attribute."""
        import voidrift_cli.tool_builder as tb_mod
        assert not hasattr(tb_mod, "_active_skill_allowed_tools"), (
            "_active_skill_allowed_tools still exists in tool_builder"
        )


class TestFindOrSynthesizeSkill:
    """REQ-SKL-5: find_or_synthesize_skill falls back to synthesis for unknown skills."""

    def _write_skill(self, base: Path, name: str, content: str) -> None:
        base.mkdir(parents=True, exist_ok=True)
        (base / f"{name}.md").write_text(content, encoding="utf-8")

    def test_returns_existing_non_draft_skill(self, tmp_path, monkeypatch):
        """When an approved skill exists, returns it without synthesis."""
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skills_mod.clear_cache()
        self._write_skill(
            tmp_path / ".voidrift" / "skills", "MYSKILL",
            "---\nname: MYSKILL\nstatus: approved\n---\napproved content"
        )
        result = skills_mod.find_or_synthesize_skill("MYSKILL", project_dir=tmp_path)
        assert result is not None
        assert "approved content" in result

    def test_returns_draft_without_re_synthesis(self, tmp_path, monkeypatch):
        """When a draft skill exists, returns it without calling the model."""
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skills_mod.clear_cache()
        self._write_skill(
            tmp_path / ".voidrift" / "skills", "DRAFT",
            "---\nname: DRAFT\nstatus: draft\n---\ndraft body"
        )
        result = skills_mod.find_or_synthesize_skill("DRAFT", project_dir=tmp_path, model=None)
        assert result is not None
        assert "draft body" in result

    def test_returns_none_when_no_skill_and_no_model(self, tmp_path, monkeypatch):
        """Returns None when skill does not exist and no model is provided."""
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skills_mod.clear_cache()
        result = skills_mod.find_or_synthesize_skill("NONEXISTENT", project_dir=tmp_path, model=None)
        assert result is None

    def test_synthesizes_and_writes_draft(self, tmp_path, monkeypatch, cloud_model):
        """When no skill exists and a model is provided, synthesizes and writes a draft."""
        from unittest.mock import patch, MagicMock
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skills_mod.clear_cache()

        with patch("voidrift_cli.agent.AgentLoop") as MockAgent:
            mock = MagicMock()
            mock.send.return_value = "---\nname: NEWSKILL\nstatus: draft\n---\nSynthesized content"
            MockAgent.return_value = mock

            result = skills_mod.find_or_synthesize_skill(
                "NEWSKILL", project_dir=tmp_path, model=cloud_model
            )

        assert result is not None
        assert "Synthesized content" in result
        # Draft file written to project skills dir
        draft_path = tmp_path / ".voidrift" / "skills" / "NEWSKILL.md"
        assert draft_path.exists()
        assert "status: draft" in draft_path.read_text()


class TestApproveDraftSkill:
    """REQ-SKL-5: approve_draft_skill promotes a draft to approved in place."""

    def test_promotes_draft_to_approved(self, tmp_path, monkeypatch):
        """Updates status frontmatter from draft to approved."""
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "MYSKILL.md").write_text(
            "---\nname: MYSKILL\nstatus: draft\n---\n# Content\n"
        )
        result = skills_mod.approve_draft_skill("MYSKILL", project_dir=tmp_path)
        assert result is True
        updated = (skill_dir / "MYSKILL.md").read_text()
        assert "status: approved" in updated
        assert "status: draft" not in updated

    def test_returns_false_for_non_draft(self, tmp_path):
        """Returns False if the skill is already approved."""
        import voidrift_cli.skills as skills_mod
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "FOO.md").write_text("---\nname: FOO\nstatus: approved\n---\ncontent\n")
        result = skills_mod.approve_draft_skill("FOO", project_dir=tmp_path)
        assert result is False

    def test_returns_false_for_missing_skill(self, tmp_path):
        """Returns False if skill file does not exist."""
        import voidrift_cli.skills as skills_mod
        result = skills_mod.approve_draft_skill("NOPE", project_dir=tmp_path)
        assert result is False

    def test_invalidates_cache_on_promotion(self, tmp_path, monkeypatch):
        """Cache is cleared so subsequent find_skill returns updated content."""
        import voidrift_cli.skills as skills_mod
        monkeypatch.setattr(skills_mod, "_VOIDRIFT_HOME", tmp_path / "voidrift_home")
        skill_dir = tmp_path / ".voidrift" / "skills"
        skill_dir.mkdir(parents=True)
        (skill_dir / "CACHED.md").write_text("---\nname: CACHED\nstatus: draft\n---\nbody\n")
        # Warm cache
        skills_mod.clear_cache()
        skills_mod.find_skill("CACHED", project_dir=tmp_path)
        # Promote
        skills_mod.approve_draft_skill("CACHED", project_dir=tmp_path)
        # Cache entry should be gone so next read returns updated content
        assert ("CACHED", str(tmp_path)) not in skills_mod._cache
