# VoidRift — Project Instructions

This file is loaded into the model's context when working on this codebase. Follow these rules absolutely.

## Architecture: Clean Architecture

VoidRift follows Clean Architecture. The dependency rule is inviolable: **dependencies point inward.**

```
Frameworks (TUI, VS Code) → CoreAPI → Use Cases → Entities → (nothing)
```

### The Layers

1. **Entities** (innermost): PlanManager, MemoryRegistry, SkillManager, AgentRegistry, SessionBrain, ContextManager. Pure domain logic. ZERO `fs`, `child_process`, or network imports.

2. **Use Cases**: src/use-cases/ + turn.ts. Orchestrate multiple entities. No framework knowledge.

3. **Interface Adapters**: CoreAPI (src/plugins/interface.ts). The sole boundary between clients and business logic.

4. **Frameworks** (outermost): main.tsx, serve.ts, headless.ts, panels/. Import only `createCore` + public types.

### Rules You Must Follow

- **Never add `fs` or `child_process` imports to domain classes.** If you need persistence, use the existing repository interface or create a new one.
- **Never access engine internals from client code.** All data flows through CoreAPI namespaces (`core.plan.*`, `core.agents.*`, etc.).
- **Never expose internal types through CoreAPI.** Return DTOs (plain objects), not entity instances.
- **New persistence = new repository.** Define an interface, implement FileSystem + InMemory versions.
- **New tools = `registerToolExecutor()`.** Never add switch blocks to graph.ts.
- **New API methods go on CoreAPI namespaces.** Not standalone exports.
- **Tests use InMemory repositories.** No filesystem in unit tests.
- **Plans can declare scope** (`write: [globs]`, `execute: [patterns]`). The permission gate auto-approves within scope. This is how plan-backed execution works.
- **Loop detection is enforced.** 3 consecutive errors or 4 failures of the same tool = hard termination. The model is told to reassess.
- **Tool descriptions are prompt engineering.** Write them with new-hire depth (when to use, when not to, examples, failure modes).

## Repository Pattern

Every domain class uses a repository interface for I/O:

| Domain Class | Repository | Location |
|---|---|---|
| PlanManager | PlanRepository | src/session/plan-repository.ts |
| MemoryRegistry | MemoryRepository | src/session/memory-repository.ts |
| SkillManager | SkillRepository | src/skills/repository.ts |
| SessionBrain | SessionRepository | src/session/session-repository.ts |
| AgentRegistry | AgentRepository | src/agents/repository.ts |

Each has a `FileSystem*` (production) and `InMemory*` (testing) implementation.

## CoreAPI

Single interface. 16 namespaces. All clients use it.

```typescript
const core = await createCore();
core.session.execute(text, { onChunk });
core.plan.add({ name, description, priority });
core.agents.activate("vibe");
core.memory.load(id);
```

## Key Files

- `src/plugins/interface.ts` — CoreAPI class (the boundary)
- `src/bootstrap/core.ts` — createCore() factory
- `src/turn.ts` — ExecuteTurn use case
- `src/use-cases/activate-agent.ts` — ActivateAgent use case
- `src/orchestration/graph.ts` — Tool execution loop
- `src/session/context.ts` — 4-layer context manager
- `src/events/bus.ts` — Typed event bus
- `src/operator/dto.ts` — All DTOs
- `src/operator/protocol.ts` — JSON-RPC method constants

## Testing

- `bun run test` — vitest
- Unit tests use InMemory repositories (no filesystem)
- Tests mirror src/ directory structure

## What NOT to Do

- Don't import from `src/engine.ts` in client code
- Don't use `require("fs")` in domain classes
- Don't add methods to CoreAPI that return raw subsystem instances
- Don't create switch blocks for tool dispatch
- Don't make panels import session/agent/memory subsystems directly
- Don't add `_engine` or `_service` accessors
