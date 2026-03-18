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


def expand_config_refs(value: str) -> str:
    """Expand ${section.key} config references and ${VAR} env vars in a string.

    Config references (e.g., ${worker.ip}) are resolved from config.yml.
    Env vars (e.g., ${ANTHROPIC_API_KEY}) are resolved from environment.
    Config refs take precedence over env vars.
    """
    if not isinstance(value, str) or "${" not in value:
        return value

    config = load_config()

    def _replace(m: re.Match) -> str:
        var = m.group(1)
        default = ""
        if ":-" in var:
            var, default = var.split(":-", 1)

        # Try config reference first (section.key)
        if "." in var:
            parts = var.split(".", 1)
            section = config.get(parts[0], {})
            if isinstance(section, dict) and parts[1] in section:
                return str(section[parts[1]])

        # Fall back to env var
        return os.environ.get(var, default)

    return re.sub(r"\$\{([^}]+)}", _replace, value)


def get_worker_config() -> dict:
    """Get worker section from config."""
    return load_config().get("worker", {})


def get_kiro_config() -> dict:
    """Get kiro section from config."""
    return load_config().get("kiro", {})


def get_api_key(provider: str) -> str | None:
    """Get API key for a provider."""
    return load_config().get("api_keys", {}).get(provider)


def get_concurrency(model_type: str) -> int:
    """Get max concurrent workers for a model type. 0 means unbounded."""
    defaults = {"local": 2, "cloud": 8, "gateway": 8}
    val = load_config().get("concurrency", {}).get(model_type)
    if val is not None:
        return int(val)
    return defaults.get(model_type, 2)


def voidrift_home() -> Path:
    """Return the framework config directory (public API)."""
    return _voidrift_home()
