# ADR-001: Python CLI with Custom Agent Loop

**Date:** 2026-03-15
**Status:** Accepted

## Context

The framework needs a CLI that orchestrates five phases, manages model containers, and enables models to interact with project artifacts via tool calls. The agent loop must support both local (OpenAI-compatible) and cloud APIs with streaming.

## Decision

A Python Click-based CLI (`voidrift` command) with a custom agent loop that calls model APIs directly and handles MCP tool calls. Two editable packages in a monorepo: `cli/` and `mcp-context-server/`.

## Consequences

- Pydantic models for all configs, pytest for testing, structured error handling
- Agent loop talks directly to OpenAI-compatible APIs — supports local vLLM and cloud providers
- MCP tool integration gives models on-demand access to project context
- Both packages share a VERSION file and install via `pip install -e`
- Python 3.10+ runtime dependency on workstation
