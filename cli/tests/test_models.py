"""Tests for models.py — alias resolution from models.yml (REQ-MC-1)."""

import os
from unittest.mock import patch

import pytest

from voidrift_cli.models import resolve_model, list_models, ModelConfig, _expand_env


class TestExpandEnv:
    def test_simple_var(self, monkeypatch):
        monkeypatch.setenv("TEST_VAR", "hello")
        assert _expand_env("http://${TEST_VAR}:8000") == "http://hello:8000"

    def test_default_value(self, monkeypatch):
        monkeypatch.delenv("MISSING_VAR", raising=False)
        assert _expand_env("http://localhost:${MISSING_VAR:-8000}") == "http://localhost:8000"

    def test_no_expansion(self):
        assert _expand_env("plain-string") == "plain-string"

    def test_missing_var_empty(self, monkeypatch):
        monkeypatch.delenv("NOPE", raising=False)
        assert _expand_env("${NOPE}") == ""


class TestResolveModel:
    def test_cloud_models(self):
        m = resolve_model("claude")
        assert m.model_type == "cloud"
        assert m.model_id == "anthropic/claude-opus-4-6"
        assert m.provider == "anthropic"
        assert m.api_base is None  # Cloud models use SDK defaults

    def test_gemini(self):
        m = resolve_model("gemini")
        assert m.model_id == "gemini/gemini-2.5-pro"
        assert m.provider == "gemini"

    def test_local_model(self, monkeypatch):
        monkeypatch.setenv("WORKER_IP", "192.168.50.100")
        m = resolve_model("qwen3-coder")
        assert m.model_type == "local"
        assert m.model_id == "openai/qwen3-coder"
        assert "192.168.50.100" in m.api_base

    def test_kiro_model(self, monkeypatch):
        monkeypatch.setenv("KIRO_GATEWAY_PORT", "9999")
        monkeypatch.setenv("KIRO_API_KEY", "my-key")
        m = resolve_model("kiro-sonnet")
        assert m.model_type == "gateway"
        assert m.model_id == "openai/claude-sonnet-4-5"
        assert "9999" in m.api_base
        assert m.api_key == "my-key"

    def test_kiro_default_port(self, monkeypatch):
        monkeypatch.delenv("KIRO_GATEWAY_PORT", raising=False)
        m = resolve_model("kiro-sonnet")
        assert "8000" in m.api_base

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
