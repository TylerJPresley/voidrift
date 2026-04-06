"""Framework configuration loader (REQ-CFG-1..4).

Loads config from ~/.voidrift/config.yml with env var expansion.
Operational limits (max_tokens, concurrency, etc.) live on each model entry
in the models file — not in config.yml. See models.py and REQ-MC-3.
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
    """Expand ${section.key} config references and ${VAR} env vars in a string."""
    if not isinstance(value, str) or "${" not in value:
        return value

    config = load_config()

    def _replace(m: re.Match) -> str:
        var = m.group(1)
        default = ""
        if ":-" in var:
            var, default = var.split(":-", 1)
        if "." in var:
            parts = var.split(".", 1)
            section = config.get(parts[0], {})
            if isinstance(section, dict) and parts[1] in section:
                return str(section[parts[1]])
        return os.environ.get(var, default)

    return re.sub(r"\$\{([^}]+)}", _replace, value)


def get_models_file() -> Path:
    """Get the path to the models registry file (REQ-MC-1, REQ-CFG-2).

    Reads ``models_file`` from config.yml, defaulting to ``~/.worker-cli/models.yml``.
    """
    configured = load_config().get("models_file", "")
    if configured:
        return Path(os.path.expanduser(configured))
    return Path.home() / ".worker-cli" / "models.yml"


def get_api_key(provider: str) -> str | None:
    """Get API key for a provider."""
    return load_config().get("api_keys", {}).get(provider)


def get_retention(scope: str) -> int:
    """Get retention limit. project=runs to keep, global=days to keep."""
    defaults = {"project": 5, "global": 30}
    val = load_config().get("retention", {}).get(scope)
    if val is not None:
        return int(val)
    return defaults[scope]


# Per-stage default max_tokens (REQ-CFG-7)
_STAGE_MAX_TOKENS: dict[str, int] = {
    "triage":           4096,
    "analysis":         2000,
    "synthesis":        2000,
    "consolidation":    8192,
    "task":             4000,
    "plan":             32768,
    "verify-plan":      32768,
    "verify-execute":   8192,
}


def get_max_tokens(mc: "ModelConfig", stage: str) -> int:  # noqa: F821
    """Return max_tokens for an agent: min(stage_default, model.max_tokens) (REQ-CFG-7).

    Args:
        mc: Resolved ModelConfig with max_tokens field.
        stage: Stage key (e.g. "analysis", "task", "plan").
    """
    stage_default = _STAGE_MAX_TOKENS.get(stage, 4096)
    return min(stage_default, mc.max_tokens)


def get_protected_paths() -> list[str]:
    """Get protected_paths list from config (TASK-FW-013)."""
    return load_config().get("protected_paths", [])


def get_allowed_commands() -> list[str]:
    """Get allowed_commands list from config (TASK-FW-020)."""
    return load_config().get("allowed_commands", [])


def get_ssrf_allow_list() -> list[str]:
    """Get ssrf_allow_list from config (REQ-SEC-3)."""
    return load_config().get("ssrf_allow_list", [])


def get_git_diff_limits() -> dict:
    """Get git diff safety limits from config (REQ-GIT-4)."""
    return load_config().get("git", {})


def get_cache_config() -> dict:
    """Get cache section from config (REQ-U-14)."""
    return load_config().get("cache", {})


def get_skills_config() -> dict:
    """Get skills section from config (REQ-SKL-3)."""
    return load_config().get("skills", {})


def get_bash_config(command: str) -> "BashConfig":
    """Get per-command bash configuration (REQ-CFG-9).

    Args:
        command: Command name (develop, chat, verify).

    Returns:
        BashConfig with merged global defaults and command-specific overrides.
    """
    from .tools.bash import BashConfig

    bash_section = load_config().get("bash", {})
    timeout = int(bash_section.get("timeout", 120))
    max_output_lines = int(bash_section.get("max_output_lines", 500))

    cmd_section = bash_section.get(command, {})
    return BashConfig(
        enabled=cmd_section.get("enabled", True),
        allowed_patterns=cmd_section.get("allowed_patterns", []),
        timeout=int(cmd_section.get("timeout", timeout)),
        max_output_lines=int(cmd_section.get("max_output_lines", max_output_lines)),
    )


def voidrift_home() -> Path:
    """Return the framework config directory (public API)."""
    return _voidrift_home()
