# ADR-001: Python CLI Replaces Bash Dispatcher

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley

## Context

The original VoidRift framework used `dispatcher.sh` — a monolithic bash script that orchestrated all five phases, managed model containers via SSH, and invoked aider for AI interactions. As the framework grew, bash limitations became blocking:

- No type safety or structured data (model configs parsed with `grep`/`awk`)
- Error handling via exit codes only — no structured exceptions
- Testing required spawning subprocesses; no unit test isolation
- Aider dependency locked us to its file editing model and context management
- No way to serve MCP tools to models without a separate server process

## Decision

Replace `dispatcher.sh` with a Python monorepo containing two packages:

- `cli/` — Click-based CLI (`voidrift` command) with a custom agent loop that calls model APIs directly and handles MCP tool calls
- `mcp-context-server/` — FastMCP server providing 16 tools for artifact storage, task management, and framework resource access

## Consequences

- **Positive:** Pydantic models for all configs, pytest for testing (180 tests), structured error handling, MCP tool integration, streaming responses
- **Positive:** Agent loop talks directly to OpenAI-compatible APIs — no aider dependency
- **Positive:** Both packages share a VERSION file and install via `pip install -e`
- **Negative:** Python runtime dependency (3.10+) on workstation
- **Negative:** Lost aider's mature file editing engine (SEARCH/REPLACE, repo map) — agent now uses `write_file()` MCP tool
