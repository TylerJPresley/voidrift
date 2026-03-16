"""Framework configuration loader (REQ-CFG-1..4).

Loads config from ~/.voidrift/config.yml with env var expansion.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from functools import lru_cache

import yaml


def _voidrift_home() -> Path:
    """Return the framework config directory."""
    return Path(os.environ.get("VOIDRIFT_HOME", Path.home() / ".voidrift"))


def _expand_env(value: str) -> str:
    """Expand ${VAR} and ${VAR:-default} in a string."""
    if not isinstance(value, str) or "${" not in value:
        return value

    def _replace(m: re.Match) -> str:
        var = m.group(1)
        if ":-" in var:
            name, default = var.split(":-", 1)
            return os.environ.get(name, default)
        return os.environ.get(var, "")

    return re.sub(r"\$\{([^}]+)}", _replace, value)


@lru_cache
def load_config() -> dict:
    """Load config.yml from VOIDRIFT_HOME.

    Returns:
        Parsed config dict with env vars expanded, or empty dict if not found.
    """
    p = _voidrift_home() / "config.yml"
    if not p.exists():
        return {}
    with open(p) as f:
        config = yaml.safe_load(f) or {}

    # Expand env vars in all string values
    def expand_recursive(obj):
        if isinstance(obj, dict):
            return {k: expand_recursive(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [expand_recursive(v) for v in obj]
        if isinstance(obj, str):
            return _expand_env(obj)
        return obj

    return expand_recursive(config)


def clear_config_cache() -> None:
    """Clear the config cache. Used in tests."""
    load_config.cache_clear()


def get_worker_config() -> dict:
    """Get worker section from config."""
    return load_config().get("worker", {})


def get_kiro_config() -> dict:
    """Get kiro section from config."""
    return load_config().get("kiro", {})


def get_api_key(provider: str) -> str | None:
    """Get API key for a provider."""
    return load_config().get("api_keys", {}).get(provider)


def voidrift_home() -> Path:
    """Return the framework config directory (public API)."""
    return _voidrift_home()
