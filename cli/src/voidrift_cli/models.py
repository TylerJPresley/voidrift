"""Model alias resolution (REQ-MC-1, REQ-MC-3, REQ-ARCH-5).

The CLI is model-agnostic. It resolves aliases to (base_url, api_key, model_id)
from models.yml and connects to the endpoint directly. It does NOT manage
containers, SSH connections, or gateway processes.

Local model aliases are also discovered from worker-models.yml so that adding
a model to the worker automatically makes it available in the CLI without
requiring a duplicate entry in models.yml.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel

from .config import expand_config_refs, voidrift_home


class ModelConfig(BaseModel):
    """Resolved model endpoint configuration."""

    alias: str
    model_id: str
    model_type: str  # "local", "cloud", "gateway"
    api_base: str | None = None
    api_key: str | None = None
    provider: str | None = None
    max_context: int | None = None  # from models.yml; None = query API or unknown


def _load_models_config() -> dict:
    """Load models.yml from VOIDRIFT_HOME.

    Returns:
        Parsed YAML dict, or empty dict if file not found.
    """
    p = voidrift_home() / "models.yml"
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def _synthesize_from_worker_models() -> dict[str, dict]:
    """Build local model entries from worker-models.yml (REQ-MC-1).

    Uses worker.ip and worker.api_key from config.yml, and worker.port from
    worker-models.yml (default 8000). Only models in the active `models`
    section are included — `retired_models` and `retired` are skipped.

    Returns:
        Dict of alias → raw model entry dict, or empty dict if no worker config.
    """
    from .config import get_worker_config
    wc = get_worker_config()
    ip = wc.get("ip", "")
    if not ip:
        return {}

    api_key = wc.get("api_key", "no-key")
    # Expand any env var references in the api_key value
    api_key = expand_config_refs(api_key) if "${" in str(api_key) else api_key

    worker_models_path = voidrift_home() / "worker-models.yml"
    if not worker_models_path.exists():
        return {}

    with open(worker_models_path) as f:
        wm = yaml.safe_load(f) or {}

    port = wm.get("worker", {}).get("port", 8000)
    base_url = f"http://{ip}:{port}/v1"

    result = {}
    for alias, m in wm.get("models", {}).items():
        served = m.get("served_model_name", alias)
        entry: dict = {
            "model_id": f"openai/{served}",
            "base_url": base_url,
            "api_key": api_key,
            "type": "local",
        }
        if "max_model_len" in m:
            entry["max_context"] = m["max_model_len"]
        result[alias] = entry
    return result


def _merged_models() -> dict[str, dict]:
    """Return all model entries: explicit models.yml merged with synthesized worker entries.

    models.yml entries take precedence over worker-models.yml synthesis.
    """
    synthesized = _synthesize_from_worker_models()
    explicit = _load_models_config().get("models", {})
    return {**synthesized, **explicit}


def resolve_model(alias: str) -> ModelConfig:
    """Resolve a model alias to its endpoint configuration (REQ-MC-1).

    Checks models.yml first, then synthesizes from worker-models.yml for
    local models not explicitly listed.

    Args:
        alias: Model alias (e.g. ``qwen35``, ``claude``, ``kiro-sonnet``).

    Returns:
        Fully populated ModelConfig with endpoint details.

    Raises:
        ValueError: If the alias is not found in either source.
    """
    models = _merged_models()

    if alias not in models:
        available = sorted(models.keys())
        raise ValueError(f"Unknown model: {alias}. Available: {', '.join(available)}")

    m = models[alias]
    model_type = m.get("type", "cloud")

    return ModelConfig(
        alias=alias,
        model_id=m["model_id"],
        model_type=model_type,
        api_base=expand_config_refs(m["base_url"]) if "base_url" in m else None,
        api_key=expand_config_refs(m["api_key"]) if "api_key" in m else None,
        provider=m.get("provider"),
        max_context=m.get("max_context"),
    )


def list_models() -> list[str]:
    """List all available model aliases from models.yml and worker-models.yml.

    Returns:
        Sorted list of alias strings.
    """
    return sorted(_merged_models().keys())
