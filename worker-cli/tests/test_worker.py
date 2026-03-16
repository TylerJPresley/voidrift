"""Tests for worker-cli models — container lifecycle and gateway management."""

import os
from unittest.mock import patch, MagicMock

import pytest

from voidrift_worker.models import (
    list_models,
    load_worker_models,
    ssh_cmd,
    start_model,
    stop_model,
    get_status,
    start_gateway,
    stop_gateway,
    validate_gateway_credentials,
    get_gateway_status,
)


class TestListModels:
    def test_loads_from_yaml(self):
        models = list_models()
        assert "qwen3-coder" in models

    def test_model_has_repository(self):
        models = list_models()
        assert models["qwen3-coder"].repository


class TestLoadWorkerModels:
    def test_loads_yaml(self):
        config = load_worker_models()
        assert "models" in config

    def test_worker_section(self):
        config = load_worker_models()
        assert "worker" in config


class TestSshCmd:
    def test_missing_env_raises(self, monkeypatch):
        monkeypatch.delenv("WORKER_USR", raising=False)
        monkeypatch.delenv("WORKER_IP", raising=False)
        with pytest.raises(RuntimeError, match="WORKER_USR"):
            ssh_cmd("test")


class TestStartModel:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_already_running_skips(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="worker-qwen3-coder\n", returncode=0)
        start_model("qwen3-coder")
        assert mock_ssh.call_count == 1  # Only the check call

    def test_unknown_model_raises(self):
        with pytest.raises(ValueError, match="Unknown model"):
            start_model("nonexistent-model")

    @patch("voidrift_worker.models.ssh_cmd")
    @patch("voidrift_worker.models.httpx")
    def test_refresh_forces_restart(self, mock_httpx, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="", returncode=0)
        mock_get = MagicMock(status_code=200)
        mock_httpx.get.return_value = mock_get
        mock_httpx.ConnectError = Exception
        mock_httpx.ReadTimeout = Exception
        start_model("qwen3-coder", refresh=True)
        assert mock_ssh.call_count >= 3  # stop + rm + start


class TestStopModel:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_stop_calls_ssh(self, mock_ssh):
        mock_ssh.return_value = MagicMock(returncode=0)
        stop_model()
        assert mock_ssh.call_count == 2  # stop + rm


class TestGetStatus:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_active(self, mock_ssh, monkeypatch):
        monkeypatch.setenv("WORKER_IP", "192.168.50.100")
        mock_ssh.return_value = MagicMock(stdout="worker-qwen3-coder\n", returncode=0)
        s = get_status()
        assert s["active"]
        assert s["model"] == "qwen3-coder"

    @patch("voidrift_worker.models.ssh_cmd")
    def test_inactive(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="", returncode=0)
        s = get_status()
        assert not s["active"]


class TestGateway:
    @patch("voidrift_worker.models.httpx")
    def test_already_healthy_skips(self, mock_httpx):
        mock_get = MagicMock(status_code=200)
        mock_httpx.get.return_value = mock_get
        mock_httpx.ConnectError = Exception
        mock_httpx.ReadTimeout = Exception
        with patch("voidrift_worker.models.validate_gateway_credentials"):
            start_gateway()

    @patch("httpx.post")
    def test_validate_credentials_success(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        validate_gateway_credentials("8000")

    @patch("httpx.post")
    def test_validate_credentials_expired(self, mock_post):
        mock_post.return_value = MagicMock(status_code=500, text="refresh token expired")
        with pytest.raises(RuntimeError, match="expired"):
            validate_gateway_credentials("8000")

    @patch("httpx.post")
    def test_validate_credentials_permissions(self, mock_post):
        mock_post.return_value = MagicMock(status_code=500, text="database permission denied")
        with pytest.raises(RuntimeError, match="chmod 644"):
            validate_gateway_credentials("8000")

    @patch("httpx.get")
    def test_gateway_status_active(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200)
        s = get_gateway_status()
        assert s["active"]

    @patch("httpx.get")
    def test_gateway_status_inactive(self, mock_get):
        import httpx
        mock_get.side_effect = httpx.ConnectError("refused")
        s = get_gateway_status()
        assert not s["active"]
