"""Shared fixtures for CLI tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
os.environ["VOIDRIFT_HOME"] = str(REPO_ROOT)


@pytest.fixture(autouse=True)
def _clear_config_cache():
    """Clear config cache before each test so env var changes take effect."""
    from voidrift_cli.config import clear_config_cache
    clear_config_cache()
    yield
    clear_config_cache()


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


@pytest.fixture
def sample_tasks(voidrift_dir):
    """Write a sample TASKS.md and return its path."""
    tf = voidrift_dir / "TASKS.md"
    tf.write_text(
        "# Feature: Sample\n\n## Tasks\n"
        "- [x] Create src/main.py: entry point [backend]\n"
        "- [ ] Create src/utils.py: helpers [backend, tdd]\n"
        "- [ ] Create tests/test_main.py: unit tests [tdd]\n"
        "- [!] Create src/broken.py: blocked task [backend]\n"
    )
    return tf


@pytest.fixture
def sample_requirements(voidrift_dir):
    """Write a minimal REQUIREMENTS.md and return its path."""
    rf = voidrift_dir / "REQUIREMENTS.md"
    rf.write_text("# Requirements\n\n## Goal\nA test project.\n\n## Features\n- Feature A\n")
    return rf


@pytest.fixture
def cloud_model():
    """A cloud ModelConfig that needs no infrastructure."""
    from voidrift_cli.models import ModelConfig
    return ModelConfig(
        alias="test-cloud",
        model_id="test-model",
        model_type="cloud",
        provider="openai",
        api_base="http://localhost:19999/v1",
        api_key="test-key",
    )


@pytest.fixture
def local_model():
    """A local ModelConfig."""
    from voidrift_cli.models import ModelConfig
    return ModelConfig(
        alias="test-local",
        model_id="openai/test-local",
        model_type="local",
        api_base="http://192.168.50.100:8000/v1",
        api_key="no-key",
    )


@pytest.fixture
def kiro_model():
    """A kiro gateway ModelConfig."""
    from voidrift_cli.models import ModelConfig
    return ModelConfig(
        alias="kiro-sonnet",
        model_id="openai/claude-sonnet-4-5",
        model_type="gateway",
        api_base="http://localhost:8000/v1",
        api_key="test-kiro-key",
        provider="openai",
    )
