---
priority: now
description: Comprehensive SOLID audit report with violations, severity, and remediation recommendations
rationale: Full audit results from reading all key files across the codebase
---

# VoidRift SOLID Principles Audit Report

**Date:** 2025-01-XX  
**Scope:** Full codebase audit of `src/` directory  
**Severity Legend:** 🔴 Structural (requires refactoring) · 🟠 Local (fixable in-place) · 🟡 Design smell (acceptable for now)

---

## 1. Single Responsibility Principle (SRP)

### 🔴 VIOLATION 1.1 — `src/main.tsx` is a God File

**Location:** `src/main.tsx` (600+ lines)  
**Responsibilities conflated:**
- Presentational React components (Welcome, UserMessage, ToolGroup, DiffDisplay, etc.)
- Tool description logic (`describeToolCall` — 60+ line switch)
- App state management (history, streaming, tool confirmation, autocomplete, input history)
- Input handling (useInput with 100+ line handler covering escape, tab, ctrl+c, arrow keys)
- Slash command dispatch (inline handler for `/quit`, `/clear`, etc.)
- Turn execution orchestration (calls `executeTurn`, manages streaming state)
- Signal handlers (graceful shutdown)
- Bootstrap execution (top-level `await createEngine()`)

**Impact:** Every change to any feature requires touching this file. The `useInput` callback alone is ~150 lines handling 8+ distinct concerns.

**Remediation:**
1. Extract presentational components → already partially done in `src/ui/panels/`, but these components live in `main.tsx`
2. Extract `describeToolCall` → `src/ui/tool-descriptions.ts`
3. Extract input handler → `src/ui/use-input-handler.ts`
4. Extract command dispatch → `src/ui/command-dispatcher.ts`
5. Extract turn execution UI state → `src/ui/use-turn-state.ts` (custom hook)
6. Keep only composition + render in `main.tsx`

### 🔴 VIOLATION 1.2 — `src/orchestration/graph.ts` Handles Too Many Concerns

**Location:** `src/orchestration/graph.ts` (~250 lines)  
**Responsibilities conflated:**
- Tool call execution delegation (delegates to `executeRegisteredTool`)
- Permission gate management (creates `PermissionGate`, checks approval)
- File context management (summarizes files on read, manages drift focus)
- Task agent spawning (inline subagent creation with `createTierAdapter`)
- MCP tool routing (regex parsing of `mcp_` names)
- Tool deduplication logic
- Fallback tier management
- Final text-response nudge logic

**Impact:** Adding a new tool category (e.g., MCP, task agents) requires modifying the orchestration core.

**Remediation:**
1. Extract task agent spawning → `src/orchestration/task-agent.ts`
2. Extract file context management → `src/orchestration/context-manager.ts`
3. Extract MCP routing → already partially in `src/mcp/router.ts`, use it consistently
4. Keep `graph.ts` focused on the tool-loop control flow only

### 🟠 VIOLATION 1.3 — `src/mcp/engine.ts` is a God Class

**Location:** `src/mcp/engine.ts` (~350 lines)  
**Responsibilities conflated:**
- Server lifecycle (connect, disconnect, shutdown)
- Config management (load, save, remove, get configs)
- Auth handling (OAuth credential resolution)
- Transport creation (stdio, HTTP)
- Request handler setup (roots, sampling, elicitation)
- Tool/resource/prompt discovery
- Tool execution (`callTool`)
- Resource reading, prompt retrieval
- Completion, logging level, subscription management
- Health checking (`ping`)

**Impact:** Any MCP protocol change touches this entire file.

**Remediation:**
1. Extract config management → `src/mcp/config-store.ts`
2. Extract auth handling → `src/mcp/auth.ts` (already partially in `credentials.ts`)
3. Extract transport creation → `src/mcp/transport.ts`
4. Keep `engine.ts` as the coordinator only

### 🟠 VIOLATION 1.4 — `src/security/policy-engine.ts` Handles Classification + Rules + Persistence

**Location:** `src/security/policy-engine.ts` (~300 lines)  
**Responsibilities conflated:**
- Shell command classification (`classifyCommand`, `SAFE_COMMAND_PREFIXES`, `DANGEROUS_PATTERNS`)
- Pattern matching (`matchGlob`, `matchCommandPattern`, `ruleMatchesTool`)
- Policy rule evaluation (`check`, `findHighestPriorityMatch`)
- Rule persistence (load/save to disk)
- Pattern inference (`inferPattern`, `inferPatterns`)
- Workspace boundary enforcement

**Impact:** Adding new command patterns or changing classification logic requires understanding the entire file.

**Remediation:**
1. Extract shell classification → `src/security/command-classifier.ts`
2. Extract pattern matching → `src/security/pattern-matcher.ts`
3. Extract persistence → `src/security/policy-store.ts`
4. Keep `policy-engine.ts` as the coordinator

---

## 2. Open/Closed Principle (OCP)

### 🔴 VIOLATION 2.1 — Tool Execution via Switch/Registry Hybrid

**Location:** `src/orchestration/graph.ts` (lines ~80-180)  
**Problem:** The tool execution loop has inline special-case handling for:
- `read_file` → file context management
- `run_task_agent` → subagent spawning
- `mcp_*` tools → MCP routing
- Everything else → `executeToolCall`

Adding a new tool category requires modifying `graph.ts`.

**Remediation:** The cleanup TODO already identifies this. Implement the `ToolExecutor` registration interface:
```typescript
interface ToolExecutor {
  name: string;
  execute(args: any, ctx: ExecutionContext): Promise<string>;
}
```
Register executors by tool name prefix or exact name. The orchestration loop becomes:
```typescript
const executor = executorRegistry.get(toolName);
result = executor ? await executor.execute(args, ctx) : await executeToolCall(toolName, ...);
```

### 🔴 VIOLATION 2.2 — Panel Rendering via Conditional Chain

**Location:** `src/main.tsx` (lines ~500-560)  
**Problem:** 20+ `if (panel === "X")` statements rendering different panels. Adding a panel requires modifying the App component.

**Remediation:**
```typescript
const panelMap = {
  stats: <StatsPanel ... />,
  help: <HelpPanel ... />,
  // ...
};
{panel && panelMap[panel] && <>{panelMap[panel]}</>}
```
Or use a registry pattern where panels register themselves.

### 🟠 VIOLATION 2.3 — Agent Activation via Inline Logic

**Location:** `src/main.tsx` (`activateAgent` function, ~25 lines)  
**Problem:** Agent activation logic (persona loading, resource resolution, focused files) is embedded in the UI component. Adding a new agent resource type requires modifying the UI.

**Remediation:** Extract to `src/agents/activator.ts` with an `activateAgent(agent, context)` function.

### 🟡 VIOLATION 2.4 — Policy Engine is Open/Closed for Rules

**Location:** `src/security/policy-engine.ts`  
**Assessment:** The rule-based system is well-designed for OCP. New rules can be added without modifying the engine. The `check()` method is closed for modification but open for extension via rule registration.

---

## 3. Liskov Substitution Principle (LSP)

### 🟡 VIOLATION 3.1 — No Obvious LSP Violations Found

**Assessment:** The codebase uses composition over inheritance extensively. The few class hierarchies found (`EventBus` wrapping `EventEmitter`, `ContextManager` with layered partitions) don't exhibit LSP violations. The `AgentManifest` interface is consistently implemented across core, plugin, and filesystem sources.

**Note:** The `any` type usage in `MCPEngine` (e.g., `client.setRequestHandler(CreateMessageRequestSchema, async (request: any) => {...})`) is a type safety concern but not an LSP violation per se.

---

## 4. Interface Segregation Principle (ISP)

### 🟠 VIOLATION 4.1 — `EngineContext` is Overly Broad

**Location:** `src/engine.ts` (type definition, referenced throughout)  
**Problem:** `EngineContext` exposes all subsystems to every consumer. Any component receiving `EngineContext` has access to `mcp`, `scheduler`, `templates`, `skills`, `memory`, `planManager`, `logger`, `stats`, `budget`, `guard`, `agents`, `prompts`, `context`, `brain`, `pluginRegistry`, `policyEngine`, `workspaceRoot`, `shortPath`, `branch`, `sessionId`, `cmdOutput`, `openPanel`, `setCmdOutput`, `setOpenPanel` — many of which are unused by most consumers.

**Impact:** Tight coupling between UI and all subsystems. Changes to any subsystem may require UI changes.

**Remediation:**
1. Create focused context interfaces: `ToolExecutionContext`, `PanelContext`, `TurnContext`
2. Pass only the needed subset to each component

### 🟠 VIOLATION 4.2 — `CoreAPI` Constructor Has 8 Parameters

**Location:** `src/plugins/interface.ts` (`CoreAPI` constructor)  
**Problem:** The constructor takes 8 dependencies, many optional. Callers must provide all of them (even if `undefined`). This is a violation of ISP — consumers are forced to depend on interfaces they don't use.

**Remediation:** Use the builder pattern or dependency injection container:
```typescript
class CoreAPIBuilder {
  withRegistry(registry: CoreRegistry) { ... }
  withBus(bus: EventBus) { ... }
  // ...
  build(): CoreAPI { ... }
}
```

### 🟡 VIOLATION 4.3 — `PanelDefinition` is Reasonably Segregated

**Location:** `src/plugins/interface.ts`  
**Assessment:** `PanelDefinition` has 4 fields (`title`, `columns`, `getItems`, `actions`) — all used by panel consumers. No major ISP violation here.

---

## 5. Dependency Inversion Principle (DIP)

### 🟠 VIOLATION 5.1 — Direct Imports of Low-Level Modules

**Location:** Multiple files  
**Problem:** High-level modules import low-level implementations directly:
- `src/orchestration/graph.ts` imports `executeRegisteredTool` from `src/orchestration/tool-registry.ts` (concrete)
- `src/orchestration/graph.ts` imports `summarizeFileWithFlash` from `src/codemap/summarizer.ts` (concrete)
- `src/orchestration/graph.ts` imports `IndexCache` from `src/codemap/cache.ts` (concrete)
- `src/main.tsx` imports specific panel components directly
- `src/turn.ts` imports `createTierAdapter`, `createAdapter` from `src/adapters/factory.ts` (concrete factories)

**Impact:** High-level policy (orchestration, UI) is coupled to low-level implementation details.

**Remediation:**
1. Define interfaces for abstractions: `ISummarizer`, `ICache`, `IToolRegistry`
2. Inject dependencies via constructor or function parameters
3. Use the container (`bootstrap/container.ts`) to wire dependencies

### 🔴 VIOLATION 5.2 — Global Mutable State in Orchestration

**Location:** `src/orchestration/graph.ts` (lines ~20-30)  
**Problem:** Module-level mutable variables (`_workspaceRoot`, `_cache`, `_scheduler`, `_planManager`) with setter functions (`setWorkspaceRoot`, `setScheduler`, `setPlanManager`). This is the opposite of DIP — high-level orchestration depends on globally mutable state rather than receiving dependencies.

```typescript
let _workspaceRoot = process.cwd();
let _cache: IndexCache | null = null;
let _scheduler: any = null;
let _planManager: any = null;
```

**Impact:** Tests must call setters in the correct order. State leaks between tests. No way to have two concurrent workspaces.

**Remediation:** Pass these as parameters to `directChat`/`runTurn` or use an `OrchestrationContext` object.

### 🟠 VIOLATION 5.3 — `PolicyEngine` Directly Reads Files

**Location:** `src/security/policy-engine.ts`  
**Problem:** `PolicyEngine` directly imports and uses `readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync` from `fs`. The high-level policy logic is coupled to the low-level file system.

**Remediation:** Define a `PolicyStore` interface:
```typescript
interface PolicyStore {
  loadRules(): PolicyRule[];
  saveRules(rules: PolicyRule[]): void;
}
```
Inject the implementation.

---

## Summary: Violation Count

| Principle | 🔴 Structural | 🟠 Local | 🟡 Smell |
|-----------|:---:|:---:|:---:|
| SRP       | 2   | 2   | 0    |
| OCP       | 2   | 1   | 1    |
| LSP       | 0   | 0   | 1    |
| ISP       | 0   | 2   | 1    |
| DIP       | 1   | 2   | 0    |
| **Total** | **5** | **7** | **3** |

---

## Priority Remediation Order

1. **🔴 SRP 1.1** — Split `src/main.tsx` (highest impact, most lines)
2. **🔴 DIP 5.2** — Remove global mutable state from `src/orchestration/graph.ts`
3. **🔴 OCP 2.1** — Implement `ToolExecutor` registration pattern
4. **🔴 SRP 1.2** — Extract tool-loop concerns from `src/orchestration/graph.ts`
5. **🔴 OCP 2.2** — Panel registry pattern for `main.tsx`
6. **🟠 SRP 1.3** — Split `MCPEngine`
7. **🟠 SRP 1.4** — Split `PolicyEngine`
8. **🟠 ISP 4.1** — Create focused context interfaces
9. **🟠 DIP 5.1** — Define abstraction interfaces for low-level modules
10. **🟠 ISP 4.2** — Builder pattern for `CoreAPI`
