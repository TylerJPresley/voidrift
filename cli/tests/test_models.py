"""Tests for models.py — model resolution, type detection, config loading."""

import os
from unittest.mock import patch, MagicMock

import pytest

from voidrift_cli.models import (
    resolve_model, is_kiro_model, is_local_model, ModelConfig,
    load_worker_models, CLOUD_MODELS, KIRO_MODELS,
    start_kiro_gateway, stop_kiro_gateway, validate_kiro_credentials,
    ensure_model_ready, cleanup_model, start_local_model, wait_for_local_model,
)


class TestIsKiroModel:
    def test_kiro_prefix(self):
        assert is_kiro_model("kiro-sonnet")
        assert is_kiro_model("kiro-haiku")
        assert is_kiro_model("kiro-anything")

    def test_non_kiro(self):
        assert not is_kiro_model("claude")
        assert not is_kiro_model("qwen3-coder")
        assert not is_kiro_model("gemini")


class TestIsLocalModel:
    def test_cloud_not_local(self):
        assert not is_local_model("claude")
        assert not is_local_model("gemini")

    def test_kiro_not_local(self):
        assert not is_local_model("kiro-sonnet")

    def test_local_model(self):
        # This depends on worker-models.yml being loadable
        assert is_local_model("qwen3-coder")

    def test_unknown_not_local(self):
        assert not is_local_model("totally-fake-model")


class TestResolveModel:
    def test_cloud_models(self):
        for alias in CLOUD_MODELS:
            m = resolve_model(alias)
            assert m.model_type == "cloud"
            assert m.alias == alias

    def test_claude(self):
        m = resolve_model("claude")
        assert m.model_id == "anthropic/claude-opus-4-6"
        assert m.provider == "anthropic"

    def test_gemini(self):
        m = resolve_model("gemini")
        assert m.model_id == "gemini/gemini-2.5-pro"
        assert m.provider == "gemini"

    def test_kiro_models(self):
        for alias in KIRO_MODELS:
            m = resolve_model(alias)
            assert m.model_type == "kiro"
            assert m.api_base is not None
            assert "localhost" in m.api_base
            assert m.model_id.startswith("openai/")

    def test_kiro_sonnet_mapping(self):
        m = resolve_model("kiro-sonnet")
        assert m.model_id == "openai/claude-sonnet-4-5"

    def test_kiro_uses_env_port(self, monkeypatch):
        monkeypatch.setenv("KIRO_GATEWAY_PORT", "9999")
        m = resolve_model("kiro-sonnet")
        assert "9999" in m.api_base

    def test_kiro_uses_env_key(self, monkeypatch):
        monkeypatch.setenv("KIRO_API_KEY", "my-secret")
        m = resolve_model("kiro-sonnet")
        assert m.api_key == "my-secret"

    def test_local_model(self):
        m = resolve_model("qwen3-coder")
        assert m.model_type == "local"
        assert m.model_id == "openai/qwen3-coder"
        assert m.served_model_name == "qwen3-coder"
        assert m.repository is not None

    def test_unknown_model_raises(self):
        with pytest.raises(ValueError, match="Unknown model"):
            resolve_model("nonexistent-model-xyz")

    def test_error_lists_available(self):
        with pytest.raises(ValueError) as exc_info:
            resolve_model("nope")
        msg = str(exc_info.value)
        assert "claude" in msg
        assert "qwen3-coder" in msg
        assert "kiro-sonnet" in msg


class TestLoadWorkerModels:
    def test_loads_yaml(self):
        config = load_worker_models()
        assert "models" in config
        assert "qwen3-coder" in config["models"]

    def test_worker_section(self):
        config = load_worker_models()
        assert "worker" in config
        assert "port" in config["worker"]


class TestEnsureModelReady:
    def test_cloud_noop(self, cloud_model):
        # Cloud models need no initialization — should not raise
        ensure_model_ready(cloud_model)

    @patch("voidrift_cli.models.start_kiro_gateway")
    def test_kiro_starts_gateway(self, mock_start, kiro_model):
        ensure_model_ready(kiro_model)
        mock_start.assert_called_once()

    @patch("voidrift_cli.models.start_local_model")
    @patch("voidrift_cli.models.wait_for_local_model")
    def test_local_starts_container(self, mock_wait, mock_start, local_model):
        ensure_model_ready(local_model)
        mock_start.assert_called_once()
        mock_wait.assert_called_once()


class TestCleanupModel:
    @patch("voidrift_cli.models.stop_kiro_gateway")
    def test_kiro_stops_gateway(self, mock_stop, kiro_model):
        cleanup_model(kiro_model)
        mock_stop.assert_called_once()

    def test_cloud_noop(self, cloud_model):
        cleanup_model(cloud_model)  # Should not raise

    def test_local_noop(self, local_model):
        cleanup_model(local_model)  # Should not raise


class TestStartLocalModel:
    @patch("voidrift_cli.models._ssh_cmd")
    def test_already_running_skips(self, mock_ssh, local_model):
        mock_ssh.return_value = MagicMock(stdout="worker-test-local\n", returncode=0)
        start_local_model(local_model)
        # Only the check call, no start call
        assert mock_ssh.call_count == 1

    @patch("voidrift_cli.models._ssh_cmd")
    def test_refresh_forces_restart(self, mock_ssh, local_model):
        mock_ssh.return_value = MagicMock(stdout="worker-test-local\n", returncode=0)
        start_local_model(local_model, refresh=True)
        # Should have stop + rm + start calls
        assert mock_ssh.call_count >= 3

    def test_missing_env_raises(self, local_model, monkeypatch):
        monkeypatch.delenv("WORKER_USR", raising=False)
        monkeypatch.delenv("WORKER_IP", raising=False)
        from voidrift_cli.models import _ssh_cmd
        with pytest.raises(RuntimeError, match="WORKER_USR"):
            _ssh_cmd("test")


class TestWaitForLocalModel:
    @patch("httpx.get")
    def test_ready_immediately(self, mock_get, local_model):
        mock_get.return_value = MagicMock(status_code=200)
        wait_for_local_model(local_model, timeout=5)

    @patch("httpx.get")
    def test_timeout_raises(self, mock_get, local_model):
        import httpx
        mock_get.side_effect = httpx.ConnectError("refused")
        with pytest.raises(RuntimeError, match="did not become ready"):
            wait_for_local_model(local_model, timeout=2)


class TestKiroGateway:
    @patch("httpx.get")
    def test_already_healthy_skips(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200)
        with patch("voidrift_cli.models.validate_kiro_credentials"):
            start_kiro_gateway()
        # Only the health check, no docker calls

    @patch("httpx.post")
    def test_validate_credentials_success(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        validate_kiro_credentials("8000")

    @patch("httpx.post")
    def test_validate_credentials_expired(self, mock_post):
        resp = MagicMock(status_code=500, text="refresh token expired")
        mock_post.return_value = resp
        with pytest.raises(RuntimeError, match="expired"):
            validate_kiro_credentials("8000")

    @patch("httpx.post")
    def test_validate_credentials_permissions(self, mock_post):
        resp = MagicMock(status_code=500, text="database permission denied")
        mock_post.return_value = resp
        with pytest.raises(RuntimeError, match="chmod 644"):
            validate_kiro_credentials("8000")
