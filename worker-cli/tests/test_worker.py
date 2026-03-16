"""Tests for worker-cli models — container lifecycle, gateway, and node management."""

import os
import subprocess
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
    models_add,
    models_check,
    models_list,
    models_remove,
    models_use,
    ssh_cmd,
    ssh_stream,
    start_gateway,
    start_model,
    stop_gateway,
    stop_model,
    validate_gateway_credentials,
    worker_check,
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
    @patch("voidrift_worker.config.get_worker_config", return_value={})
    def test_missing_config_raises(self, _mock):
        with pytest.raises(RuntimeError, match="config.yml"):
            _ssh_target()

    @patch("voidrift_worker.config.get_worker_config", return_value={"user": "testuser", "ip": "10.0.0.1"})
    def test_returns_user_at_ip(self, _mock):
        assert _ssh_target() == "testuser@10.0.0.1"


class TestSshCmd:
    @patch("voidrift_worker.config.get_worker_config", return_value={})
    def test_missing_config_raises(self, _mock):
        with pytest.raises(RuntimeError, match="config.yml"):
            ssh_cmd("test")


class TestSshStream:
    @patch("voidrift_worker.models.subprocess.run")
    @patch("voidrift_worker.config.get_worker_config", return_value={"user": "u", "ip": "1.2.3.4"})
    def test_returns_exit_code(self, _mock_cfg, mock_run):
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
    @patch("voidrift_worker.config.get_worker_config", return_value={"ip": "192.168.50.100"})
    @patch("voidrift_worker.models.ssh_cmd")
    def test_active(self, mock_ssh, _mock_cfg):
        mock_ssh.return_value = MagicMock(stdout="worker-qwen3-coder\n", returncode=0)
        s = get_status()
        assert s["active"]
        assert s["model"] == "qwen3-coder"

    @patch("voidrift_worker.config.get_worker_config", return_value={"ip": "192.168.50.100"})
    @patch("voidrift_worker.models.ssh_cmd")
    def test_inactive(self, mock_ssh, _mock_cfg):
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


class TestModelsList:
    @patch("voidrift_worker.models.get_status")
    @patch("voidrift_worker.models.ssh_cmd")
    def test_shows_configured_and_cached(self, mock_ssh, mock_status):
        mock_status.return_value = {"active": False, "model": None}
        mock_ssh.return_value = MagicMock(stdout="model/Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8  31.2G\n", stderr="")
        result = models_list()
        assert "Configured Models:" in result
        assert "Cached Models:" in result
        assert "qwen3-coder" in result


class TestModelsAdd:
    @patch("voidrift_worker.models.ssh_stream")
    def test_adds_and_downloads(self, mock_stream, tmp_path, monkeypatch):
        yml = tmp_path / "worker-models.yml"
        yml.write_text("models:\n  existing:\n    repository: Some/Model\n    docker_image: img:1\n    gpu_memory_utilization: 0.85\n    max_model_len: 32768\n")
        monkeypatch.setattr("voidrift_worker.models._worker_models_path", lambda: yml)
        mock_stream.return_value = 0
        rc = models_add("new-model", "Org/New-Model")
        assert rc == 0
        import yaml
        config = yaml.safe_load(yml.read_text())
        assert "new-model" in config["models"]
        assert config["models"]["new-model"]["repository"] == "Org/New-Model"
        assert "download" in mock_stream.call_args[0][0]

    def test_duplicate_alias_raises(self, tmp_path, monkeypatch):
        yml = tmp_path / "worker-models.yml"
        yml.write_text("models:\n  qwen:\n    repository: Qwen/Qwen3\n")
        monkeypatch.setattr("voidrift_worker.models._worker_models_path", lambda: yml)
        with pytest.raises(ValueError, match="already exists"):
            models_add("qwen", "Qwen/Other")


class TestModelsRemove:
    @patch("voidrift_worker.models.ssh_stream")
    def test_retires_and_deletes(self, mock_stream, tmp_path, monkeypatch):
        yml = tmp_path / "worker-models.yml"
        yml.write_text("models:\n  qwen:\n    repository: Qwen/Qwen3\n")
        monkeypatch.setattr("voidrift_worker.models._worker_models_path", lambda: yml)
        mock_stream.return_value = 0
        rc = models_remove("qwen")
        assert rc == 0
        import yaml
        config = yaml.safe_load(yml.read_text())
        assert "qwen" not in config["models"]
        assert "qwen" in config["retired"]

    def test_unknown_alias_raises(self, tmp_path, monkeypatch):
        yml = tmp_path / "worker-models.yml"
        yml.write_text("models:\n  qwen:\n    repository: Qwen/Qwen3\n")
        monkeypatch.setattr("voidrift_worker.models._worker_models_path", lambda: yml)
        with pytest.raises(ValueError, match="not found"):
            models_remove("nonexistent")


class TestModelsUse:
    @patch("voidrift_worker.models.start_model")
    @patch("voidrift_worker.models.stop_model")
    @patch("voidrift_worker.models.get_status")
    def test_stops_running_and_starts(self, mock_status, mock_stop, mock_start):
        mock_status.return_value = {"active": True, "model": "other"}
        models_use("qwen3-coder")
        mock_stop.assert_called_once()
        mock_start.assert_called_once_with("qwen3-coder")

    def test_unknown_alias_raises(self):
        with pytest.raises(ValueError, match="Unknown alias"):
            models_use("nonexistent")


class TestModelsCheck:
    @patch("voidrift_worker.models._get_cached_repos")
    def test_all_cached(self, mock_cached):
        mock_cached.return_value = {"Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8", "Qwen/Qwen3-8B-FP8"}
        results = models_check()
        assert all(ok for _, ok, _ in results)

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._get_cached_repos")
    def test_downloads_missing(self, mock_cached, mock_stream):
        mock_cached.return_value = set()
        mock_stream.return_value = 0
        results = models_check()
        assert all(ok for _, ok, _ in results)
        assert mock_stream.call_count == len(results)


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


class TestWorkerCheck:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_all_pass(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="ok\n", stderr="", returncode=0)
        results = worker_check()
        assert len(results) == 4
        assert all(passed for _, passed, _ in results)

    @patch("voidrift_worker.models.ssh_cmd")
    def test_ssh_fail_stops_early(self, mock_ssh):
        mock_ssh.side_effect = subprocess.TimeoutExpired(cmd="ssh", timeout=5)
        results = worker_check()
        assert len(results) == 1
        assert results[0][0] == "SSH"
        assert not results[0][1]

    @patch("voidrift_worker.models.ssh_cmd")
    def test_docker_missing(self, mock_ssh):
        def side_effect(cmd):
            if "echo ok" in cmd:
                return MagicMock(stdout="ok\n", stderr="", returncode=0)
            if "docker" in cmd:
                return MagicMock(stdout="", stderr="not found", returncode=127)
            return MagicMock(stdout="ok\n", stderr="", returncode=0)
        mock_ssh.side_effect = side_effect
        results = worker_check()
        docker = next(r for r in results if r[0] == "Docker")
        assert not docker[1]
