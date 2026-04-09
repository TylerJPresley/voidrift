"""Model alias resolution (REQ-MC-1, REQ-MC-3, REQ-ARCH-5).

The CLI is model-agnostic. It resolves aliases to (base_url, api_key, model_id)
from a single models file and connects to the endpoint directly. It does NOT
manage containers, SSH connections, or gateway processes.

The models file is maintained by an external tool (worker-cli). Voidrift reads
it and connects. One file, one source of truth. Each entry carries its own
operational limits; a defaults: section provides fallbacks.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import logging
import yaml
from pydantic import BaseModel

from .config import expand_config_refs, get_models_file

# Hardcoded defaults when models file has no defaults: section
_DEFAULTS = {
    "max_tokens": 16384,
    "max_read_lines": 2000,
    "max_input_chars": 0,
    "concurrency": 1,
}


class ModelConfig(BaseModel):
    """Resolved model endpoint configuration."""

    alias: str
    model_id: str
    model_type: str = ""  # optional metadata, no behavioral effect
    api_base: str | None = None
    api_key: str | None = None
    provider: str | None = None
    max_context: int | None = None
    max_tokens: int = 16384
    max_read_lines: int = 2000
    max_input_chars: int = 0  # 0 = unlimited
    concurrency: int = 1
    fallback: str | None = None  # alias of fallback model (REQ-MC-4)
    max_input_tokens: int | None = None  # token budget per run (REQ-ARCH-13)
    max_output_tokens: int | None = None  # token budget per run (REQ-ARCH-13)
    protocol: str = "openai"


class ModelInterface:
    """Unified interface for a model endpoint: config + protocol adapter.

    The framework holds a ModelInterface everywhere a model is needed.
    Access config data via .config; wire format via .adapter.
    Direct attribute access delegates to .config for backward compatibility.
    """

    def __init__(self, config: "ModelConfig", adapter: "Any") -> None:
        self.config = config
        self.adapter = adapter

    def __getattr__(self, name: str) -> Any:
        # Delegate field access to config for backward compatibility
        return getattr(self.config, name)

    def __repr__(self) -> str:
        return f"ModelInterface(alias={self.config.alias!r}, protocol={self.config.protocol!r})"


def _load_models_file() -> dict:
    """Load the full models file (REQ-MC-1).

    Returns:
        Parsed YAML dict, or empty dict if file not found.
    """
    p = get_models_file()
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def _load_models() -> dict[str, dict]:
    """Load models with defaults merged (REQ-MC-3).

    Returns:
        Dict of alias → model entry with defaults applied.
    """
    data = _load_models_file()
    defaults = {**_DEFAULTS, **data.get("defaults", {})}
    models = data.get("models", {})
    merged = {}
    for alias, entry in models.items():
        m = {**defaults, **entry}
        merged[alias] = m
    return merged


def resolve_model(alias: str) -> ModelInterface:
    """Resolve a model alias to its endpoint configuration (REQ-MC-1).

    Args:
        alias: Model alias (e.g. ``qwen35``, ``claude``, ``kiro-sonnet``).

    Returns:
        ModelInterface wrapping a fully populated ModelConfig with protocol adapter.

    Raises:
        ValueError: If the alias is not found.
    """
    models = _load_models()

    if alias not in models:
        available = sorted(models.keys())
        raise ValueError(f"Unknown model: {alias}. Available: {', '.join(available)}")

    m = models[alias]

    config = ModelConfig(
        alias=alias,
        model_id=m["model_id"],
        model_type=m.get("type", ""),
        api_base=expand_config_refs(m["base_url"]) if "base_url" in m else None,
        api_key=expand_config_refs(m["api_key"]) if "api_key" in m else None,
        provider=m.get("provider"),
        max_context=m.get("max_context"),
        max_tokens=int(m.get("max_tokens", 16384)),
        max_read_lines=int(m.get("max_read_lines", 2000)),
        max_input_chars=int(m.get("max_input_chars", 0)),
        concurrency=int(m.get("concurrency", 1)),
        fallback=m.get("fallback"),
        max_input_tokens=int(m["max_input_tokens"]) if m.get("max_input_tokens") else None,
        max_output_tokens=int(m["max_output_tokens"]) if m.get("max_output_tokens") else None,
        protocol=m.get("protocol", "openai"),
    )
    from .agent_protocol import get_adapter
    return ModelInterface(config, get_adapter(config.protocol))


def list_models() -> list[str]:
    """List all available model aliases.

    Returns:
        Sorted list of alias strings.
    """
    return sorted(_load_models().keys())


def shell_complete_model(ctx: object, param: object, incomplete: str) -> list[str]:
    """Shell completion callback for model alias arguments."""
    try:
        return [a for a in list_models() if a.startswith(incomplete)]
    except Exception as exc:
        logging.getLogger(__name__).debug(
            "shell_complete_model: failed to load models: %s", exc
        )
        return []
