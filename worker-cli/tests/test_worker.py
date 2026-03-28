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
    images_add,
    images_build,
    images_docker_list,
    images_remove,
    images_source_list,
    images_update,
    list_models,
    load_worker_models,
    models_add,
    models_check,
    models_list,
    models_remove,
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
        assert "qwen35" in models

    def test_model_has_repository(self):
        models = list_models()
        assert models["qwen35"].repository


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
        mock_ssh.return_value = MagicMock(stdout="worker-qwen35\n", returncode=0)
        # Write state file so start_model sees it as already running
        from voidrift_worker.models import _save_active_container, _active_container_path
        _save_active_container("worker-qwen35", "qwen35")
        try:
            start_model("qwen35")
            assert mock_ssh.call_count == 1
        finally:
            _active_container_path().unlink(missing_ok=True)

    def test_unknown_model_raises(self):
        with pytest.raises(ValueError, match="Unknown model"):
            start_model("nonexistent-model")

    @patch("voidrift_worker.models.ssh_cmd")
    @patch("voidrift_worker.models.httpx")
    def test_refresh_forces_restart(self, mock_httpx, mock_ssh):
        def _ssh_side_effect(cmd):
            if "docker ps --filter name=worker-qwen35 --format" in cmd:
                return MagicMock(stdout="worker-qwen35", returncode=0)
            return MagicMock(stdout="", returncode=0)
        mock_ssh.side_effect = _ssh_side_effect
        mock_get = MagicMock(status_code=200)
        mock_httpx.get.return_value = mock_get
        mock_httpx.ConnectError = Exception
        mock_httpx.ReadTimeout = Exception
        start_model("qwen35", refresh=True)
        # Verify docker run was called
        run_calls = [c for c in mock_ssh.call_args_list if "docker run" in str(c)]
        assert len(run_calls) == 1


class TestStopModel:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_stop_calls_ssh(self, mock_ssh):
        from voidrift_worker.models import _clear_active_container
        _clear_active_container()
        mock_ssh.return_value = MagicMock(returncode=0)
        stop_model()
        # No tracked container: 2 prefix safety-net calls (stop + rm)
        assert mock_ssh.call_count == 2


class TestGetStatus:
    @patch("voidrift_worker.config.get_worker_config", return_value={"ip": "192.168.50.100"})
    @patch("voidrift_worker.models.ssh_cmd")
    def test_active(self, mock_ssh, _mock_cfg):
        mock_ssh.return_value = MagicMock(stdout="worker-qwen35\n", returncode=0)
        s = get_status()
        assert s["active"]
        assert s["model"] == "qwen35"

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
        mock_ssh.return_value = MagicMock(stdout="model/Qwen/Qwen3.5-35B-A3B-FP8  31.2G\n", stderr="")
        result = models_list()
        assert "Configured Models:" in result
        assert "Cached Models:" in result
        assert "qwen35" in result


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


class TestModelsCheck:
    @patch("voidrift_worker.models._get_cached_repos")
    def test_all_cached(self, mock_cached):
        mock_cached.return_value = {
            "Qwen/Qwen3.5-35B-A3B-FP8": "37.5G",
            "Qwen/Qwen2.5-VL-72B-Instruct-FP8": "72G",
            "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8": "29G",
        }
        results, unconfigured = models_check()
        assert all(ok for _, ok, _ in results)

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._get_cached_repos")
    def test_downloads_missing(self, mock_cached, mock_stream):
        mock_cached.return_value = {}
        mock_stream.return_value = 0
        results, _ = models_check()
        assert all(ok for _, ok, _ in results)
        assert mock_stream.call_count == len(results)

    @patch("voidrift_worker.models._get_cached_repos")
    def test_reports_unconfigured(self, mock_cached):
        mock_cached.return_value = {
            "Qwen/Qwen3.5-35B-A3B-FP8": "37.5G",
            "Qwen/Qwen2.5-VL-72B-Instruct-FP8": "72G",
            "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8": "29G",
            "Extra/OldModel": "34.3G",
        }
        _, unconfigured = models_check()
        repos = [r for r, _ in unconfigured]
        assert "Extra/OldModel" in repos

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._get_cached_repos")
    def test_prune_removes_unconfigured(self, mock_cached, mock_stream):
        mock_cached.return_value = {
            "Qwen/Qwen3.5-35B-A3B-FP8": "37.5G",
            "Extra/Model": "10G",
        }
        mock_stream.return_value = 0
        _, unconfigured = models_check(prune=True)
        assert len(unconfigured) == 1
        assert "cache rm model/Extra/Model" in mock_stream.call_args[0][0]


class TestWorkerLogs:
    @patch("voidrift_worker.models.ssh_stream")
    def test_shows_logs_for_container(self, mock_stream):
        mock_stream.return_value = 0
        worker_logs(container="worker-qwen35")
        assert "worker-qwen35" in mock_stream.call_args[0][0]
        assert "--tail 200" in mock_stream.call_args[0][0]

    @patch("voidrift_worker.models.ssh_stream")
    def test_follow_flag(self, mock_stream):
        mock_stream.return_value = 0
        worker_logs(follow=True, container="worker-qwen35")
        assert "-f" in mock_stream.call_args[0][0]

    def test_no_container_raises(self):
        with pytest.raises(RuntimeError, match="NO_CONTAINER"):
            worker_logs()

    @patch("voidrift_worker.models.ssh_cmd")
    def test_list_containers(self, mock_ssh):
        mock_ssh.return_value = MagicMock(
            stdout="worker-qwen35|Up 5 minutes\nworker-qwen35-perf|Exited (0) 2 hours ago\n"
        )
        from voidrift_worker.models import _list_containers
        result = _list_containers()
        assert len(result) == 2
        assert result[0]["name"] == "worker-qwen35"
        assert "Up" in result[0]["status"]


class TestWorkerInfo:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_returns_output(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="=== GPU ===\nA100\n", stderr="")
        result = worker_info()
        assert "GPU" in result


class TestImagesAdd:
    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._save_worker_images")
    @patch("voidrift_worker.models.load_worker_images", return_value={"sources": {}})
    def test_add_git_source(self, mock_load, mock_save, mock_stream):
        mock_stream.return_value = 0
        rc = images_add("eugr", "https://github.com/eugr/spark-vllm-docker.git")
        assert rc == 0
        saved = mock_save.call_args[0][0]
        assert saved["sources"]["eugr"]["type"] == "git"
        assert mock_stream.call_count == 2  # clone + build

    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._save_worker_images")
    @patch("voidrift_worker.models.load_worker_images", return_value={"sources": {}})
    def test_add_docker_source(self, mock_load, mock_save, mock_stream):
        mock_stream.return_value = 0
        rc = images_add("scitrera", "scitrera/dgx-spark-vllm:0.17.0-t5")
        assert rc == 0
        saved = mock_save.call_args[0][0]
        assert saved["sources"]["scitrera"]["type"] == "docker"

    @patch("voidrift_worker.models.load_worker_images", return_value={"sources": {"eugr": {}}})
    def test_add_duplicate_errors(self, mock_load):
        with pytest.raises(RuntimeError, match="already exists"):
            images_add("eugr", "https://example.com/repo.git")


class TestImagesRemove:
    @patch("voidrift_worker.models.ssh_stream")
    @patch("voidrift_worker.models._save_worker_images")
    @patch("voidrift_worker.models.load_worker_images", return_value={
        "sources": {"eugr": {"type": "git", "clone_path": "~/opt/eugr", "image_name": "vllm-node"}}
    })
    @patch("voidrift_worker.models.load_worker_models", return_value={"models": {}})
    def test_remove_no_refs(self, mock_models, mock_images, mock_save, mock_stream):
        mock_stream.return_value = 0
        rc = images_remove("eugr")
        assert rc == 0

    @patch("voidrift_worker.models.load_worker_images", return_value={
        "sources": {"eugr": {"type": "git"}}
    })
    @patch("voidrift_worker.models.load_worker_models", return_value={
        "default_image": "eugr", "models": {"qwen35": {}}
    })
    def test_remove_with_refs_requires_force(self, mock_models, mock_images):
        with pytest.raises(RuntimeError, match="--force"):
            images_remove("eugr")


class TestImagesList:
    @patch("voidrift_worker.models.ssh_cmd")
    def test_docker_list(self, mock_ssh):
        mock_ssh.return_value = MagicMock(stdout="REPOSITORY  TAG  SIZE\nvllm  latest  8G\n", stderr="")
        result = images_docker_list()
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
