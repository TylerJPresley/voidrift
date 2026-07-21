# VOIDRIFT-AGENTS

## Overview

VoidRift's agent system is a discovery, resolution, and execution framework. Agents are named roles with distinct capabilities, each defined by a manifest (`agent.json`) and a behavioral prompt (`prompt.md`). The system discovers agents from the workspace, global config, and plugins, then resolves conflicts through a priority cascade.

## Architecture

- **AgentRegistry** — discovers agents from multiple scopes, resolves conflicts, manages lifecycle
- **Task Registry** — named reusable task definitions with their own prompts and tools
- **Worktree Engine** — git worktree isolation for subagent concurrency (see ORCHESTRATION skill)

## Agent Types

- **Interactive** — user-facing agents that cycle with Shift+Tab (chat, plan, vibe). Designed for direct conversation.
- **Task** — background workers invoked by tools (indexer, summarizer). Designed for autonomous execution.

## Configuration

Each agent is defined by `agent.json` with these fields:

| Field | Purpose | Why It Matters |
|-------|---------|----------------|
| `id` | Unique identifier | Resolves agent references across the system |
| `name` | Display name | Shown in UI panels and agent selection |
| `description` | One-line summary | Used in discovery and agent panel tooltips |
| `type` | `interactive` or `passive` | Determines approval mode and invocation method |
| `role` | `flash`, `utility`, or `dense` | Controls cost vs capability tradeoff |
| `tools` | List of tool names | What the agent can call (auto-approved) |
| `allowedTools` | List of auto-approved tools | Tools that bypass the permission gate |
| `approvalMode` | `prompt`, `deny`, or `autonomous` | How user permission is handled for tool use |

## Resolution Cascade

When multiple scopes define the same agent `id`, the system resolves conflicts in this order:

1. **Workspace override** — `<project>/.voidrift/agents/<id>/` (highest priority)
2. **Global override** — `~/.config/voidrift/agents/<id>/`
3. **Plugin** — installed plugin agent
4. **Core default** — built-in agent (lowest priority)

This allows users to customize any core agent without modifying source code.

## Model Tier Assignment

| Agent type | Default tier | Rationale |
|-----------|-------------|-----------|
| Interactive (chat, vibe) | flash | User-facing chat, smart enough for most tasks, can escalate |
| Interactive (plan) | flash | Read-only analysis, speed matters |
| Task (indexer, summarizer) | utility | Internal background ops, cost matters |
| Preflight classifiers | utility | Harness-internal routing decisions, never user-facing |
| Subagents | flash | Real work in isolated worktrees, needs tool-calling capability |
| Escalated | dense | Complex reasoning |

## Adding a Core Agent

1. Add manifest to `CORE_AGENTS` array in the registry
2. Write the prompt as a const above it
3. Set appropriate `tools`, `allowedTools`, `approvalMode`
4. Agent panel auto-discovers — no UI changes needed

## Rules

- Core agents are hardcoded in `CORE_AGENTS` array. Don't move them to disk.
- Custom agents live in `<scope>/agents/<id>/agent.json` + `prompt.md`.
- `ALL_TOOLS` is the master list. Every tool the system knows about is here.
- `READ_TOOLS` defines the auto-approved subset for read-only agents (plan mode).
- `role: ""` (empty) uses modelSelected. `role: "utility"` uses modelUtility. `role: "escalation"` uses modelEscalation.
- `approvalMode`: `prompt` = ask user, `deny` = only explicit allow rules, `autonomous` = no gate.
- `allowedTools` on an agent = auto-approved through the permission gate without asking.
