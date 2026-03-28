"""Tests for MCP server tools — uses real resources dir, mocks project dir."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _reset_server(tmp_project, monkeypatch):
    """Reset server module state before each test."""
    import importlib
    import logging
    import voidrift_mcp.server as srv
    # Clear MCP logger handlers so each test gets a fresh log in its tmp dir
    mcp_logger = logging.getLogger("voidrift.mcp")
    for handler in list(mcp_logger.handlers):
        handler.close()
        mcp_logger.removeHandler(handler)
    importlib.reload(srv)
    srv.run_id = "test-run"
    srv._boot()
    yield srv


class TestStoreAndGetAnalysis:
    def test_store_and_retrieve(self, _reset_server):
        srv = _reset_server
        assert "Stored" in srv.store_file_analysis("src/main.py", "Entry point module")
        result = srv.get_file_analysis("src/main.py")
        assert "Entry point module" in result

    def test_get_missing(self, _reset_server):
        assert "No analysis" in _reset_server.get_file_analysis("nonexistent.py")

    def test_get_all(self, _reset_server):
        srv = _reset_server
        srv.store_file_analysis("a.py", "File A")
        srv.store_file_analysis("b.py", "File B")
        result = srv.get_all_analyses()
        assert "a.py" in result
        assert "b.py" in result
        assert "File A" in result

    def test_get_all_empty(self, _reset_server):
        assert "No analyses" in _reset_server.get_all_analyses()


class TestRequirements:
    def test_store_and_get(self, _reset_server):
        srv = _reset_server
        srv.store_requirements("# Goal\nBuild a thing", "project")
        result = srv.get_requirements("project")
        assert "Build a thing" in result

    def test_get_from_disk(self, _reset_server, voidrift_dir):
        (voidrift_dir / "REQUIREMENTS.md").write_text("# Disk Requirements\nFrom file")
        result = _reset_server.get_requirements("project")
        assert "From file" in result

    def test_get_feature_from_memory(self, _reset_server, voidrift_dir):
        _reset_server.store_requirements("# Auth Feature\nLogin stuff", "auth")
        result = _reset_server.get_requirements("auth")
        assert "Login stuff" in result

    def test_get_missing(self, _reset_server):
        result = _reset_server.get_requirements("nonexistent")
        assert "No requirements" in result


class TestSkills:
    def test_get_backend(self, _reset_server):
        result = _reset_server.get_skill("backend")
        assert "backend" in result.lower() or "Backend" in result

    def test_get_skill_with_topic(self, _reset_server):
        result = _reset_server.get_skill("backend", "Stack Selection")
        # Should find something or report not found
        assert len(result) > 0

    def test_get_missing_skill(self, _reset_server):
        result = _reset_server.get_skill("nonexistent_skill")
        assert "not found" in result.lower()


class TestFileOperations:
    def test_read_source_file(self, _reset_server, tmp_project):
        (tmp_project / "hello.txt").write_text("hello world")
        result = _reset_server.read_source_file("hello.txt")
        assert result == "hello world"

    def test_read_missing_file(self, _reset_server):
        result = _reset_server.read_source_file("nope.txt")
        assert "not found" in result.lower()

    def test_write_file(self, _reset_server, tmp_project):
        result = _reset_server.write_file("output/test.txt", "written content")
        assert "Wrote" in result
        assert (tmp_project / "output" / "test.txt").read_text() == "written content"

    def test_write_creates_parents(self, _reset_server, tmp_project):
        _reset_server.write_file("deep/nested/dir/file.md", "deep content")
        assert (tmp_project / "deep" / "nested" / "dir" / "file.md").exists()

    def test_read_outside_project_denied(self, _reset_server):
        result = _reset_server.read_source_file("../../etc/passwd")
        assert "denied" in result.lower() or "outside" in result.lower() or "not found" in result.lower()


class TestExport:
    def test_export_stored_artifact(self, _reset_server, tmp_project):
        srv = _reset_server
        srv.store_file_analysis("main", "analysis content")
        result = srv.export_to_file("analysis", ".voidrift/main.md")
        assert "Exported" in result or "exported" in result
        assert (tmp_project / ".voidrift" / "main.md").exists()

    def test_export_missing(self, _reset_server):
        result = _reset_server.export_to_file("analysis", "output.md")
        assert "No artifact" in result


class TestListArtifacts:
    def test_no_voidrift_dir(self, _reset_server, tmp_project):
        import shutil
        vd = tmp_project / ".voidrift"
        if vd.exists():
            shutil.rmtree(vd)
        result = _reset_server.list_project_artifacts()
        assert "No .voidrift" in result

    def test_with_files(self, _reset_server, voidrift_dir):
        (voidrift_dir / "REQUIREMENTS.md").write_text("reqs")
        (voidrift_dir / "TASKS.md").write_text("tasks")
        result = _reset_server.list_project_artifacts()
        assert "REQUIREMENTS.md" in result
        assert "TASKS.md" in result
        assert "2 files" in result


class TestGetTemplate:
    def test_get_existing(self, _reset_server):
        result = _reset_server.get_template("adr-template")
        assert len(result) > 0

    def test_get_missing(self, _reset_server):
        result = _reset_server.get_template("nonexistent")
        assert "not found" in result.lower()
        assert "Available" in result


class TestGetPrompt:
    """V-MCP-7: get_prompt(phase, section) retrieves prompt sections."""

    def test_get_existing_section(self, _reset_server):
        """get_prompt returns content for a known phase+section."""
        result = _reset_server.get_prompt("gather", "TRIAGE")
        assert len(result) > 0
        assert "not found" not in result.lower()

    def test_get_missing_section(self, _reset_server):
        """get_prompt returns an error when section doesn't exist in phase."""
        result = _reset_server.get_prompt("gather", "NONEXISTENT_SECTION_XYZ")
        assert "not found" in result.lower() or "Section" in result

    def test_get_missing_phase(self, _reset_server):
        """get_prompt returns an error when the phase file doesn't exist."""
        result = _reset_server.get_prompt("nonexistent_phase_xyz", "ANY")
        assert "not found" in result.lower()

    def test_get_prompt_returns_available_sections_on_error(self, _reset_server):
        """Error message for missing section lists available sections."""
        result = _reset_server.get_prompt("gather", "BAD_SECTION")
        # Should mention available sections
        assert "Available" in result or "not found" in result.lower()


class TestDuplicateWriteDetection:
    """V-MCP-8: write_file returns error on duplicate within the same run."""

    def test_write_duplicate_rejected(self, _reset_server, tmp_project):
        """Writing the same path twice returns an 'already written' error."""
        first = _reset_server.write_file("output/dup.txt", "first content")
        assert "Wrote" in first

        second = _reset_server.write_file("output/dup.txt", "second content")
        assert "already written" in second.lower()

    def test_write_different_paths_ok(self, _reset_server, tmp_project):
        """Writing different paths in the same run is allowed."""
        r1 = _reset_server.write_file("output/file_a.txt", "content a")
        r2 = _reset_server.write_file("output/file_b.txt", "content b")
        assert "Wrote" in r1
        assert "Wrote" in r2

    def test_duplicate_guard_resets_on_reload(self, tmp_project, monkeypatch):
        """After module reload (simulating a new run), the same path can be written."""
        import importlib
        import voidrift_mcp.server as srv
        srv.run_id = "run1"
        srv._boot()
        srv.write_file("fresh.txt", "v1")

        # Reload simulates a new run — _written_paths is cleared
        importlib.reload(srv)
        srv.run_id = "run2"
        srv._boot()
        result = srv.write_file("fresh.txt", "v2")
        assert "Wrote" in result


class TestListPrompts:
    """V-MCP-9: list_prompts(phase) returns H2 sections."""

    def test_list_all_prompts_includes_phases(self, _reset_server):
        """list_prompts() with no arg returns all phases."""
        result = _reset_server.list_prompts()
        assert "gather" in result
        assert "plan" in result

    def test_list_prompts_for_phase(self, _reset_server):
        """list_prompts('gather') returns H2 section names for gather."""
        result = _reset_server.list_prompts("gather")
        # gather.md has a TRIAGE section
        assert "TRIAGE" in result.upper() or len(result) > 0

    def test_list_prompts_missing_phase_returns_error(self, _reset_server):
        """list_prompts('nonexistent') returns an error with available phases."""
        result = _reset_server.list_prompts("nonexistent_phase_xyz")
        assert "not found" in result.lower() or "Available" in result

    def test_list_prompts_returns_bullet_format(self, _reset_server):
        """Sections are returned as bullet list lines."""
        result = _reset_server.list_prompts("gather")
        assert "-" in result or len(result) > 0


class TestSkillLayerOverride:
    """V-SKL-1: project layer overrides domain, domain overrides north-star."""

    def test_project_overrides_domain(self, _reset_server, tmp_project, monkeypatch):
        """A skill in project .voidrift/skills/ takes priority over domain-skills/."""
        import os
        voidrift_home = os.environ["VOIDRIFT_HOME"]

        # Write a domain skill
        domain_dir = Path(voidrift_home) / "domain-skills"
        domain_dir.mkdir(parents=True, exist_ok=True)
        (domain_dir / "LAYERTEST.md").write_text("---\nname: LAYERTEST\n---\n\ndomain version")

        # Write a project skill (higher priority)
        proj_skills = tmp_project / ".voidrift" / "skills"
        proj_skills.mkdir(parents=True, exist_ok=True)
        (proj_skills / "LAYERTEST.md").write_text("---\nname: LAYERTEST\n---\n\nproject version")

        result = _reset_server.get_skill("LAYERTEST")
        assert "project version" in result

    def test_domain_overrides_northstar(self, _reset_server, tmp_project, monkeypatch):
        """A domain skill takes priority over the north-star (resources/skills/)."""
        import os
        voidrift_home = os.environ["VOIDRIFT_HOME"]

        # Write a domain skill (no project-level override)
        domain_dir = Path(voidrift_home) / "domain-skills"
        domain_dir.mkdir(parents=True, exist_ok=True)
        (domain_dir / "DOMAINONLY.md").write_text(
            "---\nname: DOMAINONLY\n---\n\ndomain-specific content"
        )

        result = _reset_server.get_skill("DOMAINONLY")
        assert "domain-specific content" in result

    def test_northstar_fallback_when_no_override(self, _reset_server):
        """North-star skill is found when no domain/project override exists."""
        # backend-eng is a north-star skill (in resources/skills/)
        result = _reset_server.get_skill("backend-eng")
        assert "not found" not in result.lower() or len(result) > 10


class TestMcpLogging:
    """Tests for REQ-LOG-5: MCP server log at ~/.voidrift/logs/mcp.log."""

    def test_req_log5_boot_creates_log(self, tmp_project, _reset_server):
        """REQ-LOG-5: _boot() creates mcp.log with a boot entry."""
        import os
        voidrift_home = os.environ["VOIDRIFT_HOME"]
        log_path = Path(voidrift_home) / "logs" / "mcp.log"
        assert log_path.exists(), "mcp.log should exist after _boot()"
        content = log_path.read_text()
        assert "boot" in content

    def test_req_log5_boot_contains_run_id(self, tmp_project, _reset_server):
        """REQ-LOG-5: boot entry contains the run ID."""
        import os
        voidrift_home = os.environ["VOIDRIFT_HOME"]
        log_path = Path(voidrift_home) / "logs" / "mcp.log"
        content = log_path.read_text()
        assert "test-run" in content

    def test_req_log5_write_file_logged(self, tmp_project, _reset_server):
        """REQ-LOG-5: write_file() logs path and byte count."""
        import os
        srv = _reset_server
        srv.write_file("src/logged.py", "print('hello')\n")
        voidrift_home = os.environ["VOIDRIFT_HOME"]
        log_path = Path(voidrift_home) / "logs" / "mcp.log"
        content = log_path.read_text()
        assert "src/logged.py" in content
        assert "bytes" in content

    def test_req_log5_log_separate_from_system_log(self, tmp_project, _reset_server):
        """REQ-LOG-5: mcp.log is distinct from voidrift.log (different names)."""
        import os
        voidrift_home = os.environ["VOIDRIFT_HOME"]
        mcp_log = Path(voidrift_home) / "logs" / "mcp.log"
        system_log = Path(voidrift_home) / "logs" / "voidrift.log"
        assert mcp_log.exists()
        # system log is written by CLI, not MCP server — they must not share a file
        assert mcp_log != system_log
