"""Bash tool factory for per-command run_command handlers (REQ-SEC-4).

Provides BashConfig and create_run_command factory. Each command (develop,
chat, verify) gets its own handler with per-command allowed_patterns,
timeout, and output truncation.
"""

from __future__ import annotations

import fnmatch
import json
import shlex
import subprocess
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class BashConfig:
    """Per-command bash tool configuration."""

    enabled: bool = True
    allowed_patterns: list[str] = field(default_factory=list)
    timeout: int = 120
    max_output_lines: int = 500
    cwd: str | None = None
    spawn_hook: Callable[[str, str | None], tuple[str, str | None]] | None = None


def create_run_command(
    config: BashConfig,
    global_allowed: list[str] | None = None,
    log_path: str | None = None,
) -> Callable[..., str]:
    """Factory: create a run_command handler bound to a BashConfig.

    Args:
        config: Per-command bash configuration.
        global_allowed: Global allowed_commands from config.yml.
        log_path: Path for command execution logging.

    Returns:
        A run_command(cmd, cwd) -> str handler.
    """
    from .security import classify_command

    def run_command(cmd: str, cwd: str = "") -> str:
        if not config.enabled:
            return json.dumps({"error": "Bash tool is disabled for this command.", "exit_code": -1})

        # Per-command allowlist check (narrower than global)
        if config.allowed_patterns:
            stripped = cmd.strip()
            if not any(
                fnmatch.fnmatch(stripped, p) or stripped.startswith(p.rstrip("*").rstrip(" "))
                for p in config.allowed_patterns
            ):
                return json.dumps({
                    "error": f"Command not in allowed patterns for this command. Allowed: {config.allowed_patterns}",
                    "exit_code": -1,
                })

        # Global security classification (block/warn/safe)
        classification = classify_command(cmd, allowed_commands=global_allowed)
        if classification.risk_level == "block":
            _log(log_path, cmd, "block", reasons=classification.reasons)
            return json.dumps({"error": f"Command blocked: {'; '.join(classification.reasons)}", "exit_code": -1})
        if classification.risk_level == "warn":
            _log(log_path, cmd, "warn", reasons=classification.reasons)

        effective_cwd = cwd or config.cwd or None
        effective_cmd = cmd

        if config.spawn_hook:
            effective_cmd, effective_cwd = config.spawn_hook(cmd, effective_cwd)

        args = shlex.split(effective_cmd)
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=config.timeout,
                cwd=effective_cwd,
            )
        except FileNotFoundError:
            return json.dumps({"error": f"Command not found: {args[0]}", "exit_code": 127})
        except subprocess.TimeoutExpired:
            return json.dumps({"error": f"Command timed out after {config.timeout}s", "exit_code": -1})

        stdout = _truncate(result.stdout, config.max_output_lines)
        stderr = _truncate(result.stderr, config.max_output_lines)
        _log(log_path, cmd, classification.risk_level, exit_code=result.returncode)
        return json.dumps({"stdout": stdout, "stderr": stderr, "exit_code": result.returncode})

    return run_command


def _truncate(text: str, max_lines: int) -> str:
    """Truncate text to max_lines, appending a count of omitted lines."""
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text
    return "\n".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} lines truncated)"


def _log(
    log_path: str | None,
    cmd: str,
    level: str,
    exit_code: int | None = None,
    reasons: list[str] | None = None,
) -> None:
    """Log command execution to the command log."""
    if not log_path:
        return
    parts = [f"[CMD_EXEC cmd={cmd!r} classification={level}"]
    if reasons:
        parts.append(f" reasons={reasons}")
    if exit_code is not None:
        parts.append(f" exit_code={exit_code}")
    parts.append("]")
    try:
        with open(log_path, "a") as f:
            f.write("".join(parts) + "\n")
    except OSError:
        pass
