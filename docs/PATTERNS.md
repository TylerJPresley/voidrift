# Patterns & Practices

This document defines the architectural patterns and coding practices for VoidRift. All contributors must follow these. PRs that violate these patterns will be rejected.

---

## Clean Architecture

VoidRift follows Clean Architecture (Ports & Adapters). The dependency rule is absolute: **dependencies point inward.**

```
┌─────────────────────────────────────────────────────────────┐
│  FRAMEWORKS & DRIVERS (outermost)                           │
│  TUI (React/Ink), VS Code, Electron, CLI                    │
├─────────────────────────────────────────────────────────────┤
│  INTERFACE ADAPTERS                                         │
│  CoreAPI, JSON-RPC serve, DTOs                              │
├─────────────────────────────────────────────────────────────┤
│  USE CASES / APPLICATION LOGIC                              │
│  ExecuteTurn, ActivateAgent, orchestration                  │
├─────────────────────────────────────────────────────────────┤
│  ENTITIES / DOMAIN (innermost)                              │
│  PlanManager, MemoryRegistry, SkillManager,                 │
│  AgentRegistry, SessionBrain, ContextManager                │
└─────────────────────────────────────────────────────────────┘
```

### Rules

1. **Nothing inner imports anything outer.** Entities never import CoreAPI, React, Ink, or framework code.
2. **Domain classes never import `fs`, `child_process`, or network modules.** All I/O goes through repository interfaces.
3. **Frameworks depend on interfaces, not implementations.** The TUI imports `CoreAPI` — it never reaches into the engine.
4. **New features start at the entity layer.** Define the domain logic first, then expose it through use cases and the API.

---

## Single Entry Point

```typescript
import { createCore } from "voidrift";
const core = await createCore({ workspaceRoot: process.cwd() });
```

`createCore()` is the **only** function clients need. It returns a fully bound `CoreAPI`. No engine, no subsystems, no internal types leak out.

### What clients can import

```typescript
// Factory
import { createCore } from "voidrift";

// Types (for type annotations)
import type { CoreAPI, StreamChunk, CreateCoreOptions } from "voidrift";

// Public utilities (if needed)
import { AutocompleteEngine } from "voidrift";
```

### What clients must NEVER import

```typescript
// ❌ Internal types
import type { EngineContext } from "voidrift";
import type { ContextManager } from "voidrift";

// ❌ Subsystems
import { AgentRegistry, PlanManager } from "voidrift";

// ❌ Infrastructure
import { createEngine } from "voidrift";
```

---

## CoreAPI Namespace Pattern

CoreAPI uses domain namespaces. Each namespace groups related operations:

```typescript
core.session.*     // Turn execution, commands, shutdown
core.agents.*      // Agent CRUD, activate, cycle
core.plan.*        // Plan item CRUD
core.memory.*      // Load/unload memories
core.models.*      // Switch models, stats, context detail
core.skills.*      // List/reindex skills
core.tools.*       // List available tools
core.mcp.*         // MCP server management
core.templates.*   // Template overrides
core.prompts.*     // Prompt overrides
core.policy.*      // Security rules
core.audit.*       // Event history
core.workspace.*   // File ops, config, tasks
core.plugins.*     // Plugin listing
core.register.*    // Extend the harness
core.events.*      // Pub/sub
```

### Adding a new method

1. Identify which namespace it belongs to
2. Add the method to the namespace getter in `src/plugins/interface.ts`
3. If it returns structured data, define a DTO in `src/operator/dto.ts`
4. If it's called from serve.ts, add the JSON-RPC method constant to `src/operator/protocol.ts`
5. Add the handler in `src/serve.ts`

### Rules

- Methods return DTOs (plain JSON-safe objects), not entity instances
- Methods never expose internal types (no `ContextManager`, no `AgentManifest` in return types)
- Mutations go through the API — no direct subsystem access

---

## Repository Pattern

Every domain class that does persistence uses a repository interface.

```typescript
// Interface (abstraction)
export interface PlanRepository {
  all(): PlanItem[];
  get(filename: string): PlanItem | null;
  save(filename: string, item: Omit<PlanItem, "filename">): void;
  remove(filename: string): boolean;
  readonly dir: string;
}

// Production implementation
export class FileSystemPlanRepository implements PlanRepository { ... }

// Testing implementation
export class InMemoryPlanRepository implements PlanRepository { ... }
```

### Existing repositories

| Domain Class | Repository Interface | Production | Testing |
|---|---|---|---|
| PlanManager | PlanRepository | FileSystemPlanRepository | InMemoryPlanRepository |
| MemoryRegistry | MemoryRepository | FileSystemMemoryRepository | InMemoryMemoryRepository |
| SkillManager | SkillRepository | FileSystemSkillRepository | InMemorySkillRepository |
| SessionBrain | SessionRepository | FileSystemSessionRepository | InMemorySessionRepository |
| AgentRegistry | AgentRepository | FileSystemAgentRepository | InMemoryAgentRepository |

### Adding a new repository

1. Define the interface in a `*-repository.ts` file next to the domain class
2. Implement `FileSystem*Repository` (production) in the same file
3. Implement `InMemory*Repository` (testing) in the same file
4. Update the domain class constructor to accept the interface (default to filesystem)
5. Export from `src/index.ts`
6. Write tests using the in-memory implementation

### Rules

- Domain classes depend on the **interface**, not the implementation
- Constructors accept an optional repository parameter (backward compat: default to filesystem)
- Repository methods are CRUD only — no business logic
- Business logic (compile, resolve, discover) stays on the domain class

---

## Use Case Pattern

Use cases encapsulate multi-step orchestration that spans multiple entities.

```typescript
// src/use-cases/activate-agent.ts
export interface ActivateAgentDeps {
  agents: AgentRegistry;
  prompts: PromptRegistry;
  context: ContextManager;
  skills: SkillManager;
  config: VoidRiftConfig;
  workspaceRoot: string;
}

export function activateAgent(id: string, deps: ActivateAgentDeps): AgentManifest {
  // 1. Set active agent
  // 2. Build persona
  // 3. Set tools
  // 4. Load skills
  // 5. Load resources
  return agent;
}
```

### When to create a use case

- The operation touches 3+ entities/subsystems
- The operation has a meaningful workflow (not just a getter)
- The logic doesn't belong to any single entity

### When NOT to create a use case

- Simple CRUD (delegate directly from CoreAPI to repository)
- Data transformation (belongs in the DTO layer)
- Single-entity operations (belongs on the entity itself)

### Rules

- Use cases are plain functions (not classes)
- Dependencies are injected via a typed `Deps` interface
- No framework imports (no React, no Ink, no Express)
- CoreAPI calls use cases — use cases never call CoreAPI

---

## Declarative Panel Pattern

Panels that display data and handle simple interactions should use the declarative schema:

```typescript
const schema: PanelSchema = {
  id: "plan",
  title: "Plan",
  pages: ["now", "next", "later"],
  layout: {
    type: "list",
    columns: [{ key: "description", label: "Description" }],
    getItems: (page) => core.plan.list().items.filter(i => i.priority === page),
    cursor: true,
  },
  actions: [
    { key: "delete", label: "Remove", handler: (item) => core.plan.remove(item._filename) },
  ],
};

return <DeclarativePanel schema={schema} onClose={onClose} />;
```

### When to use declarative

- List/detail views with simple actions
- Key-value displays
- Scrollable text content
- Pages with tab navigation

### When to use custom components

- Multi-step input flows (scope → name → submit)
- Complex inline editing
- Custom keyboard handling beyond cursor/actions
- State machines (confirmation dialogs, rename flows)

### ActionContext

Actions receive an `ActionContext` with panel controls:

```typescript
handler: async (item, page, ctx) => {
  ctx.close();                              // Close the panel
  ctx.refresh();                            // Re-render with fresh data
  ctx.setMessage("Done!");                  // Show status message
  const name = await ctx.prompt("Name:");   // Text input prompt
}
```

---

## Event Bus Pattern

Subsystems communicate through typed events. No direct imports between unrelated modules.

```typescript
// Publishing
bus.publish("PLAN_ITEM_ADDED", { name, priority, description });

// Subscribing
bus.subscribe("TURN_COMPLETE", (event) => {
  // React to turn completion
});

// Await all subscribers (lifecycle events)
await bus.publishAndWait("TURN_BEFORE", { userMessage, ... });
```

### Rules

- Events are typed in `src/events/bus.ts` (EventPayloadMap)
- `publishAndWait` for lifecycle events where ordering matters (TURN_BEFORE, TURN_AFTER)
- `publish` for fire-and-forget notifications (FILE_MODIFIED, TURN_COMPLETE)
- Subscribers must not throw — errors are caught and logged
- Plugins use `core.events.subscribe()` — same mechanism, same priority

---

## Tool Registration Pattern

Tools are registered, not hardcoded. Adding a tool never touches the orchestration loop.

```typescript
// src/orchestration/tool-registry.ts
registerToolExecutor({
  name: "my_tool",
  async execute(args, ctx) {
    // ctx.workspaceRoot, ctx.config, ctx.context, ctx.planManager, ctx.scheduler
    return "result string";
  },
});
```

### Rules

- Tool schemas defined in `src/tools/langchain-tools.ts` (Zod = single source of truth)
- Tool executors registered in `src/orchestration/tool-registry.ts`
- Display metadata derived from Zod via `zod-to-json-schema` (never duplicated)
- MCP tools route through the same permission gate as built-in tools
- graph.ts never has a switch block for tool names

---

## Plan-Backed Execution Pattern

Plans can declare execution scope. When a "now" plan has scope, the permission gate auto-approves within those boundaries.

```yaml
---
priority: now
description: Refactor auth module
write: ["src/auth/**", "tests/auth/**"]
execute: ["bun run test", "bun run lint"]
---
```

### How it works

1. Model creates a plan with scope via `add_plan(..., scope: { write: [...], execute: [...] })`
2. Plan saves to `.voidrift/plan/` with scope in frontmatter
3. On each tool call, the permission gate checks: is this within a "now" plan's scope?
4. If yes → auto-approve (no prompt)
5. If no → prompt as normal
6. No scope declared → current behavior (graceful degradation)

### Degradation

```
Plan with scope   → sandbox mode (zero prompts within boundaries)
Plan without scope → plan exists for guidance, per-action approval
No plan           → current behavior (per-action or trust rules)
```

### Rules

- Only "now" plans activate scope (user must direct execution)
- Scope covers: `write_file`, `edit_file`, `execute_command`
- Patterns use glob matching (`**` for recursive, `*` for single level)
- The plan IS the user's approval — no separate "approve scope" step
- Trivial one-file actions don't need a plan

---

## Context Layer Pattern

The context window is assembled in four layers ordered by ascending volatility:

| Layer | Volatility | Cache Behavior | Content |
|-------|-----------|----------------|---------|
| Agent | Static | Always cached | Persona, tool schemas, bound skills, indexes |
| Orbit | Low | Usually cached | Active plan, triggered skills, loaded memories |
| Drift | Medium | Rarely cached | Focused files, git status |
| Void | High | Never cached | Messages, diagnostics, turn context |

### Rules

- Stable content at the top = provider cache hits = faster + cheaper
- Skills/memories use progressive disclosure (indexes in Agent, full content in Orbit)
- Focused files are summaries — always `read_file()` for real content
- Plugins inject via `registerContextProvider(layer, key, fn)`

---

## Testing Patterns

### Unit tests (domain logic)

```typescript
import { PlanManager } from "../../src/session/plan.js";
import { InMemoryPlanRepository } from "../../src/session/plan-repository.js";

it("adds a plan item", () => {
  const repo = new InMemoryPlanRepository();
  const pm = new PlanManager(repo);
  pm.add("task", "Do thing", "", "now");
  expect(pm.all()).toHaveLength(1);
});
```

- Use in-memory repositories
- No filesystem, no network
- Test domain logic in isolation

### Integration tests

```typescript
import { createCore } from "../../src/bootstrap/core.js";

it("full turn flow", async () => {
  const core = await createCore({ workspaceRoot: tmpDir });
  const result = await core.session.execute("hello", { onChunk: () => {} });
  expect(result).toBeDefined();
});
```

- Use real implementations against temp directories
- Test the full stack through CoreAPI
- Clean up after each test

### Panel schema tests

```typescript
it("defines a valid panel", () => {
  const schema: PanelSchema = { ... };
  expect(schema.layout.type).toBe("list");
  expect(schema.actions![0].key).toBe("c");
});
```

- Validate schema structure
- Test action handlers with mock ActionContext
- No React rendering needed

---

## File Naming Conventions

| Pattern | Example | Purpose |
|---------|---------|---------|
| `*-repository.ts` | `plan-repository.ts` | Repository interface + implementations |
| `*.test.ts` | `plan-repository.test.ts` | Tests mirror source structure |
| `use-cases/*.ts` | `activate-agent.ts` | Use case functions |
| `ui/panels/*.tsx` | `PlanPanel.tsx` | Panel components |
| `ui/*.tsx` | `DeclarativePanel.tsx` | Shared UI components |
| `operator/dto.ts` | — | All DTOs in one file |
| `operator/protocol.ts` | — | JSON-RPC method constants |

---

## PR Checklist

Before submitting a PR, verify:

- [ ] Domain classes have zero `fs`/`child_process` imports
- [ ] New persistence goes through a repository interface
- [ ] New API methods are on a CoreAPI namespace (not standalone exports)
- [ ] New tools registered via `registerToolExecutor()` (not switch blocks)
- [ ] Tests use in-memory repositories (no temp files unless integration test)
- [ ] Panels source data from CoreAPI methods (not engine internals)
- [ ] Events are typed in `EventPayloadMap`
- [ ] `bun run test` passes
- [ ] `bun --bun -e "import './src/index.ts'"` compiles clean
