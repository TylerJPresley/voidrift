# VOIDRIFT-TOOLS

Guardrails for working on VoidRift's tool system — Zod schemas, executor registration, and execution flow.

## Architecture

- `src/tools/langchain-tools.ts` — Zod schemas: single source of truth for all tools
- `src/tools/definitions.ts` — derives display metadata from Zod via `zod-to-json-schema`
- `src/orchestration/tool-registry.ts` — tool executor registry
- `src/agents/registry.ts` — `ALL_TOOLS` and `READ_TOOLS` master lists

## Tool System

- Zod schemas in `src/tools/langchain-tools.ts` define everything: name, description, parameters, types
- `src/tools/definitions.ts` derives display metadata from Zod via `zod-to-json-schema`
- `ALL_TOOLS` is the master list. Every tool the system knows about is here
- `READ_TOOLS` defines the auto-approved subset for read-only agents (plan mode)
- `allowedTools` on an agent = auto-approved through the permission gate without asking

## Adding a Tool

1. Add Zod schema in `src/tools/langchain-tools.ts`
2. Register executor in `src/orchestration/tool-registry.ts` using `registerToolExecutor()`
3. Add tool name to `ALL_TOOLS` in `src/agents/registry.ts`
4. Add to `toolMeta` in `src/tools/definitions.ts` (actionLayer + safetyProfile)
5. Export from `src/index.ts` if needed
6. Add to FEATURES.md tool table

## Rules

- Never add tool execution logic in `graph.ts` as a switch case. Use `tool-registry.ts`.
- Exception: `run_task_agent`, `spawn_subagent`, and MCP tools are handled in `graph.ts` because they need access to the orchestration context (client, config, bus).
- Read tools are `auto-approved`. Write/execute/network tools are `gated`.
- Every tool needs a `describeToolCall` entry in `src/main.tsx` for the TUI spinner display.
- Never add tools to `allowedTools` that write, execute, or hit the network.

## Cross-References

- [ORCHESTRATION](./VOIDRIFT-ORCHESTRATION.md) — tool execution loop, background exec
- [SECURITY](./VOIDRIFT-SECURITY.md) — permission gate, policy engine
- [AGENTS](./VOIDRIFT-AGENTS.md) — allowedTools, approvalMode