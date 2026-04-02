"""Shared fixtures for CLI tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
os.environ.setdefault("VOIDRIFT_HOME", str(Path.home() / ".voidrift"))


@pytest.fixture(autouse=True)
def _clear_config_cache():
    """Clear config cache before each test so env var changes take effect."""
    from voidrift_cli.config import clear_config_cache
    clear_config_cache()
    yield
    clear_config_cache()


@pytest.fixture(autouse=True)
def _clear_resource_caches():
    """Clear skills and prompts in-process caches before each test."""
    from voidrift_cli.skills import clear_cache as clear_skills
    from voidrift_cli.prompts import clear_cache as clear_prompts
    clear_skills()
    clear_prompts()
    yield
    clear_skills()
    clear_prompts()


@pytest.fixture
def tmp_project(tmp_path, monkeypatch):
    """Create a temporary project directory with .voidrift/ and chdir into it."""
    project = tmp_path / "project"
    project.mkdir()
    (project / ".voidrift").mkdir()
    monkeypatch.chdir(project)
    monkeypatch.setenv("VOIDRIFT_HOME", os.environ.get("VOIDRIFT_HOME", str(Path.home() / ".voidrift")))
    return project


@pytest.fixture
def voidrift_dir(tmp_project):
    """Return the .voidrift/ directory inside the temp project."""
    return tmp_project / ".voidrift"


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
    """A local ModelConfig with conservative limits."""
    from voidrift_cli.models import ModelConfig
    return ModelConfig(
        alias="test-local",
        model_id="openai/test-local",
        model_type="local",
        api_base="http://192.168.50.100:8000/v1",
        api_key="no-key",
        max_tokens=4096,
        max_input_chars=8000,
        concurrency=1,
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
