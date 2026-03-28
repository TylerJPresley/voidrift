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
    defaults = {"local": 1, "cloud": 8, "gateway": 8}
    val = load_config().get("concurrency", {}).get(model_type)
    if val is not None:
        return int(val)
    return defaults.get(model_type, 2)


def get_retention(scope: str) -> int:
    """Get retention limit. project=runs to keep, global=days to keep."""
    defaults = {"project": 5, "global": 30}
    val = load_config().get("retention", {}).get(scope)
    if val is not None:
        return int(val)
    return defaults[scope]


# Per-phase default max_tokens (REQ-CFG-7)
_PHASE_MAX_TOKENS: dict[str, int] = {
    "triage":       4096,
    "analysis":     2000,
    "synthesis":    2000,
    "consolidation": 8192,
    "task":         4000,
    "plan":         32768,
}

# Model-type default caps (REQ-CFG-6)
_MODEL_TYPE_CAPS: dict[str, int] = {
    "local":   4096,
    "cloud":   32768,
    "gateway": 32768,
}

# Default input char limits per model type (REQ-CFG-6)
_MODEL_INPUT_CHARS: dict[str, int] = {
    "local":   8000,
    "cloud":   0,      # 0 = unlimited
    "gateway": 0,
}


def get_max_tokens(model_type: str, phase: str) -> int:
    """Return max_tokens for an agent given its model type and phase (REQ-CFG-6, REQ-CFG-7).

    Returns min(phase_default, model_type_cap). Both are configurable via
    config.yml limits: section.

    Args:
        model_type: "local", "cloud", or "gateway".
        phase: Phase key matching _PHASE_MAX_TOKENS (e.g. "analysis", "task").
    """
    limits = load_config().get("limits", {})
    cap_key = f"{model_type}_max_tokens"
    cap = int(limits.get(cap_key, _MODEL_TYPE_CAPS.get(model_type, 32768)))
    phase_default = _PHASE_MAX_TOKENS.get(phase, 4096)
    return min(phase_default, cap)


def get_max_input_chars(model_type: str) -> int:
    """Return max input characters for file content sent to analysis agents (REQ-CFG-6).

    Returns 0 for unlimited (cloud/gateway). Configurable via config.yml
    limits.max_input_chars.

    Args:
        model_type: "local", "cloud", or "gateway".
    """
    limits = load_config().get("limits", {})
    if "max_input_chars" in limits:
        return int(limits["max_input_chars"])
    return _MODEL_INPUT_CHARS.get(model_type, 0)


def get_skills_config() -> dict:
    """Get skills section from config (REQ-SKL-3)."""
    return load_config().get("skills", {})


def voidrift_home() -> Path:
    """Return the framework config directory (public API)."""
    return _voidrift_home()
