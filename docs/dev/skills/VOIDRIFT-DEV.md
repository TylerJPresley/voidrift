# VOIDRIFT-DEV

Development conventions for working on VoidRift itself.

## Project Identity

VoidRift is a local-first, model-agnostic AI harness. React/Ink TUI + headless JSON-RPC mode. Single binary, two modes: `voidrift` (TUI) and `voidrift --serve` (headless).

## Code Conventions

- TypeScript strict mode, ESM with `.js` extensions in imports
- LangChain is the model abstraction layer
- Zod for tool schemas (single source of truth in `langchain-tools.ts`)
- Registration patterns over switch blocks
- Panels are individual files in `src/ui/panels/`
- Tests: vitest, mirror `src/` directory structure

## Architecture

- **Three surfaces:** CoreAPI (plugins), OperatorAPI (frontends), raw exports (internal)
- **Four context layers:** Agent → Orbit → Drift → Void (ascending volatility)
- **Three tiers:** flash (chat + subagents), utility (preflight classifiers + internal ops), dense (escalation)
- **Tool execution:** `src/orchestration/tool-registry.ts` — register with `registerToolExecutor()`

## Adding a Feature

1. Define the tool schema in `src/tools/langchain-tools.ts` (Zod)
2. Register the executor in `src/orchestration/tool-registry.ts`
3. Add to `ALL_TOOLS` in `src/agents/registry.ts`
4. Create a corresponding builtin skill in `src/skills/builtins.ts`
5. Add brief pointer to `core.rules` in `src/prompts/registry.ts`
6. Export from `src/index.ts`
7. Update `docs/FEATURES.md`

## Adding a Skill

Source of truth: `docs/dev/skills/` for VoidRift dev skills, `docs/skills/` for user-facing skills.

1. Write the skill in `docs/dev/skills/VOIDRIFT-<NAME>.md` (dev) or `docs/skills/<NAME>.md` (user)
2. Copy to `.voidrift/skills/` with frontmatter to activate in workspace
3. For builtin skills: register in `src/skills/builtins.ts`

## File Locations

| What | Where |
|------|-------|
| VoidRift dev skills (source) | `docs/dev/skills/VOIDRIFT-*.md` |
| User-facing skills (distribution) | `docs/skills/*.md` |
| Active workspace skills | `.voidrift/skills/*.md` |
| Global user skills | `~/.config/voidrift/skills/*.md` |
| Builtin skills (compiled) | `src/skills/builtins.ts` |
| Core rules | `src/prompts/registry.ts` |
| Tool schemas | `src/tools/langchain-tools.ts` |
| Tool executors | `src/orchestration/tool-registry.ts` |

## Testing

- `bun run test` (vitest)
- Test files in `tests/` mirroring `src/`
- Currently 296+ tests passing

## Git

- `.voidrift/` is gitignored (runtime state)
- `docs/` is tracked (ships with npm package)
- Development on feature branches, merge to main

## Document Creation

When the model creates documents during a session (analysis results, reports, intermediate artifacts):
- **Always write to `.voidrift/cache/<session-id>/` by default** — ephemeral, session-scoped, gitignored
- **Only write to tracked paths (`docs/`, `src/`, project root) when explicitly directed by the user**
- Rationale: prevents garbage accumulation in the repo. Cache is cheap and disposable. Real documents require intentional placement.

Exceptions:
- Plan items → `.voidrift/plan/` (managed by plan tools)
- Memories → `.voidrift/memory/` (managed by memory tools)
- Skills → `docs/dev/skills/` or `.voidrift/skills/` (managed by skill workflow)

## Principles

- No backwards compatibility concerns — this is a new product
- Fix it right the first time. No bandaids.
- Every core feature gets a builtin skill. No exceptions.
- `core.rules` is behavioral only. Feature knowledge lives in skills.
- Skills are the model's native knowledge mechanism. Prefer skills over docs/.
