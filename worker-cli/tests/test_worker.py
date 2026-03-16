"""Tests for worker-cli models — container lifecycle, gateway, and node management."""

import os
from unittest.mock import patch, MagicMock

import pytest

from voidrift_worker.models import (
    _ssh_target,
    cache_clear,
    get_gateway_status,
    get_status,
    images_list,
    images_pull,
    list_models,
    load_worker_models,
    models_fix_perms,
    models_list_cached,
    models_prune,
    models_pull,
    models_remove,
    ssh_cmd,
    ssh_stream,
    start_gateway,
    start_model,
    stop_gateway,
    stop_model,
    validate_gateway_credentials,
    worker_info,
    worker_logs,
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


class TestSshTarget:
    def test_missing_env_raises(self, monkeypatch):
        monkeypatch.delenv("WORKER_USR", raising=False)
        monkeypatch.delenv("WORKER_IP", raising=False)
        with pytest.raises(RuntimeError, match="WORKER_USR"):
            _ssh_target()

    def test_returns_user_at_ip(self, monkeypatch):
        monkeypatch.setenv("WORKER_USR", "testuser")
        monkeypatch.setenv("WORKER_IP", "10.0.0.1")
        assert _ssh_target() == "testuser@10.0.0.1"


class TestSshCmd:
    def test_missing_env_raises(self, monkeypatch):
        monkeypatch.delenv("WORKER_USR", raising=False)
        monkeypatch.delenv("WORKER_IP", raising=False)
        with pytest.raises(RuntimeError, match="WORKER_USR"):
            ssh_cmd("test")


class TestSshStream:
    @patch("voidrift_worker.models.subprocess.run")
    def test_returns_exit_code(self, mock_run, monkeypatch):
        monkeypatch.setenv("WORKER_USR", "u")
        monkeypatch.setenv("WORKER_IP", "1.2.3.4")
        mock_run.return_value = MagicMock(returncode=0)
        assert ssh_stream("echo hi") == 0


class TestStartModel:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_already_running_skips(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="worker-qwen3-coder\n", returncode=0)
        start_model("qwen3-coder")
        assert mock_ssh.call_count == 1

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
        assert mock_ssh.call_count >= 3


class TestStopModel:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_stop_calls_ssh(self, mock_ssh):
        mock_ssh.return_value = MagicMock(returncode=0)
        stop_model()
        assert mock_ssh.call_count == 2


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


# --- Worker node management tests ---


class TestModelsListCached:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_returns_output(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="REPO  REVISION  SIZE\nQwen  abc123  5.2G\n", stderr="")
        result = models_list_cached()
        assert "Qwen" in result


class TestModelsPull:
    def test_unknown_alias_raises(self):
        with pytest.raises(ValueError, match="Unknown alias"):
            models_pull("nonexistent")

    @patch("voidrift_worker.models.ssh_stream")
    def test_resolves_repo(self, mock_stream):
        mock_stream.return_value = 0
        rc = models_pull("qwen3-coder")
        assert rc == 0
        assert "Qwen/Qwen3-Coder" in mock_stream.call_args[0][0]


class TestModelsRemove:
    @patch("voidrift_worker.models.ssh_stream")
    def test_calls_cache_rm(self, mock_stream):
        mock_stream.return_value = 0
        rc = models_remove("abc123")
        assert rc == 0
        assert "cache rm abc123" in mock_stream.call_args[0][0]


class TestModelsPrune:
    @patch("voidrift_worker.models.ssh_stream")
    def test_calls_prune(self, mock_stream):
        mock_stream.return_value = 0
        rc = models_prune()
        assert rc == 0
        assert "prune" in mock_stream.call_args[0][0]


class TestModelsFixPerms:
    @patch("voidrift_worker.models.ssh_stream")
    def test_calls_chmod(self, mock_stream):
        mock_stream.return_value = 0
        rc = models_fix_perms()
        assert rc == 0
        assert "chmod" in mock_stream.call_args[0][0]


class TestWorkerLogs:
    @patch("voidrift_worker.models.get_status")
    def test_no_container_raises(self, mock_status):
        mock_status.return_value = {"active": False}
        with pytest.raises(RuntimeError, match="No active"):
            worker_logs()

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models.get_status")
    def test_follow_flag(self, mock_status, mock_stream):
        mock_status.return_value = {"active": True, "container": "worker-qwen3-coder"}
        mock_stream.return_value = 0
        worker_logs(follow=True)
        assert "-f" in mock_stream.call_args[0][0]

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models.get_status")
    def test_tail_default(self, mock_status, mock_stream):
        mock_status.return_value = {"active": True, "container": "worker-qwen3-coder"}
        mock_stream.return_value = 0
        worker_logs()
        assert "--tail 200" in mock_stream.call_args[0][0]


class TestWorkerInfo:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_returns_output(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="=== GPU ===\nA100\n", stderr="")
        result = worker_info()
        assert "GPU" in result


class TestImagesPull:
    @patch("voidrift_worker.models.ssh_stream")
    def test_default_image(self, mock_stream):
        mock_stream.return_value = 0
        rc = images_pull()
        assert rc == 0
        assert "docker pull" in mock_stream.call_args[0][0]

    @patch("voidrift_worker.models.ssh_stream")
    def test_explicit_image(self, mock_stream):
        mock_stream.return_value = 0
        rc = images_pull("vllm/vllm-openai:latest")
        assert rc == 0
        assert "vllm/vllm-openai:latest" in mock_stream.call_args[0][0]


class TestImagesList:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_returns_output(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="REPOSITORY  TAG  SIZE\nvllm  latest  8G\n", stderr="")
        result = images_list()
        assert "vllm" in result


class TestCacheClear:
    @patch("voidrift_worker.models.ssh_stream")
    def test_clears_caches(self, mock_stream):
        mock_stream.return_value = 0
        rc = cache_clear()
        assert rc == 0
        assert "flashinfer" in mock_stream.call_args[0][0]
        assert "vllm" in mock_stream.call_args[0][0]
