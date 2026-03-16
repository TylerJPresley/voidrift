"""Tests for MCP server tools — uses real resources dir, mocks project dir."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _reset_server(tmp_project, monkeypatch):
    """Reset server module state before each test."""
    import importlib
    import voidrift_mcp.server as srv
    importlib.reload(srv)
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

    def test_get_feature_from_disk(self, _reset_server, voidrift_dir):
        spec_dir = voidrift_dir / "spec"
        spec_dir.mkdir()
        (spec_dir / "auth.md").write_text("# Auth Feature\nLogin stuff")
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


class TestGetAgent:
    def test_get_existing(self, _reset_server):
        result = _reset_server.get_agent("analyst")
        assert "Analyst" in result

    def test_get_with_topic(self, _reset_server):
        result = _reset_server.get_agent("analyst", "Your Role")
        assert "Analyst" in result

    def test_get_missing(self, _reset_server):
        result = _reset_server.get_agent("nonexistent")
        assert "not found" in result.lower()


class TestGetTemplate:
    def test_get_existing(self, _reset_server):
        result = _reset_server.get_template("adr-template")
        assert len(result) > 0

    def test_get_missing(self, _reset_server):
        result = _reset_server.get_template("nonexistent")
        assert "not found" in result.lower()
        assert "Available" in result
