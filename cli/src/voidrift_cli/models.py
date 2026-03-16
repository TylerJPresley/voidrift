"""Model configuration and management (AC-MC1 through AC-MC10, AC-KIRO1 through AC-KIRO5)."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import httpx
import yaml
from pydantic import BaseModel, Field

from .utils import VOIDRIFT_HOME

# Cloud model mappings (AC-MC1)
CLOUD_MODELS: dict[str, dict] = {
    "claude": {"model_id": "anthropic/claude-opus-4-6", "type": "cloud", "provider": "anthropic"},
    "haiku": {"model_id": "anthropic/claude-haiku-4-5-20251001", "type": "cloud", "provider": "anthropic"},
    "gemini": {"model_id": "gemini/gemini-2.5-pro", "type": "cloud", "provider": "gemini"},
    "gemini-flash": {"model_id": "gemini/gemini-2.5-flash", "type": "cloud", "provider": "gemini"},
}

# Kiro gateway model mappings (AC-KIRO1)
KIRO_MODELS: dict[str, str] = {
    "kiro-sonnet": "claude-sonnet-4-5",
    "kiro-haiku": "claude-haiku-4-5",
    "kiro-deepseek": "deepseek-v3-2",
    "kiro-minimax": "minimax-m2-1",
    "kiro-qwen": "qwen3-coder-next",
}


class ModelConfig(BaseModel):
    """Resolved model configuration."""

    alias: str
    model_id: str
    model_type: str  # "local", "cloud", "kiro"
    api_base: str | None = None
    api_key: str | None = None
    provider: str | None = None
    # Local model fields
    repository: str | None = None
    served_model_name: str | None = None
    docker_image: str | None = None
    gpu_memory_utilization: float = 0.90
    max_model_len: int = 65536
    vllm_args: list[str] | None = None


def load_worker_models() -> dict:
    """Load worker-models.yml from VOIDRIFT_HOME.

    Returns:
        Parsed YAML dict, or empty dict if file not found.
    """
    p = VOIDRIFT_HOME / "worker-models.yml"
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def is_kiro_model(alias: str) -> bool:
    """Check if model alias is a kiro gateway model (AC-KIRO1)."""
    return alias.startswith("kiro-")


def is_local_model(alias: str) -> bool:
    """Check if model alias is a local model."""
    if alias in CLOUD_MODELS or is_kiro_model(alias):
        return False
    config = load_worker_models()
    return alias in config.get("models", {})


def resolve_model(alias: str) -> ModelConfig:
    """Resolve a model alias to its full configuration.

    Args:
        alias: Model alias (e.g. ``qwen3-coder``, ``claude``, ``kiro-sonnet``).

    Returns:
        Fully populated ModelConfig.

    Raises:
        ValueError: If the alias is not recognized.
    """
    # Kiro models (AC-KIRO1)
    if is_kiro_model(alias):
        mapped = KIRO_MODELS.get(alias)
        if not mapped:
            raise ValueError(f"Unknown kiro model: {alias}. Available: {', '.join(KIRO_MODELS)}")
        port = os.environ.get("KIRO_GATEWAY_PORT", "8000")
        return ModelConfig(
            alias=alias,
            model_id=f"openai/{mapped}",
            model_type="kiro",
            api_base=f"http://localhost:{port}/v1",
            api_key=os.environ.get("KIRO_API_KEY", ""),
            provider="openai",
        )

    # Cloud models
    if alias in CLOUD_MODELS:
        info = CLOUD_MODELS[alias]
        return ModelConfig(
            alias=alias,
            model_id=info["model_id"],
            model_type="cloud",
            provider=info["provider"],
        )

    # Local models (AC-MC8a)
    config = load_worker_models()
    models = config.get("models", {})
    if alias not in models:
        all_models = list(models.keys()) + list(CLOUD_MODELS.keys()) + list(KIRO_MODELS.keys())
        raise ValueError(f"Unknown model: {alias}. Available: {', '.join(sorted(all_models))}")

    m = models[alias]
    worker_ip = os.environ.get("WORKER_IP", "")
    worker_port = config.get("worker", {}).get("port", 8000)
    return ModelConfig(
        alias=alias,
        model_id=f"openai/{m.get('served_model_name', alias)}",
        model_type="local",
        api_base=f"http://{worker_ip}:{worker_port}/v1",
        api_key=os.environ.get("OPENAI_API_KEY", "no-key-needed-here"),
        provider="openai",
        repository=m.get("repository"),
        served_model_name=m.get("served_model_name", alias),
        docker_image=m.get("docker_image"),
        gpu_memory_utilization=m.get("gpu_memory_utilization", 0.90),
        max_model_len=m.get("max_model_len", 65536),
        vllm_args=m.get("vllm_args"),
    )


def _ssh_cmd(cmd: str) -> subprocess.CompletedProcess:
    """Run a command on the worker node via SSH (AC-MC3).

    Args:
        cmd: Shell command string to execute remotely.

    Returns:
        Completed process result.

    Raises:
        RuntimeError: If WORKER_USR or WORKER_IP are not set.
    """
    user = os.environ.get("WORKER_USR", "")
    ip = os.environ.get("WORKER_IP", "")
    if not user or not ip:
        raise RuntimeError("WORKER_USR and WORKER_IP must be set for local models")
    return subprocess.run(
        ["ssh", "-o", "ConnectTimeout=5", f"{user}@{ip}", cmd],
        capture_output=True,
        text=True,
        timeout=30,
    )


def start_local_model(model: ModelConfig, refresh: bool = False) -> None:
    """Start a local model container on the worker node (AC-MC3, AC-MC9).

    Args:
        model: Resolved local model configuration.
        refresh: If True, force-restart even if already running.

    Raises:
        RuntimeError: If the container fails to start or SSH times out.
    """
    config = load_worker_models()
    worker = config.get("worker", {})
    prefix = worker.get("container_prefix", "worker-")
    container_name = f"{prefix}{model.alias}"

    # Check if already running
    if not refresh:
        try:
            r = _ssh_cmd(f"docker ps --filter name={container_name} --format '{{{{.Names}}}}'")
            if container_name in r.stdout:
                return  # Already running
        except Exception:
            pass

    # Stop existing worker containers (AC-MC9)
    try:
        _ssh_cmd(f"docker ps --filter 'name={prefix}' -q | xargs -r docker stop")
        _ssh_cmd(f"docker ps -a --filter 'name={prefix}' -q | xargs -r docker rm")
    except Exception:
        pass

    # Build docker run command
    m_config = config.get("models", {}).get(model.alias, {})
    image = m_config.get("docker_image", "scitrera/dgx-spark-vllm:0.17.0-t5")
    port = worker.get("port", 8000)

    docker_opts = worker.get("docker_options", ["--privileged", "--gpus all", "--network host"])
    cache_mounts = worker.get("cache_mounts", [])
    vllm_args = m_config.get("vllm_args", [])

    cmd_parts = ["docker", "run", "-d", f"--name {container_name}"]
    for opt in docker_opts:
        cmd_parts.append(opt)
    for mount in cache_mounts:
        cmd_parts.append(f"-v {mount}")
    cmd_parts.append(image)
    cmd_parts.append(f"--model {m_config.get('repository', '')}")
    cmd_parts.append(f"--served-model-name {m_config.get('served_model_name', model.alias)}")
    cmd_parts.append(f"--gpu-memory-utilization {m_config.get('gpu_memory_utilization', 0.90)}")
    cmd_parts.append(f"--max-model-len {m_config.get('max_model_len', 65536)}")
    cmd_parts.append(f"--port {port}")
    for arg in vllm_args:
        cmd_parts.append(arg)

    docker_cmd = " ".join(cmd_parts)

    try:
        r = _ssh_cmd(docker_cmd)
        if r.returncode != 0:
            raise RuntimeError(f"Failed to start container: {r.stderr}")
    except subprocess.TimeoutExpired:
        raise RuntimeError("SSH timeout starting container")


def wait_for_local_model(model: ModelConfig, timeout: int = 300) -> None:
    """Poll until the local model API is ready (AC-MC3).

    Args:
        model: Resolved local model configuration.
        timeout: Maximum seconds to wait.

    Raises:
        RuntimeError: If the model does not become ready within the timeout.
    """
    if not model.api_base:
        return
    url = f"{model.api_base}/models"
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = httpx.get(url, timeout=5)
            if r.status_code == 200:
                return
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(1)
    raise RuntimeError(f"Model at {url} did not become ready within {timeout}s")


def start_kiro_gateway() -> None:
    """Start the Kiro Gateway container if not running (AC-KIRO3).

    Raises:
        RuntimeError: If the gateway does not become healthy or credentials are invalid.
    """
    port = os.environ.get("KIRO_GATEWAY_PORT", "8000")

    # Fix database permissions (AC-KIRO5)
    db_path = Path.home() / ".local" / "share" / "kiro-cli" / "data.sqlite3"
    if db_path.exists():
        try:
            db_path.chmod(0o644)
        except OSError:
            pass

    # Check if already running
    try:
        r = httpx.get(f"http://localhost:{port}/health", timeout=3)
        if r.status_code == 200:
            return
    except (httpx.ConnectError, httpx.ReadTimeout):
        pass

    # Try starting via docker-compose
    gateway_dir = Path.home() / "opt" / "kiro-gateway"
    if (gateway_dir / "docker-compose.yml").exists():
        subprocess.run(
            ["docker-compose", "up", "-d"],
            cwd=gateway_dir,
            capture_output=True,
        )
    else:
        # Try starting existing stopped container
        subprocess.run(
            ["docker", "start", "kiro-gateway"],
            capture_output=True,
        )

    # Wait for health check (AC-KIRO3)
    start = time.time()
    while time.time() - start < 30:
        try:
            r = httpx.get(f"http://localhost:{port}/health", timeout=3)
            if r.status_code == 200:
                break
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(1)
    else:
        raise RuntimeError(f"Kiro Gateway did not become healthy within 30s on port {port}")

    # Validate credentials (AC-KIRO5)
    validate_kiro_credentials(port)


def validate_kiro_credentials(port: str) -> None:
    """Send a test request to verify Kiro Gateway credentials (AC-KIRO5).

    Args:
        port: Gateway port number as a string.

    Raises:
        RuntimeError: If credentials are expired, database is unreadable, or connection fails.
    """
    api_key = os.environ.get("KIRO_API_KEY", "")
    try:
        r = httpx.post(
            f"http://localhost:{port}/v1/chat/completions",
            json={
                "model": "claude-haiku-4-5",
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
            },
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if r.status_code >= 500:
            body = r.text.lower()
            if "permission" in body or "database" in body:
                raise RuntimeError(
                    "Kiro Gateway cannot read the credential database. "
                    "Fix with: chmod 644 ~/.local/share/kiro-cli/data.sqlite3"
                )
            if "refresh" in body or "token" in body or "expired" in body:
                raise RuntimeError(
                    "Kiro Gateway credentials expired. "
                    "Fix with: kiro-cli logout && kiro-cli login, then restart the gateway."
                )
            raise RuntimeError(f"Kiro Gateway credential validation failed: {r.text}")
    except httpx.ConnectError:
        raise RuntimeError(f"Cannot connect to Kiro Gateway on port {port}")


def stop_kiro_gateway() -> None:
    """Stop the Kiro Gateway container (AC-KIRO3)."""
    gateway_dir = Path.home() / "opt" / "kiro-gateway"
    if (gateway_dir / "docker-compose.yml").exists():
        subprocess.run(
            ["docker-compose", "stop"],
            cwd=gateway_dir,
            capture_output=True,
        )
    else:
        subprocess.run(["docker", "stop", "kiro-gateway"], capture_output=True)


def ensure_model_ready(model: ModelConfig, refresh: bool = False) -> None:
    """Ensure a model is ready for use (AC-KIRO3, AC-MC3).

    Args:
        model: Resolved model configuration.
        refresh: If True, force-restart local containers.
    """
    if model.model_type == "local":
        start_local_model(model, refresh=refresh)
        wait_for_local_model(model)
    elif model.model_type == "kiro":
        start_kiro_gateway()
    # Cloud models need no initialization (AC-MC6)


def cleanup_model(model: ModelConfig) -> None:
    """Clean up model resources after phase completion (AC-KIRO3)."""
    if model.model_type == "kiro":
        stop_kiro_gateway()
