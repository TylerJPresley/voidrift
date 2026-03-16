"""Model configuration and container lifecycle (REQ-WK-2 through REQ-WK-10)."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import httpx
import yaml
from pydantic import BaseModel, Field


def _worker_models_path() -> Path:
    """Return path to worker-models.yml."""
    return Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift")) / "worker-models.yml"


def load_worker_models() -> dict:
    """Load worker-models.yml.

    Returns:
        Parsed YAML dict, or empty dict if file not found.
    """
    p = _worker_models_path()
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


class ModelConfig(BaseModel):
    """Local model configuration from worker-models.yml."""

    alias: str
    repository: str
    served_model_name: str
    docker_image: str = "scitrera/dgx-spark-vllm:0.17.0-t5"
    gpu_memory_utilization: float = 0.90
    max_model_len: int = 65536
    vllm_args: list[str] = Field(default_factory=list)


def list_models() -> dict[str, ModelConfig]:
    """List all configured local models (REQ-WK-6).

    Returns:
        Dict of alias → ModelConfig.
    """
    config = load_worker_models()
    models = config.get("models", {})
    result = {}
    for alias, m in models.items():
        result[alias] = ModelConfig(
            alias=alias,
            repository=m.get("repository", ""),
            served_model_name=m.get("served_model_name", alias),
            docker_image=m.get("docker_image", "scitrera/dgx-spark-vllm:0.17.0-t5"),
            gpu_memory_utilization=m.get("gpu_memory_utilization", 0.90),
            max_model_len=m.get("max_model_len", 65536),
            vllm_args=m.get("vllm_args", []),
        )
    return result


def _ssh_target() -> str:
    """Return user@ip SSH target string.

    Raises:
        RuntimeError: If WORKER_USR or WORKER_IP are not set.
    """
    user = os.environ.get("WORKER_USR", "")
    ip = os.environ.get("WORKER_IP", "")
    if not user or not ip:
        raise RuntimeError("WORKER_USR and WORKER_IP must be set for local models")
    return f"{user}@{ip}"


_SSH_PATH_PREFIX = "export PATH=$HOME/.local/bin:$PATH && "


def ssh_cmd(cmd: str) -> subprocess.CompletedProcess:
    """Run a command on the worker node via SSH (REQ-WK-2).

    Args:
        cmd: Shell command string to execute remotely.

    Returns:
        Completed process result.

    Raises:
        RuntimeError: If WORKER_USR or WORKER_IP are not set.
    """
    return subprocess.run(
        ["ssh", "-o", "ConnectTimeout=5", _ssh_target(), _SSH_PATH_PREFIX + cmd],
        capture_output=True,
        text=True,
        timeout=30,
    )


def ssh_stream(cmd: str, timeout: int = 600) -> int:
    """Run a command on the worker node via SSH, streaming output to stdout.

    Args:
        cmd: Shell command string to execute remotely.
        timeout: Max seconds to wait (default 600).

    Returns:
        Exit code from the remote command.

    Raises:
        RuntimeError: If WORKER_USR or WORKER_IP are not set.
    """
    result = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=5", _ssh_target(), _SSH_PATH_PREFIX + cmd],
        timeout=timeout,
    )
    return result.returncode


def start_model(alias: str, refresh: bool = False) -> None:
    """Start a local model container on the worker node (REQ-WK-2, REQ-WK-7).

    Args:
        alias: Model alias from worker-models.yml.
        refresh: If True, force-restart even if already running.

    Raises:
        RuntimeError: If the container fails to start or SSH times out.
        ValueError: If the alias is not found.
    """
    models = list_models()
    if alias not in models:
        raise ValueError(f"Unknown model: {alias}. Available: {', '.join(sorted(models))}")

    model = models[alias]
    config = load_worker_models()
    worker = config.get("worker", {})
    prefix = worker.get("container_prefix", "worker-")
    container_name = f"{prefix}{alias}"

    # Check if already running
    if not refresh:
        try:
            r = ssh_cmd(f"docker ps --filter name={container_name} --format '{{{{.Names}}}}'")
            if container_name in r.stdout:
                return
        except (subprocess.SubprocessError, OSError):
            pass

    # Stop existing worker containers (REQ-WK-7)
    try:
        ssh_cmd(f"docker ps --filter 'name={prefix}' -q | xargs -r docker stop")
        ssh_cmd(f"docker ps -a --filter 'name={prefix}' -q | xargs -r docker rm")
    except (subprocess.SubprocessError, OSError):
        pass

    # Build docker run command
    port = worker.get("port", 8000)
    docker_opts = worker.get("docker_options", ["--privileged", "--gpus all", "--network host"])
    cache_mounts = worker.get("cache_mounts", [])

    cmd_parts = ["docker", "run", "-d", f"--name {container_name}"]
    for opt in docker_opts:
        cmd_parts.append(opt)
    for mount in cache_mounts:
        cmd_parts.append(f"-v {mount}")
    cmd_parts.append(model.docker_image)
    cmd_parts.append(f"--model {model.repository}")
    cmd_parts.append(f"--served-model-name {model.served_model_name}")
    cmd_parts.append(f"--gpu-memory-utilization {model.gpu_memory_utilization}")
    cmd_parts.append(f"--max-model-len {model.max_model_len}")
    cmd_parts.append(f"--port {port}")
    for arg in model.vllm_args:
        cmd_parts.append(arg)

    try:
        r = ssh_cmd(" ".join(cmd_parts))
        if r.returncode != 0:
            raise RuntimeError(f"Failed to start container: {r.stderr}")
    except subprocess.TimeoutExpired:
        raise RuntimeError("SSH timeout starting container")

    # Wait for API ready
    worker_ip = os.environ.get("WORKER_IP", "")
    url = f"http://{worker_ip}:{port}/v1/models"
    start_time = time.time()
    while time.time() - start_time < 300:
        try:
            r = httpx.get(url, timeout=5)
            if r.status_code == 200:
                return
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(1)
    raise RuntimeError(f"Model at {url} did not become ready within 300s")


def stop_model() -> None:
    """Stop the active model container (REQ-WK-3)."""
    config = load_worker_models()
    prefix = config.get("worker", {}).get("container_prefix", "worker-")
    try:
        ssh_cmd(f"docker ps --filter 'name={prefix}' -q | xargs -r docker stop")
        ssh_cmd(f"docker ps -a --filter 'name={prefix}' -q | xargs -r docker rm")
    except (subprocess.SubprocessError, OSError) as e:
        raise RuntimeError(f"Failed to stop container: {e}") from e


def get_status() -> dict:
    """Get active model status (REQ-WK-4).

    Returns:
        Dict with keys: active (bool), container (str|None), model (str|None), url (str|None).
    """
    config = load_worker_models()
    worker = config.get("worker", {})
    prefix = worker.get("container_prefix", "worker-")
    port = worker.get("port", 8000)
    worker_ip = os.environ.get("WORKER_IP", "")

    try:
        r = ssh_cmd(f"docker ps --filter 'name={prefix}' --format '{{{{.Names}}}}'")
        container = r.stdout.strip().split("\n")[0] if r.stdout.strip() else None
    except (subprocess.SubprocessError, OSError, RuntimeError):
        container = None

    if not container:
        return {"active": False, "container": None, "model": None, "url": None}

    # Extract alias from container name
    alias = container.replace(prefix, "") if container.startswith(prefix) else container
    url = f"http://{worker_ip}:{port}/v1"

    return {"active": True, "container": container, "model": alias, "url": url}


def start_gateway() -> None:
    """Start the Kiro Gateway container (REQ-WK-9).

    Raises:
        RuntimeError: If the gateway does not become healthy or credentials are invalid.
    """
    port = os.environ.get("KIRO_GATEWAY_PORT", "8000")

    # Fix database permissions
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
        subprocess.run(["docker-compose", "up", "-d"], cwd=gateway_dir, capture_output=True)
    else:
        subprocess.run(["docker", "start", "kiro-gateway"], capture_output=True)

    # Wait for health check
    start_time = time.time()
    while time.time() - start_time < 30:
        try:
            r = httpx.get(f"http://localhost:{port}/health", timeout=3)
            if r.status_code == 200:
                break
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(1)
    else:
        raise RuntimeError(f"Kiro Gateway did not become healthy within 30s on port {port}")

    # Validate credentials (REQ-WK-10)
    validate_gateway_credentials(port)


def stop_gateway() -> None:
    """Stop the Kiro Gateway container (REQ-WK-9)."""
    gateway_dir = Path.home() / "opt" / "kiro-gateway"
    if (gateway_dir / "docker-compose.yml").exists():
        subprocess.run(["docker-compose", "stop"], cwd=gateway_dir, capture_output=True)
    else:
        subprocess.run(["docker", "stop", "kiro-gateway"], capture_output=True)


def validate_gateway_credentials(port: str) -> None:
    """Send a test request to verify Kiro Gateway credentials (REQ-WK-10).

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


def get_gateway_status() -> dict:
    """Get Kiro Gateway status (REQ-WK-9).

    Returns:
        Dict with keys: active (bool), url (str|None).
    """
    port = os.environ.get("KIRO_GATEWAY_PORT", "8000")
    try:
        r = httpx.get(f"http://localhost:{port}/health", timeout=3)
        if r.status_code == 200:
            return {"active": True, "url": f"http://localhost:{port}/v1"}
    except (httpx.ConnectError, httpx.ReadTimeout):
        pass
    return {"active": False, "url": None}


# --- Worker node management (REQ-WK-6a..14) ---


def models_list_cached() -> str:
    """List cached models on worker node (REQ-WK-6)."""
    r = ssh_cmd("uvx huggingface-cli cache ls 2>&1")
    return r.stdout or r.stderr


def models_pull(alias: str) -> int:
    """Download model weights for alias (REQ-WK-6a)."""
    available = list_models()
    if alias not in available:
        raise ValueError(f"Unknown alias: {alias}. Available: {', '.join(sorted(available))}")
    repo = available[alias].repository
    return ssh_stream(f"uvx huggingface-cli download {repo}", timeout=1800)


def models_remove(revision_id: str) -> int:
    """Remove a cached model revision (REQ-WK-6b)."""
    return ssh_stream(f"uvx huggingface-cli cache rm {revision_id}")


def models_prune() -> int:
    """Clean broken/detached revisions (REQ-WK-6c)."""
    return ssh_stream("uvx huggingface-cli cache prune --yes")


def models_fix_perms() -> int:
    """Fix HuggingFace cache permissions (REQ-WK-6d)."""
    return ssh_stream("chmod -R u+w ~/.cache/huggingface")


def models_add(alias: str, repo: str) -> None:
    """Add a new model to worker-models.yml (REQ-WK-6e).

    Args:
        alias: Short name for the model.
        repo: HuggingFace repository (e.g. Qwen/Qwen3-8B-FP8).

    Raises:
        ValueError: If alias already exists.
    """
    config = load_worker_models()
    models = config.get("models", {})

    if alias in models:
        raise ValueError(f"Alias '{alias}' already exists in worker-models.yml")

    # Get defaults from first existing model or use hardcoded defaults
    if models:
        first = next(iter(models.values()))
        docker_image = first.get("docker_image", "scitrera/dgx-spark-vllm:0.17.0-t5")
        gpu_util = first.get("gpu_memory_utilization", 0.90)
        max_len = first.get("max_model_len", 65536)
    else:
        docker_image = "scitrera/dgx-spark-vllm:0.17.0-t5"
        gpu_util = 0.90
        max_len = 65536

    models[alias] = {
        "repository": repo,
        "served_model_name": alias,
        "docker_image": docker_image,
        "gpu_memory_utilization": gpu_util,
        "max_model_len": max_len,
        "vllm_args": [],
    }

    config["models"] = models
    p = _worker_models_path()
    with open(p, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)


def worker_logs(follow: bool = False) -> int:
    """Show active container logs (REQ-WK-11)."""
    s = get_status()
    if not s["active"]:
        raise RuntimeError("No active model container.")
    flag = "-f" if follow else "--tail 200"
    return ssh_stream(f"docker logs {flag} {s['container']}", timeout=3600 if follow else 30)


def worker_info() -> str:
    """Report GPU, disk, and memory from worker node (REQ-WK-12)."""
    r = ssh_cmd(
        "echo '=== GPU ===' && nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu "
        "--format=csv,noheader 2>/dev/null || echo 'nvidia-smi not available' && "
        "echo '\\n=== Disk ===' && df -h / ~/.cache 2>/dev/null && "
        "echo '\\n=== Memory ===' && free -h"
    )
    return r.stdout or r.stderr


def images_pull(image: str | None = None) -> int:
    """Pull a docker image on the worker node (REQ-WK-13)."""
    if image is None:
        config = load_worker_models()
        models_cfg = config.get("models", {})
        if models_cfg:
            first = next(iter(models_cfg.values()))
            image = first.get("docker_image", "scitrera/dgx-spark-vllm:0.17.0-t5")
        else:
            image = "scitrera/dgx-spark-vllm:0.17.0-t5"
    return ssh_stream(f"docker pull {image}", timeout=600)


def images_list() -> str:
    """List docker images on the worker node (REQ-WK-13)."""
    r = ssh_cmd("docker images --format 'table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}'")
    return r.stdout or r.stderr


def cache_clear() -> int:
    """Clear compiled kernel caches on worker node (REQ-WK-14)."""
    return ssh_stream("rm -rf ~/.cache/flashinfer/* ~/.cache/vllm/*")


def worker_check() -> list[tuple[str, bool, str]]:
    """Verify worker node prerequisites (REQ-WK-15).

    Returns:
        List of (check_name, passed, detail) tuples.
    """
    results: list[tuple[str, bool, str]] = []

    # SSH connectivity
    try:
        r = ssh_cmd("echo ok")
        ok = r.stdout.strip() == "ok"
        results.append(("SSH", ok, _ssh_target() if ok else r.stderr.strip()))
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        results.append(("SSH", False, str(e)))
        return results  # Can't check anything else without SSH

    # Docker
    r = ssh_cmd("docker --version")
    results.append(("Docker", r.returncode == 0, r.stdout.strip() or r.stderr.strip()))

    # NVIDIA GPU
    r = ssh_cmd("nvidia-smi --query-gpu=name --format=csv,noheader")
    results.append(("GPU", r.returncode == 0, r.stdout.strip() or r.stderr.strip()))

    # uvx
    r = ssh_cmd("uvx --version")
    results.append(("uvx", r.returncode == 0, r.stdout.strip() or r.stderr.strip()))

    return results
