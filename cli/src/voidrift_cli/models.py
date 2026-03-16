"""Model alias resolution (REQ-MC-1, REQ-MC-3, REQ-ARCH-5).

The CLI is model-agnostic. It resolves aliases to (base_url, api_key, model_id)
from models.yml and connects to the endpoint directly. It does NOT manage
containers, SSH connections, or gateway processes.
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


def resolve_model(alias: str) -> ModelConfig:
    """Resolve a model alias to its endpoint configuration (REQ-MC-1).

    Args:
        alias: Model alias (e.g. ``qwen3-coder``, ``claude``, ``kiro-sonnet``).

    Returns:
        Fully populated ModelConfig with endpoint details.

    Raises:
        ValueError: If the alias is not found in models.yml.
    """
    config = _load_models_config()
    models = config.get("models", {})

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
    )


def list_models() -> list[str]:
    """List all available model aliases.

    Returns:
        Sorted list of alias strings.
    """
    config = _load_models_config()
    return sorted(config.get("models", {}).keys())
