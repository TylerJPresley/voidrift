"""Tests for models.py — alias resolution (REQ-MC-1, REQ-MC-3)."""

from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from voidrift_cli.config import expand_config_refs
from voidrift_cli.models import resolve_model, list_models, ModelConfig


# Sample models file content for tests
_SAMPLE_MODELS = {
    "models": {
        "claude": {
            "model_id": "anthropic/claude-opus-4-6",
            "type": "cloud",
            "provider": "anthropic",
            "max_context": 200000,
        },
        "qwen35": {
            "model_id": "qwen35",
            "base_url": "http://192.168.50.100:8000/v1",
            "api_key": "${OPENAI_API_KEY:-no-key}",
            "type": "local",
            "max_context": 262144,
        },
        "kiro-sonnet": {
            "model_id": "openai/claude-sonnet-4.6",
            "base_url": "http://localhost:8000/v1",
            "api_key": "test-key",
            "type": "gateway",
            "max_context": 1048576,
        },
    }
}


@pytest.fixture
def models_file(tmp_path):
    """Write a sample models file and patch get_models_file to return it."""
    p = tmp_path / "models.yml"
    p.write_text(yaml.dump(_SAMPLE_MODELS))
    with patch("voidrift_cli.models.get_models_file", return_value=p):
        yield p


class TestExpandConfigRefs:
    def test_env_var(self, monkeypatch):
        monkeypatch.setenv("TEST_VAR", "hello")
        assert expand_config_refs("http://${TEST_VAR}:8000") == "http://hello:8000"

    def test_default_value(self, monkeypatch):
        monkeypatch.delenv("MISSING_VAR", raising=False)
        assert expand_config_refs("http://localhost:${MISSING_VAR:-8000}") == "http://localhost:8000"

    def test_no_expansion(self):
        assert expand_config_refs("plain-string") == "plain-string"

    def test_missing_var_empty(self, monkeypatch):
        monkeypatch.delenv("NOPE", raising=False)
        assert expand_config_refs("${NOPE}") == ""

    @patch("voidrift_cli.config.load_config", return_value={"worker": {"ip": "10.0.0.1"}})
    def test_config_ref(self, _mock):
        assert expand_config_refs("http://${worker.ip}:8000") == "http://10.0.0.1:8000"

    @patch("voidrift_cli.config.load_config", return_value={"kiro": {"port": 9999}})
    def test_config_ref_int(self, _mock):
        assert expand_config_refs("http://localhost:${kiro.port}/v1") == "http://localhost:9999/v1"


class TestResolveModel:
    """REQ-MC-1: alias resolution from configured models file."""

    def test_cloud_model(self, models_file):
        m = resolve_model("claude")
        assert m.model_type == "cloud"
        assert m.model_id == "anthropic/claude-opus-4-6"
        assert m.provider == "anthropic"
        assert m.max_context == 200000

    def test_local_model(self, models_file):
        m = resolve_model("qwen35")
        assert m.model_type == "local"
        assert m.api_base == "http://192.168.50.100:8000/v1"
        assert m.max_context == 262144

    def test_gateway_model(self, models_file):
        m = resolve_model("kiro-sonnet")
        assert m.model_type == "gateway"
        assert m.model_id == "openai/claude-sonnet-4.6"
        assert m.max_context == 1048576

    def test_unknown_model_raises(self, models_file):
        with pytest.raises(ValueError, match="Unknown model"):
            resolve_model("nonexistent-model-xyz")

    def test_error_lists_available(self, models_file):
        with pytest.raises(ValueError) as exc_info:
            resolve_model("nope")
        msg = str(exc_info.value)
        assert "claude" in msg

    def test_missing_models_file_raises(self, tmp_path):
        """REQ-MC-1: missing models file means no models available."""
        missing = tmp_path / "nope.yml"
        with patch("voidrift_cli.models.get_models_file", return_value=missing):
            with pytest.raises(ValueError, match="Unknown model"):
                resolve_model("claude")


class TestMaxContext:
    """REQ-MC-3: max_context field from models file."""

    def test_max_context_populated(self, models_file):
        m = resolve_model("claude")
        assert m.max_context == 200000

    def test_max_context_none_when_unset(self, tmp_path):
        """REQ-MC-3: max_context is None when not in entry."""
        p = tmp_path / "models.yml"
        p.write_text(yaml.dump({"models": {"bare": {"model_id": "x", "type": "cloud"}}}))
        with patch("voidrift_cli.models.get_models_file", return_value=p):
            m = resolve_model("bare")
        assert m.max_context is None


class TestListModels:
    def test_returns_sorted(self, models_file):
        models = list_models()
        assert models == sorted(models)

    def test_includes_all_types(self, models_file):
        models = list_models()
        assert "claude" in models
        assert "qwen35" in models
        assert "kiro-sonnet" in models

    def test_empty_when_no_file(self, tmp_path):
        missing = tmp_path / "nope.yml"
        with patch("voidrift_cli.models.get_models_file", return_value=missing):
            assert list_models() == []
