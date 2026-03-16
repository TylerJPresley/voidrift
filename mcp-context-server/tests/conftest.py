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
    monkeypatch.chdir(project)
    monkeypatch.setenv("VOIDRIFT_PROJECT_DIR", str(project))
    monkeypatch.setenv("VOIDRIFT_HOME", str(REPO_ROOT))
    return project


@pytest.fixture
def voidrift_dir(tmp_project):
    """Return the .voidrift/ directory inside the temp project."""
    return tmp_project / ".voidrift"
