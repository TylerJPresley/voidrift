"""Tests for models.py — alias resolution (REQ-MC-1, REQ-MC-3)."""

from unittest.mock import patch

import pytest

from voidrift_cli.config import expand_config_refs
from voidrift_cli.models import resolve_model, list_models, ModelConfig, _synthesize_from_worker_models


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
    def test_cloud_model(self):
        m = resolve_model("claude")
        assert m.model_type == "cloud"
        assert m.model_id == "anthropic/claude-opus-4-6"
        assert m.provider == "anthropic"
        assert m.api_base is None
        assert m.max_context == 200000

    def test_gemini(self):
        m = resolve_model("gemini")
        assert m.model_id == "gemini/gemini-2.5-pro"
        assert m.provider == "gemini"
        assert m.max_context == 1048576

    def test_kiro_model(self):
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

    def test_cloud_model_no_max_context_if_unset(self):
        m = resolve_model("kiro-sonnet")
        # gateway models have no max_context in models.yml — should be None
        assert m.max_context is None


class TestWorkerModelDiscovery:
    """Tests for REQ-MC-1: local models synthesized from worker-models.yml."""

    _WORKER_MODELS = {
        "models": {
            "test-local": {
                "served_model_name": "test-local",
                "max_model_len": 65536,
            }
        },
        "worker": {"port": 8000},
    }

    @patch("voidrift_cli.models._load_models_config", return_value={"models": {}})
    @patch("voidrift_cli.models._synthesize_from_worker_models",
           return_value={"test-local": {
               "model_id": "openai/test-local",
               "base_url": "http://192.168.1.1:8000/v1",
               "api_key": "no-key",
               "type": "local",
               "max_context": 65536,
           }})
    def test_req_mc1_resolves_worker_only_alias(self, _synth, _models):
        """REQ-MC-1: alias from worker-models.yml resolves without models.yml entry."""
        m = resolve_model("test-local")
        assert m.model_type == "local"
        assert m.model_id == "openai/test-local"
        assert m.api_base == "http://192.168.1.1:8000/v1"
        assert m.max_context == 65536

    @patch("voidrift_cli.models._load_models_config",
           return_value={"models": {"test-local": {
               "model_id": "openai/override",
               "base_url": "http://override:9999/v1",
               "api_key": "key",
               "type": "local",
           }}})
    @patch("voidrift_cli.models._synthesize_from_worker_models",
           return_value={"test-local": {
               "model_id": "openai/test-local",
               "base_url": "http://192.168.1.1:8000/v1",
               "api_key": "no-key",
               "type": "local",
           }})
    def test_req_mc1_explicit_takes_precedence(self, _synth, _models):
        """REQ-MC-1: models.yml entry overrides worker-models.yml synthesis."""
        m = resolve_model("test-local")
        assert m.api_base == "http://override:9999/v1"
        assert m.model_id == "openai/override"

    @patch("voidrift_cli.models._load_models_config", return_value={"models": {}})
    @patch("voidrift_cli.models._synthesize_from_worker_models",
           return_value={"test-local": {
               "model_id": "openai/test-local",
               "base_url": "http://192.168.1.1:8000/v1",
               "api_key": "no-key",
               "type": "local",
           }})
    def test_req_mc1_list_includes_worker_models(self, _synth, _models):
        """REQ-MC-1: list_models() includes synthesized worker aliases."""
        models = list_models()
        assert "test-local" in models

    def test_synth_returns_empty_without_worker_ip(self):
        """_synthesize_from_worker_models returns {} when worker.ip is unset."""
        with patch("voidrift_cli.config.get_worker_config", return_value={}):
            result = _synthesize_from_worker_models()
        assert result == {}

    def test_synth_returns_empty_without_worker_models_file(self, tmp_path, monkeypatch):
        """_synthesize_from_worker_models returns {} when worker-models.yml is missing."""
        monkeypatch.setenv("VOIDRIFT_HOME", str(tmp_path))
        from voidrift_cli.config import clear_config_cache
        clear_config_cache()
        with patch("voidrift_cli.config.get_worker_config", return_value={"ip": "192.168.1.1"}):
            result = _synthesize_from_worker_models()
        assert result == {}


class TestMaxContext:
    """Tests for REQ-MC-3: max_context field from models.yml."""

    def test_req_mc3_max_context_on_cloud_model(self):
        """REQ-MC-3: max_context from models.yml is populated on ModelConfig."""
        m = resolve_model("claude")
        assert m.max_context == 200000

    def test_req_mc3_max_context_none_when_unset(self):
        """REQ-MC-3: max_context is None when not present in models.yml."""
        m = resolve_model("kiro-sonnet")
        assert m.max_context is None

    @patch("voidrift_cli.models._merged_models", return_value={
        "no-ctx": {"model_id": "openai/x", "type": "cloud"}
    })
    def test_req_mc3_max_context_none_if_missing_from_entry(self, _):
        m = resolve_model("no-ctx")
        assert m.max_context is None


class TestListModels:
    def test_returns_sorted(self):
        models = list_models()
        assert models == sorted(models)

    def test_includes_cloud_types(self):
        models = list_models()
        assert "claude" in models
        assert "kiro-sonnet" in models
