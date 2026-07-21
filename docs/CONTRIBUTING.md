# Contributing to VoidRift

Thank you for your interest in contributing. We welcome bug fixes, feature proposals, documentation improvements, and bug reports.

## Development Setup

### Prerequisites

- **Node.js** ≥ 22
- **npm** (ships with Node)
- **Git** ≥ 2.30

### Installation

```bash
git clone https://github.com/TylerJPresley/voidrift.git
cd voidrift
npm install
```

### Running in Development

VoidRift must be compiled before running. The TUI uses React/Ink which requires the TypeScript build step.

```bash
# Build + run
npm run build && node dist/main.js

# Recommended: create an alias for iterative development
alias voidrift-dev='(cd ~/Projects/voidrift && npm run build) && node ~/Projects/voidrift/dist/main.js'
```

**Do not** run `bun src/main.tsx` from a different directory — it causes session persistence bugs due to module resolution.

### Typechecking & Testing

```bash
# Typecheck (must pass — no errors allowed)
npm run typecheck

# Run tests (vitest)
npm test

# Watch mode
npm run test:watch
```

All PRs must pass both typecheck and tests.

## Project Structure

```
src/
├── adapters/          Model clients (OpenAI, Anthropic, Google), streaming
├── agents/            Agent registry, repository, manifests
├── bootstrap/         Engine initialization, cleanup, retention, validation
├── codemap/           Workspace file indexing, symbol extraction, summarization
├── commands/          Slash command registration
├── config/            Config loading, schema (Zod), writer
├── events/            Event bus
├── infrastructure/    Image extraction, resource loader
├── logging/           Audit logger, log querying
├── mcp/               MCP engine, OAuth, credentials, discovery
├── operator/          DTOs, JSON-RPC protocol
├── orchestration/     Tool loop, guardrails, loop detection, scheduler, tool binding
├── output/            Token budget, truncation, workspace helpers
├── plugins/           CoreAPI (plugin interface), plugin registry
├── prompts/           Prompt registry, builtin prompts
├── router/            Escalation logic
├── safeguards/        Git checkpointing, diff computation
├── security/          Permission gate, policy engine
├── session/           Context manager, brain, compactor, memory, plan, routines, stats
├── skills/            Skill manager, repository, builtins
├── tasks/             Reusable task registry
├── templates/         Template service
├── tools/             Tool schemas (Zod), executors, web tools
├── ui/                TUI components, panels, hooks
├── use-cases/         Application-level orchestration (activate-agent)
├── watcher/           File watcher, resource watcher
├── worktree/          Git worktree engine for subagents
├── engine.ts          Typed engine context interface
├── index.ts           Public exports
├── main.tsx           TUI entry point
├── serve.ts           Headless JSON-RPC mode
└── turn.ts            Turn execution orchestrator
```

## Architecture Rules

### Boundaries

- **Domain classes** (`session/`, `agents/`, `skills/`, `security/`) must not import `fs` directly. Use repository interfaces.
- **UI components** (`ui/`) source all data from CoreAPI namespaces. No direct engine access.
- **CoreAPI** (`plugins/interface.ts`) is the only public surface for plugins. Don't expose engine internals.
- **Tool schemas** live in `tools/langchain-tools.ts` (Zod). `definitions.ts` derives metadata. Never duplicate.
- **Tool execution** uses `orchestration/tool-registry.ts`. Register with `registerToolExecutor()`. No switch blocks in graph.ts.

### Patterns

- **Registration over switch blocks** — open for extension, closed for modification
- **Repository pattern** — all persistence behind interfaces with filesystem + in-memory implementations
- **Event-driven lifecycle** — `TURN_BEFORE` / `TURN_AFTER` subscribers, not hardcoded hooks
- **Four-layer context** — Agent (static) → Orbit (semi-static) → Drift (dynamic) → Void (volatile)

### Naming

- Files: kebab-case (`tool-registry.ts`, `permission-gate.ts`)
- Types: PascalCase (`AgentManifest`, `PolicyEngine`)
- Functions: camelCase (`createRoleAdapter`, `compilePrompt`)
- Agent types: `"interactive"` or `"passive"` (never "task")
- Model roles: `"selected"`, `"utility"`, `"escalation"` (never "flash", "dense", "auto", "tier")

## Testing

Tests mirror the `src/` directory structure under `tests/`.

```
tests/
├── config/
├── orchestration/
├── session/
├── security/
├── ui/
├── router/
└── ...
```

### Conventions

- Use vitest (not bun test — bun's runner has chokidar timing issues)
- Use in-memory repository implementations for unit tests (`InMemoryAgentRepository`, `InMemorySessionRepository`, etc.)
- Mock model calls — don't hit real APIs in tests
- Test file naming: `*.test.ts` or `*.test.tsx`

### Running Specific Tests

```bash
# Single file
npx vitest run tests/orchestration/guardrails.test.ts

# Pattern match
npx vitest run --grep "stall recovery"
```

## Pull Request Guidelines

1. **Keep it focused** — one concern per PR. Split unrelated changes.
2. **Add tests** — bug fixes and features need corresponding tests.
3. **Typecheck and test must pass** — `npm run typecheck && npm test`
4. **No debug artifacts** — remove console.logs, commented code, temp files.
5. **Describe the PR** — summary of changes, what was tested, any blocked items.
6. **Clean history** — rebase on main, no merge commits in your branch.
7. **Don't push to main** — create a feature branch, open a PR.

### PR Title Format

Keep under 70 characters. Use imperative mood:
- ✓ `Add stall recovery via utility classifier`
- ✓ `Fix edit_file reporting success on failure`
- ✗ `Updated the thing`
- ✗ `WIP changes to orchestration`

## What Needs Work

Check the GitHub issues for tagged items. Areas that always welcome contributions:

- **Test coverage** — orchestration (51%), commands (42%), compiler (61%) need improvement
- **Documentation** — SDK examples, CLI tutorials
- **Skills** — domain-specific skill files for common workflows
- **Extractors** — AST-based symbol extraction for more languages (Python, Rust, Go)
- **MCP servers** — tested configurations for popular servers

## Getting Help

Open a discussion on GitHub or check the existing issues. For architecture questions, read [ARCHITECTURE.md](./ARCHITECTURE.md) first.
