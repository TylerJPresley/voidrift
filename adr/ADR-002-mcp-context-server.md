# ADR-002: MCP Context Server for On-Demand Resource Access

**Date:** 2026-03-15
**Status:** Accepted

## Context

Models have limited context windows (65K tokens for local models). Loading full framework files upfront wastes tokens on content the model may never need for a given task.

## Decision

Build an MCP server that models call on demand. Instead of pre-loading full files, the model requests specific sections:

- `get_agent("developer", "escalation")` — just the escalation protocol
- `get_skill("arch-design", "api_standards")` — just the API standards section
- `get_next_task("backend")` — one task, not the whole file

The server provides 16 tools covering: artifact storage (write-through to memory + disk), task management (per-module queues), framework resources (agents, skills, templates via markdown section indexing), and file operations.

## Consequences

- Models pull only what they need — smaller context per turn, faster inference
- Write-through storage means no data loss on crash
- Task state managed centrally — CLI doesn't parse TASKS.md directly
- Section-level indexing via markdown headers enables precise retrieval
- Models must know which tools to call — requires good system prompts
