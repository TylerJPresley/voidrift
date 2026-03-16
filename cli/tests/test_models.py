"""Tests for models.py — alias resolution from models.yml (REQ-MC-1)."""

from unittest.mock import patch

import pytest

from voidrift_cli.config import expand_config_refs
from voidrift_cli.models import resolve_model, list_models, ModelConfig


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
    def test_cloud_models(self):
        m = resolve_model("claude")
        assert m.model_type == "cloud"
        assert m.model_id == "anthropic/claude-opus-4-6"
        assert m.provider == "anthropic"
        assert m.api_base is None

    def test_gemini(self):
        m = resolve_model("gemini")
        assert m.model_id == "gemini/gemini-2.5-pro"
        assert m.provider == "gemini"

    def test_local_model(self):
        """Local model resolves worker.ip from config.yml."""
        m = resolve_model("qwen3-coder")
        assert m.model_type == "local"
        assert m.model_id == "openai/qwen3-coder"
        assert m.api_base is not None

    def test_kiro_model(self):
        """Kiro model resolves kiro.port and kiro.api_key from config.yml."""
        m = resolve_model("kiro-sonnet")
        assert m.model_type == "gateway"
        assert m.model_id == "openai/claude-sonnet-4.5"

    def test_unknown_model_raises(self):
        with pytest.raises(ValueError, match="Unknown model"):
            resolve_model("nonexistent-model-xyz")

    def test_error_lists_available(self):
        with pytest.raises(ValueError) as exc_info:
            resolve_model("nope")
        msg = str(exc_info.value)
        assert "claude" in msg
        assert "qwen3-coder" in msg


class TestListModels:
    def test_returns_sorted(self):
        models = list_models()
        assert models == sorted(models)

    def test_includes_all_types(self):
        models = list_models()
        assert "claude" in models
        assert "qwen3-coder" in models
        assert "kiro-sonnet" in models
