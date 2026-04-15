"""Command security classification for run_command (TASK-FW-020)."""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class CommandClassification:
    risk_level: Literal["safe", "warn", "block"]
    reasons: list[str] = field(default_factory=list)


# Patterns that block execution entirely
_BLOCK_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"rm\s+-[^\s]*r[^\s]*f[^\s]*\s+/\s*$|rm\s+-[^\s]*f[^\s]*r[^\s]*\s+/\s*$"), "destructive recursive delete of /"),
    (re.compile(r"rm\s+-[^\s]*r[^\s]*f[^\s]*\s+~/?\s*$|rm\s+-[^\s]*f[^\s]*r[^\s]*\s+~/?\s*$"), "destructive recursive delete of home"),
    (re.compile(r":\(\)\s*\{.*\|.*&\s*\}\s*;"), "fork bomb"),
    (re.compile(r"dd\s+if=/dev/zero"), "disk overwrite"),
    (re.compile(r"mkfs\b"), "filesystem format"),
    (re.compile(r"(curl|wget)\s+[^\|]+\|\s*(bash|sh|zsh)\b"), "remote code execution via pipe"),
    (re.compile(r"chmod\s+777\s+/"), "world-writable root"),
]

# Paths that block when targeted for writes
_BLOCK_WRITE_PATHS = re.compile(r"(?:>|>>)\s*(?:/etc/|/boot/|/sys/|/proc/)")

# Patterns that warn but allow execution
_WARN_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"rm\s+-[^\s]*r[^\s]*f"), "recursive force delete"),
    (re.compile(r"git\s+push\s+--force"), "force push"),
    (re.compile(r"git\s+reset\s+--hard"), "hard reset"),
    (re.compile(r"\bsudo\b"), "elevated privileges"),
    (re.compile(r"chmod\s+-R"), "recursive permission change"),
    (re.compile(r"pip\s+install.*--break-system-packages"), "system package modification"),
]


def classify_command(
    command: str,
    allowed_commands: list[str] | None = None,
) -> CommandClassification:
    """Classify a shell command by risk level.

    Args:
        command: The shell command string.
        allowed_commands: Glob patterns that override classification to safe.

    Returns:
        CommandClassification with risk_level and reasons.
    """
    cmd = command.strip()

    # Allowlist check — glob match against command
    if allowed_commands:
        for pattern in allowed_commands:
            if fnmatch.fnmatch(cmd, pattern) or cmd.startswith(pattern.rstrip("*").rstrip(" ")):
                return CommandClassification(risk_level="safe")

    # Block checks
    reasons: list[str] = []
    for pat, reason in _BLOCK_PATTERNS:
        if pat.search(cmd):
            reasons.append(reason)
    if _BLOCK_WRITE_PATHS.search(cmd):
        reasons.append("write to protected system path")
    if reasons:
        return CommandClassification(risk_level="block", reasons=reasons)

    # Warn checks
    for pat, reason in _WARN_PATTERNS:
        if pat.search(cmd):
            reasons.append(reason)
    if reasons:
        return CommandClassification(risk_level="warn", reasons=reasons)

    return CommandClassification(risk_level="safe")
