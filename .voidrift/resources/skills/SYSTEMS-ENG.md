---
name: SYSTEMS-ENG
description: CLI conventions, stdout/stderr separation, POSIX compliance, signal handling, and packaging for systems engineering.
---

# Domain: Systems Engineering (SYSTEMS-ENG)

## Core Philosophy
- **POSIX Adherence:** Follow Portable Operating System Interface standards for CLI and system tools.
- **Artifact Integrity:** Shared libraries and binaries must be signed, versioned, and reproducible.
- **ABI Stability:** Maintain Application Binary Interface stability to prevent breaking downstream dependencies.

## Implementation Rules
- **Linux Libraries:** Manage `.so` (shared) and `.a` (static) files; correctly handle header installation and `pkg-config`.
- **Packaging:** Build native OS packages (`.deb`, `.rpm`) with proper dependency metadata and installation scripts.
- **Resource Management:** Efficiently manage file descriptors, signals, and memory; avoid heap fragmentation.
- **Standard I/O:** Use `stdout` for results, `stderr` for errors/status; handle SIGINT/SIGTERM gracefully.

## Distribution
- **Registry Standards:** Strictly follow SemVer and registry-specific standards (NPM, PyPI, Cargo, Maven).
- **Integration:** Ensure CLI tools are compatible with shell pipes, redirections, and environment-based configuration.

## CLI Help Convention
- **Structure:** Top-level `--help` uses grouped layout: Getting started (workflow examples with placeholders), Commands (inline options/args visible), subcommand groups (noun-based), environment variables, and a footer pointing to per-command help.
- **Placeholders:** Use angle-bracket placeholders (e.g., `<name>`, `<path>`) — never hardcode concrete values that can change.
- **Descriptions:** One line, operator-facing, no internal references (requirement IDs, implementation details).
- **Ordering:** Commands ordered by workflow, not alphabetically. Subcommands within groups ordered by frequency of use.
- **Subcommand help:** Each command's `--help` shows full description, all options with defaults, and examples where non-obvious.
