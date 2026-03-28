"""Model configuration and container lifecycle (REQ-WK-2 through REQ-WK-10)."""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml
from pydantic import BaseModel, Field


def _worker_models_path() -> Path:
    """Return path to worker-models.yml."""
    from .config import voidrift_home
    return voidrift_home() / "worker-models.yml"


def _active_container_path() -> Path:
    """Return path to the active container state file."""
    from .config import voidrift_home
    return voidrift_home() / ".active-container"


def _save_active_container(name: str, alias: str) -> None:
    """Record the active container name and model alias."""
    _active_container_path().write_text(f"{name}\n{alias}\n")


def _read_active_container() -> tuple[str | None, str | None]:
    """Read the active container name and model alias, or (None, None)."""
    p = _active_container_path()
    if not p.exists():
        return None, None
    lines = p.read_text().strip().splitlines()
    name = lines[0] if lines else None
    alias = lines[1] if len(lines) > 1 else None
    return name, alias


def _clear_active_container() -> None:
    """Remove the active container state file."""
    p = _active_container_path()
    if p.exists():
        p.unlink()


def _worker_images_path() -> Path:
    """Return path to worker-images.yml."""
    from .config import voidrift_home
    return voidrift_home() / "worker-images.yml"


def load_worker_images() -> dict:
    """Load worker-images.yml.

    Returns:
        Parsed YAML dict with 'sources' key, or empty dict if file not found.
    """
    p = _worker_images_path()
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def _save_worker_images(data: dict) -> None:
    """Write worker-images.yml."""
    p = _worker_images_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


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
    docker_image: str = ""
    image_source: str = ""
    recipe: str = ""
    gpu_memory_utilization: float = 0.90
    max_model_len: int = 65536
    vllm_args: list[str] = Field(default_factory=list)


def _resolve_docker_image(model_cfg: dict, default_image: str | None) -> str:
    """Resolve the Docker image for a model (REQ-WK-8).

    Checks model-level 'image', then top-level 'default_image', then
    resolves the alias against worker-images.yml to get the actual
    Docker image name.
    """
    alias = model_cfg.get("image") or default_image
    if not alias:
        return model_cfg.get("docker_image", "")
    sources = load_worker_images().get("sources", {})
    src = sources.get(alias)
    if not src:
        return alias  # treat as literal docker image string
    if src.get("type") == "docker":
        return src.get("image", alias)
    # git source — return the built image name
    return src.get("image_name", "vllm-node")


def list_models() -> dict[str, ModelConfig]:
    """List all configured local models (REQ-WK-6).

    Returns:
        Dict of alias → ModelConfig.
    """
    config = load_worker_models()
    default_image = config.get("default_image")
    models = config.get("models", {})
    result = {}
    for alias, m in models.items():
        image_alias = m.get("image") or default_image or ""
        result[alias] = ModelConfig(
            alias=alias,
            repository=m.get("repository", ""),
            served_model_name=m.get("served_model_name", alias),
            docker_image=_resolve_docker_image(m, default_image),
            image_source=image_alias,
            recipe=m.get("recipe", ""),
            gpu_memory_utilization=m.get("gpu_memory_utilization", 0.90),
            max_model_len=m.get("max_model_len", 65536),
            vllm_args=m.get("vllm_args", []),
        )
    return result


def _ssh_target() -> str:
    """Return user@ip SSH target string.

    Raises:
        RuntimeError: If worker user/ip are not configured.
    """
    from .config import get_worker_config
    wc = get_worker_config()
    user = wc.get("user", "")
    ip = wc.get("ip", "")
    if not user or not ip:
        raise RuntimeError("Worker user and ip must be set in config.yml")
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


def ssh_stream_capture(cmd: str, timeout: int = 600) -> tuple[int, str]:
    """Run a command on the worker node via SSH, streaming to stdout and capturing.

    Args:
        cmd: Shell command string to execute remotely.
        timeout: Max seconds to wait (default 600).

    Returns:
        (exit_code, captured_stdout)
    """
    proc = subprocess.Popen(
        ["ssh", "-o", "ConnectTimeout=5", _ssh_target(), _SSH_PATH_PREFIX + cmd],
        stdout=subprocess.PIPE,
        text=True,
    )
    lines: list[str] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            lines.append(line)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise
    return proc.returncode, "".join(lines)


def _get_recipe_source(model: ModelConfig) -> dict | None:
    """Return the git image source if model has a recipe, else None."""
    if not model.recipe or not model.image_source:
        return None
    sources = load_worker_images().get("sources", {})
    src = sources.get(model.image_source)
    if src and src.get("type") == "git":
        return src
    return None


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
    from .config import get_worker_config
    worker_cfg = get_worker_config()
    port = worker.get("port", 8000)

    # Check if already running
    if not refresh:
        prev_name, prev_alias = _read_active_container()
        if prev_name and prev_alias == alias:
            try:
                r = ssh_cmd(f"docker ps --filter name={prev_name} --format '{{{{.Names}}}}'")
                if prev_name in r.stdout:
                    return
            except (subprocess.SubprocessError, OSError):
                pass

    # Stop existing worker containers (REQ-WK-7)
    recipe_src = _get_recipe_source(model)
    try:
        # Stop previously tracked container
        prev_name, _ = _read_active_container()
        if prev_name:
            sys.stderr.write(f"Stopping {prev_name}...\n")
            ssh_cmd(f"docker stop {shlex.quote(prev_name)} 2>/dev/null; "
                    f"docker rm -f {shlex.quote(prev_name)} 2>/dev/null || true")
            _clear_active_container()
            # Wait for GPU memory to release
            time.sleep(3)
        # Also stop any prefixed containers (safety net)
        running = ssh_cmd(f"docker ps --filter 'name={prefix}' --format '{{{{.Names}}}}'")
        if running.stdout.strip():
            ssh_cmd(f"docker ps --filter 'name={prefix}' -q | xargs -r docker stop")
            ssh_cmd(f"docker ps -a --filter 'name={prefix}' -q | xargs -r docker rm -f")
    except (subprocess.SubprocessError, OSError):
        pass

    # Recipe path: use run-recipe.sh from the git source (REQ-WK-8)
    recipe_proc = None
    if recipe_src:
        clone_path = recipe_src.get("clone_path", f"~/opt/{model.image_source}")
        run_cmd = recipe_src.get("run_cmd", "./run-recipe.sh")
        extra_args = []
        if model.served_model_name and model.served_model_name != model.repository:
            extra_args += ["--served-model-name", model.served_model_name]
        extra_args += model.vllm_args
        extra = ""
        if extra_args:
            extra = " -- " + " ".join(shlex.quote(a) for a in extra_args)
        recipe_cmd = f"cd {clone_path} && {run_cmd} {shlex.quote(model.recipe)} --solo{extra}"
        # Recipe runs vLLM in foreground — launch in background, poll API for readiness
        recipe_proc = subprocess.Popen(
            ["ssh", "-o", "ConnectTimeout=5", _ssh_target(), _SSH_PATH_PREFIX + recipe_cmd],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        active_container = "vllm_node"
    else:
        # Standard docker run path
        docker_opts = worker.get("docker_options", ["--privileged", "--gpus all", "--network host"])
        cache_mounts = worker.get("cache_mounts", [])

        ssh_cmd(f"docker rm -f {container_name} 2>/dev/null || true")

        # Pull image if not already on worker — docker run would pull inline and
        # exceed ssh_cmd's 30s timeout for large images (REQ-WK-2)
        img = model.docker_image
        check = ssh_cmd(
            f"docker image inspect {shlex.quote(img)} --type image >/dev/null 2>&1 && echo ok || echo missing"
        )
        if "missing" in check.stdout:
            sys.stderr.write(f"Pulling {img}...\n")
            rc = ssh_stream(f"docker pull {shlex.quote(img)}", timeout=300)
            if rc != 0:
                raise RuntimeError(f"Failed to pull image: {img}")

        cmd_parts = ["docker", "run", "-d", f"--name {container_name}"]
        for opt in docker_opts:
            cmd_parts.append(opt)
        hf_token = worker_cfg.get("hf_token", "")
        if hf_token:
            cmd_parts.append(f"-e HF_TOKEN={hf_token}")
        for mount in cache_mounts:
            cmd_parts.append(f"-v {mount}")
        cmd_parts.append(model.docker_image)
        cmd_parts.append(f"vllm serve {model.repository}")
        cmd_parts.append(f"--served-model-name {model.served_model_name}")
        cmd_parts.append(f"--gpu-memory-utilization {model.gpu_memory_utilization}")
        cmd_parts.append(f"--max-model-len {model.max_model_len}")
        cmd_parts.append(f"--port {port}")
        for arg in model.vllm_args:
            if arg == shlex.quote(arg):
                cmd_parts.append(arg)
            else:
                cmd_parts.append(shlex.quote(arg))

        try:
            r = ssh_cmd(" ".join(cmd_parts))
            if r.returncode != 0:
                raise RuntimeError(f"Failed to start container: {r.stderr}")
        except subprocess.TimeoutExpired:
            raise RuntimeError("SSH timeout starting container")
        active_container = container_name

    # Wait for API ready (REQ-WK-2)
    _save_active_container(active_container, alias)
    worker_ip = worker_cfg.get("ip", "")
    url = f"http://{worker_ip}:{port}/v1/models"
    while True:
        # Check if recipe process died
        if recipe_src and recipe_proc.poll() is not None:
            rc = recipe_proc.returncode
            if rc != 0:
                raise RuntimeError(f"Recipe '{model.recipe}' failed with exit code {rc}")
        try:
            r = httpx.get(url, timeout=5)
            if r.status_code == 200:
                return
        except (httpx.ConnectError, httpx.ReadTimeout):
            pass
        time.sleep(2)


def stop_model() -> None:
    """Stop the active model container (REQ-WK-3)."""
    name, _ = _read_active_container()
    config = load_worker_models()
    prefix = config.get("worker", {}).get("container_prefix", "worker-")
    try:
        if name:
            ssh_cmd(f"docker stop {shlex.quote(name)} 2>/dev/null; "
                    f"docker rm {shlex.quote(name)} 2>/dev/null || true")
        # Safety net: also stop any prefixed containers
        ssh_cmd(f"docker ps --filter 'name={prefix}' -q | xargs -r docker stop")
        ssh_cmd(f"docker ps -a --filter 'name={prefix}' -q | xargs -r docker rm")
    except (subprocess.SubprocessError, OSError) as e:
        raise RuntimeError(f"Failed to stop container: {e}") from e
    finally:
        _clear_active_container()


def get_status() -> dict:
    """Get active model status (REQ-WK-4).

    Returns:
        Dict with keys: active (bool), container (str|None), model (str|None), url (str|None).
    """
    from .config import get_worker_config
    config = load_worker_models()
    worker = config.get("worker", {})
    prefix = worker.get("container_prefix", "worker-")
    port = worker.get("port", 8000)
    worker_ip = get_worker_config().get("ip", "")

    # Read tracked container
    tracked_name, tracked_alias = _read_active_container()
    container = None
    alias = None

    if tracked_name:
        try:
            r = ssh_cmd(f"docker ps --filter 'name={tracked_name}' --format '{{{{.Names}}}}'")
            if tracked_name in r.stdout:
                container = tracked_name
                alias = tracked_alias
        except (subprocess.SubprocessError, OSError, RuntimeError):
            pass

    # Fallback: scan for prefixed containers
    if not container:
        try:
            r = ssh_cmd(f"docker ps --filter 'name={prefix}' --format '{{{{.Names}}}}'")
            container = r.stdout.strip().split("\n")[0] if r.stdout.strip() else None
            if container:
                alias = container.replace(prefix, "") if container.startswith(prefix) else container
        except (subprocess.SubprocessError, OSError, RuntimeError):
            pass

    if not container:
        _clear_active_container()
        return {"active": False, "container": None, "model": None, "url": None}

    url = f"http://{worker_ip}:{port}/v1"
    return {"active": True, "container": container, "model": alias, "url": url}


def start_gateway() -> None:
    """Start the Kiro Gateway container (REQ-WK-9).

    Raises:
        RuntimeError: If the gateway does not become healthy or credentials are invalid.
    """
    from .config import get_kiro_config
    port = str(get_kiro_config().get("port", 8000))

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
        except (httpx.ConnectError, httpx.ReadTimeout, httpx.ReadError):
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
    from .config import get_kiro_config
    api_key = get_kiro_config().get("api_key", "")
    if not api_key:
        raise RuntimeError("KIRO_API_KEY is not set. Export it in your shell profile.")
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
    from .config import get_kiro_config
    port = str(get_kiro_config().get("port", 8000))
    try:
        r = httpx.get(f"http://localhost:{port}/health", timeout=3)
        if r.status_code == 200:
            return {"active": True, "url": f"http://localhost:{port}/v1"}
    except (httpx.ConnectError, httpx.ReadTimeout):
        pass
    return {"active": False, "url": None}


# --- Worker node management (REQ-WK-6a..14) ---


HF_CLI = "uvx --from huggingface_hub hf"


def _get_cached_repos() -> dict[str, str]:
    """Get cached repository names with sizes from HF cache."""
    r = ssh_cmd(f"{HF_CLI} cache ls 2>&1")
    output = r.stdout or ""
    repos = {}
    for line in output.splitlines():
        if line.startswith("model/"):
            parts = line.split()
            if len(parts) >= 2:
                repo = parts[0].replace("model/", "", 1)
                repos[repo] = parts[1]
    return repos


def _check_freshness(available: dict, cached: dict) -> dict[str, str]:
    """Compare local HF cache SHAs against remote HEAD for cached models."""
    repos = {m.repository for m in available.values() if m.repository in cached}
    if not repos:
        return {}

    # Build a single SSH command that reads local SHAs and fetches remote SHAs
    checks = []
    for repo in sorted(repos):
        cache_dir = f"models--{repo.replace('/', '--')}"
        local_ref = f"~/.cache/huggingface/hub/{cache_dir}/refs/main"
        remote_url = f"https://huggingface.co/api/models/{repo}/revision/main"
        checks.append(
            f'LOCAL=$(cat {local_ref} 2>/dev/null || echo "none"); '
            f'REMOTE=$(curl -s --connect-timeout 3 {remote_url} 2>/dev/null '
            f'| python3 -c "import sys,json; print(json.load(sys.stdin).get(\'sha\',\'\'))" 2>/dev/null || echo ""); '
            f'echo "{repo}|$LOCAL|$REMOTE"'
        )
    cmd = "; ".join(checks)
    try:
        r = ssh_cmd(cmd)
    except Exception:
        return {}

    result = {}
    for line in (r.stdout or "").strip().splitlines():
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        repo, local, remote = parts
        if not remote or remote == "none":
            result[repo] = "✓ cached"
        elif local == remote:
            result[repo] = "✓ current"
        else:
            result[repo] = "⬆ update"
    return result


def models_list() -> str:
    """List configured and cached models (REQ-WK-6)."""
    lines = []

    # Configured models
    available = list_models()
    cached = _get_cached_repos()
    s = get_status()
    active = s["model"] if s["active"] else None

    # Check freshness for cached models
    freshness = _check_freshness(available, cached)

    lines.append("Configured Models:")
    if available:
        for alias, m in sorted(available.items()):
            if alias == active:
                status = "✅ running"
            elif m.repository not in cached:
                status = "⚠ not downloaded"
            else:
                status = freshness.get(m.repository, "✓ cached")
            lines.append(f"  {alias:<20} {m.repository:<45} {status}")
    else:
        lines.append("  (none)")

    # Cached models
    lines.append("")
    lines.append("Cached Models:")
    r = ssh_cmd(f"{HF_CLI} cache ls 2>&1")
    cache_output = r.stdout or r.stderr or "(none)"
    for line in cache_output.splitlines():
        lines.append(f"  {line}")

    return "\n".join(lines)


def models_add(alias: str, repo: str) -> int:
    """Add a new model and download weights (REQ-WK-6a)."""
    config = load_worker_models()
    models = config.get("models", {})

    if alias in models:
        raise ValueError(f"Alias '{alias}' already exists")

    # Get defaults from first existing model
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

    # Download weights
    return ssh_stream(f"{HF_CLI} download {repo}", timeout=1800)


def models_remove(alias: str) -> int:
    """Remove model from config and cache (REQ-WK-6b)."""
    config = load_worker_models()
    models = config.get("models", {})

    if alias not in models:
        raise ValueError(f"Alias '{alias}' not found")

    model = models.pop(alias)
    repo = model.get("repository", "")

    # Move to retired section
    retired = config.get("retired", {})
    retired[alias] = model
    config["retired"] = retired
    config["models"] = models

    p = _worker_models_path()
    with open(p, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    # Delete from cache
    return ssh_stream(f"{HF_CLI} cache rm {repo} --yes 2>&1")


def models_check(prune: bool = False) -> tuple[list[tuple[str, bool, str]], list[tuple[str, str]]]:
    """Audit models and fix missing weights (REQ-WK-6d).
    
    Returns:
        Tuple of (configured results, unconfigured repos with sizes).
    """
    results = []
    available = list_models()
    cached = _get_cached_repos()
    configured_repos = {m.repository for m in available.values()}

    # Check configured models
    for alias, m in available.items():
        if m.repository in cached:
            results.append((alias, True, "cached"))
        else:
            results.append((alias, False, "downloading..."))
            rc = ssh_stream(f"{HF_CLI} download {m.repository}", timeout=1800)
            if rc == 0:
                results[-1] = (alias, True, "downloaded")
            else:
                results[-1] = (alias, False, "download failed")

    # Find unconfigured cached models
    unconfigured = [(repo, size) for repo, size in cached.items() if repo not in configured_repos]

    # Prune if requested
    if prune and unconfigured:
        for repo, _ in unconfigured:
            cache_dir = f"models--{repo.replace('/', '--')}"
            ssh_stream(f"sudo chown -R $(whoami) ~/.cache/huggingface/hub/{cache_dir} 2>/dev/null; "
                       f"{HF_CLI} cache rm model/{repo} --yes 2>&1")

    return results, unconfigured


def _list_containers() -> list[dict]:
    """List all worker containers (running and stopped) with status."""
    config = load_worker_models()
    prefix = config.get("worker", {}).get("container_prefix", "worker-")
    r = ssh_cmd(
        f"docker ps -a --filter 'name={prefix}' "
        f"--format '{{{{.Names}}}}|{{{{.Status}}}}'"
    )
    containers = []
    for line in (r.stdout or "").strip().splitlines():
        if "|" in line:
            name, status = line.split("|", 1)
            containers.append({"name": name.strip(), "status": status.strip()})
    return containers


def worker_logs(follow: bool = False, container: str | None = None) -> int:
    """Show container logs (REQ-WK-11)."""
    if not container:
        raise RuntimeError("NO_CONTAINER")
    flag = "-f" if follow else "--tail 200"
    return ssh_stream(f"docker logs {flag} {container}", timeout=3600 if follow else 30)


def worker_info() -> str:
    """Report GPU, disk, and memory from worker node (REQ-WK-12)."""
    r = ssh_cmd(
        "echo '=== GPU ===' && nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu "
        "--format=csv,noheader 2>/dev/null || echo 'nvidia-smi not available' && "
        "echo '\\n=== Disk ===' && df -h / ~/.cache 2>/dev/null && "
        "echo '\\n=== Memory ===' && free -h"
    )
    return r.stdout or r.stderr


def _detect_image_type(url: str) -> str:
    """Auto-detect image source type from URL."""
    if url.endswith(".git") or "github.com" in url or "gitlab.com" in url:
        return "git"
    return "docker"


def images_source_list() -> dict:
    """List configured image sources with status (REQ-WK-13).

    Returns:
        Dict of alias → source config with 'models' key listing referencing models.
    """
    sources = load_worker_images().get("sources", {})
    config = load_worker_models()
    default_image = config.get("default_image")
    models = config.get("models", {})
    # Find which models reference each source
    for alias, src in sources.items():
        refs = [m for m, cfg in models.items()
                if cfg.get("image", default_image) == alias]
        src["models"] = refs
    return sources


def images_add(alias: str, url: str) -> int:
    """Add an image source, clone/pull, and build (REQ-WK-13).

    Returns:
        Exit code (0 for success).
    """
    data = load_worker_images()
    sources = data.setdefault("sources", {})
    if alias in sources:
        raise RuntimeError(f"Image source '{alias}' already exists.")

    src_type = _detect_image_type(url)
    if src_type == "git":
        clone_path = f"~/opt/{alias}"
        sources[alias] = {
            "type": "git",
            "url": url,
            "build_cmd": "./build-and-copy.sh",
            "image_name": "vllm-node",
            "clone_path": clone_path,
        }
        _save_worker_images(data)
        # Clone on worker
        rc = ssh_stream(f"git clone {shlex.quote(url)} {clone_path}", timeout=120)
        if rc != 0:
            raise RuntimeError(f"Failed to clone {url} on worker.")
        # Build
        rc = ssh_stream(f"cd {clone_path} && ./build-and-copy.sh", timeout=1800)
        if rc != 0:
            raise RuntimeError(f"Failed to build image for '{alias}' on worker.")
    else:
        sources[alias] = {
            "type": "docker",
            "image": url,
        }
        _save_worker_images(data)
        rc = ssh_stream(f"docker pull {shlex.quote(url)}", timeout=600)
        if rc != 0:
            raise RuntimeError(f"Failed to pull {url} on worker.")
    return 0


def images_remove(alias: str, force: bool = False) -> int:
    """Remove an image source and all assets from worker (REQ-WK-13).

    Returns:
        Exit code (0 for success).
    """
    data = load_worker_images()
    sources = data.get("sources", {})
    if alias not in sources:
        raise RuntimeError(f"Image source '{alias}' not found.")

    # Check model references
    config = load_worker_models()
    default_image = config.get("default_image")
    models = config.get("models", {})
    refs = [m for m, cfg in models.items()
            if cfg.get("image", default_image) == alias]
    if refs and not force:
        raise RuntimeError(
            f"Models reference '{alias}': {', '.join(refs)}. Use --force to remove."
        )

    src = sources[alias]
    if src.get("type") == "git":
        clone_path = src.get("clone_path", f"~/opt/{alias}")
        image_name = src.get("image_name", "vllm-node")
        ssh_stream(f"rm -rf {clone_path}")
        ssh_stream(f"docker rmi {shlex.quote(image_name)} 2>/dev/null")
    else:
        image = src.get("image", "")
        if image:
            ssh_stream(f"docker rmi {shlex.quote(image)} 2>/dev/null")

    del sources[alias]
    _save_worker_images(data)
    return 0


def images_update(alias: str) -> int:
    """Update an image source and rebuild/pull (REQ-WK-13).

    Returns:
        Exit code (0 for success).
    """
    sources = load_worker_images().get("sources", {})
    if alias not in sources:
        raise RuntimeError(f"Image source '{alias}' not found.")

    src = sources[alias]
    if src.get("type") == "git":
        clone_path = src.get("clone_path", f"~/opt/{alias}")
        build_cmd = src.get("build_cmd", "./build-and-copy.sh")
        rc = ssh_stream(f"cd {clone_path} && git pull", timeout=120)
        if rc != 0:
            raise RuntimeError(f"Failed to update repo for '{alias}'.")
        rc = ssh_stream(f"cd {clone_path} && {build_cmd}", timeout=1800)
        if rc != 0:
            raise RuntimeError(f"Failed to rebuild image for '{alias}'.")
    else:
        image = src.get("image", "")
        rc = ssh_stream(f"docker pull {shlex.quote(image)}", timeout=600)
        if rc != 0:
            raise RuntimeError(f"Failed to pull {image}.")
    return 0


def images_build(alias: str) -> int:
    """Build the Docker image for a git source (REQ-WK-13).

    Returns:
        Exit code (0 for success).
    """
    sources = load_worker_images().get("sources", {})
    if alias not in sources:
        raise RuntimeError(f"Image source '{alias}' not found.")

    src = sources[alias]
    if src.get("type") != "git":
        raise RuntimeError(f"'{alias}' is a docker source — use 'worker images update' to pull.")

    clone_path = src.get("clone_path", f"~/opt/{alias}")
    build_cmd = src.get("build_cmd", "./build-and-copy.sh")
    rc = ssh_stream(f"cd {clone_path} && {build_cmd}", timeout=1800)
    if rc != 0:
        raise RuntimeError(f"Failed to build image for '{alias}'.")
    return 0


def images_docker_list() -> str:
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
