"""Shared fixtures for MCP context server tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
os.environ.setdefault("VOIDRIFT_HOME", str(REPO_ROOT))


@pytest.fixture
def tmp_project(tmp_path, monkeypatch):
    """Create a temporary project directory with .voidrift/ and chdir into it."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".voidrift").mkdir()
    voidrift_home = tmp_path / "voidrift_home"
    voidrift_home.mkdir()
    # Copy resources from repo so _boot() can load them
    import shutil
    src_resources = REPO_ROOT / "resources"
    if src_resources.is_dir():
        shutil.copytree(src_resources, voidrift_home / "resources")
    monkeypatch.chdir(project)
    monkeypatch.setenv("VOIDRIFT_HOME", str(voidrift_home))
    return project


@pytest.fixture
def voidrift_dir(tmp_project):
    """Return the .voidrift/ directory inside the temp project."""
    return tmp_project / ".voidrift"
