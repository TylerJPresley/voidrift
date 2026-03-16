# ADR-002: MCP Context Server for On-Demand Resource Access

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley

## Context

The aider-based architecture front-loaded all context via `--read` flags and config files. Every develop session loaded AGENT.md, CONVENTIONS.md, EDIT-FORMAT.md, and all tagged skill files into the context window before the model saw the task. This created pressure on local models with limited context windows (65K tokens for qwen3-coder).

## Decision

Build an MCP server that the model calls on demand. Instead of pre-loading full files, the model requests specific sections:

- `get_agent("developer", "escalation")` — returns just the escalation protocol section
- `get_skill("arch-design", "api_standards")` — returns just the API standards section
- `get_next_task("backend")` — returns one task, not the whole file

The server provides 16 tools covering: artifact storage (write-through to memory + disk), task management (per-module queues with write-through), framework resources (agents, skills, templates via markdown section indexing), and file operations.

## Consequences

- **Positive:** Models pull only what they need — smaller context per turn, faster inference
- **Positive:** Write-through storage means no data loss on crash
- **Positive:** Task state managed centrally — CLI doesn't parse TASKS.md directly
- **Positive:** Section-level indexing via markdown headers enables precise retrieval
- **Negative:** Additional process (stdio transport, started by CLI)
- **Negative:** Models must know which tools to call — requires good system prompts
