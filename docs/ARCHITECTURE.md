# VoidRift Architecture

## What VoidRift Is

A local-first AI harness. It sits between the user and any model, providing: permissioned workspace access, tool orchestration, context management, and progressive knowledge injection. It's infrastructure — not an IDE, not a chatbot.

## Why It Exists

Most AI tools are closed ecosystems locked to one model. VoidRift connects to anything (local Ollama, vLLM, Anthropic, Google, any OpenAI-compatible API) and gives the user full control over what the model can do. Nothing phones home.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Input                                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                         TUI (React/Ink)                              │
│  main.tsx → panels, streaming display, input handling               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        Turn Execution                                │
│  turn.ts → event-driven orchestrator (TURN_BEFORE → model → TURN_AFTER) │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Orchestration (graph.ts)                        │
│  Tool loop: stream model → tool calls → permission gate →           │
│  guardrails → execute → feed results back → repeat                  │
└──────────┬────────────────────┬─────────────────────┬───────────────┘
           │                    │                     │
┌──────────▼────────┐ ┌────────▼─────────┐ ┌────────▼────────────────┐
│  Permission Gate  │ │   Tool Registry  │ │   Model Adapters        │
│  policy-engine.ts │ │  tool-registry.ts│ │   LangChain (OpenAI,    │
│  permission-gate  │ │  executors.ts    │ │   Anthropic, Google)    │
└───────────────────┘ └──────────────────┘ └─────────────────────────┘
```

---

## Core Subsystems

### 1. Context Manager (`src/session/context.ts`)

**Why:** Models have finite context windows. What goes in determines quality. Random stuffing wastes budget and degrades output.

**How:** Four layers ordered by ascending volatility:

| Layer | What lives here | Changes | Cache behavior |
|-------|----------------|---------|----------------|
| Agent | Persona, tool schemas, bound skills, discovery indexes | On agent switch | Always cached by provider |
| Orbit | Active plan, triggered skills, loaded memories | ~5% of turns | Usually cached |
| Drift | Focused file summaries, git status | On tool use | Rarely cached |
| Void | Messages, diagnostics, turn context | Every turn | Never cached |

**Why this order:** Providers (Anthropic, Google) cache prompt prefixes. Stable content at the top = cache hits = faster + cheaper. Volatile content at the bottom churns without invalidating the cache.

**Progressive disclosure:** The model sees lightweight indexes (skill names, memory titles) in Agent. Full content loads into Orbit/Drift only when triggered. This keeps baseline context small.

---

### 2. Prompt Compiler (`src/session/compiler.ts`)

**Why:** The four context layers need to be assembled into a single prompt that respects the layering order and doesn't exceed budget.

**How:** Compiles `SessionContext` into an array of `CompiledMessage[]`:
1. System message = Agent layer (persona + rules + environment + user context + bound skills)
2. System message = Orbit layer (active skills + plan + memory)
3. System message = Drift layer (focused files + git status)
4. Conversation messages = Void layer

---

### 3. Orchestration (`src/orchestration/graph.ts`)

**Why:** Models produce tool calls that need to be executed, validated, and fed back in a loop until the model produces a final text response.

**How:** `directChat()` is the core loop:
1. Stream model response
2. If tool calls: execute each through permission gate → guardrails → tool registry
3. Push tool results back as messages
4. Loop (max 10 rounds)
5. If no text after tools: nudge model for a summary response

**Guardrails** (`guardrails.ts`): Mechanical enforcement that runs on every tool call. Produces advisory messages injected into results. The model self-corrects on the next iteration.

**Subagents:** `spawn_subagent` creates an isolated git worktree with its own `directChat` call. Path-mutex prevents conflicts. Results merge back on completion.

---

### 4. Permission System (`src/security/`)

**Why:** An AI with shell access is dangerous. Every outbound action (write, execute, network, MCP) must be gated.

**How:** Two components:

- **PolicyEngine** — rule-based decisions. Evaluates tool + args against rules ranked by priority. Returns allow/deny/ask.
- **PermissionGate** — interactive suspension. When PolicyEngine says "ask," the gate publishes a confirmation request to the TUI and waits for the user's response.

**Shell classification:** Commands are pre-classified as safe (auto-approve), dangerous (always ask), or has-equivalent (auto-deny with guidance to use the dedicated tool).

**Workspace boundary:** Anything outside `workspaceRoot` triggers the gate regardless of rules.

**Plan-backed execution:** When a plan declares a `scope` (write patterns + execute patterns), the permission gate auto-approves actions within that scope. The user approves the plan once; execution flows without interruption. No scope = per-action approval (graceful degradation).

**Loop detection:** The orchestration layer tracks consecutive tool failures and per-tool failure counts. Hard termination triggers on:
- 3 consecutive errors → model told to reassess and try a different approach
- Same tool failing 4+ times → model told to stop using that tool

This prevents token waste from circular failure patterns (edit_file cycling, repeated command failures).

---

### 5. Tool System (`src/tools/`)

**Why:** The model needs structured actions (read files, write files, search, execute commands, access web).

**How:**
- **Schemas** (`langchain-tools.ts`): Zod definitions. Single source of truth. LangChain translates to provider-specific format.
- **Executors** (`orchestration/tool-registry.ts`): Registration pattern. Each tool registers a `{ name, execute }` pair.
- **Definitions** (`tools/definitions.ts`): Derives display metadata from Zod schemas via `zod-to-json-schema`.

**Flow:** Model emits tool_call → graph.ts extracts it → permission gate → guardrails → `executeRegisteredTool()` → result → ToolMessage back to model.

---

### 6. Skill System (`src/skills/`)

**Why:** Models need domain knowledge at the right time. Loading everything always wastes context. Loading nothing means the model guesses.

**How:**
- **Builtin skills** (`builtins.ts`): Compiled-in knowledge about VoidRift's own features.
- **Custom skills** (`.voidrift/skills/`, `~/.config/voidrift/skills/`): User-provided domain knowledge.
- **Trigger resolution:** On each turn, `SkillManager.resolve()` checks focused files (extensions, names), user input (keywords), and description matching against the current context.
- **Progressive disclosure:** Skill discovery index (one-line descriptions) lives in Agent layer permanently. Full skill content loads into Orbit only when triggered.

---

### 7. Memory System (`src/session/memory.ts`)

**Why:** Knowledge that persists across sessions. The model discovers a convention, stores it, and every future session benefits without the user repeating themselves.

**How:**
- **Directive memories:** Auto-loaded every session. Rules, preferences.
- **Reference memories:** Loaded on demand via TF-IDF keyword matching.
- **Two-stage disclosure:** Index (title + summary) in Agent layer. Full body loads to Orbit when relevant or requested.

---

### 8. Agent System (`src/agents/registry.ts`)

**Why:** Different tasks need different personas, tool sets, and permission levels. A planning session shouldn't have write access. An autonomous run shouldn't ask for approval.

**How:**
- **Core agents:** chat (collaborative, gated), plan (read-only), vibe (autonomous)
- **Task agents:** indexer, summarizer (background workers)
- **Custom agents:** Discovered from `.voidrift/agents/` with JSON manifest + prompt.md
- **Resolution cascade:** workspace override → global override → plugin → core default

**Model tiers:** flash (user-facing chat + subagent execution), utility (internal preflight classifiers, summarization, harness operations), dense (escalation for complex reasoning). Agents declare their tier or use "auto" for router decisions.

---

### 9. Planning System (`src/session/plan.ts`)

**Why:** Multi-step work needs persistent tracking that survives sessions, compaction, and context limits.

**How:** Flat markdown files in `.voidrift/plan/`. Each file = one plan item with frontmatter (priority, description, optional scope) and body (tasks, constraints, done-when). Priority lanes: now (active), next (queued), later (backlog). "Now" items auto-inject into Orbit context.

**Scope declaration:** Plans can optionally declare `write: [glob patterns]` and `execute: [command patterns]` in their frontmatter. When a "now" plan has scope, the permission gate auto-approves actions within those boundaries. This turns the plan into a sandbox definition — approve the plan once, the model executes freely within its declared scope.

---

### 10. Session Persistence (`src/session/brain.ts`)

**Why:** Sessions crash, users close terminals, work must be resumable.

**How:** `SessionBrain` writes all context partitions to `.voidrift/sessions/<id>/` on every `TURN_COMPLETE` event. Resume reconstructs context from these files. Git checkpointing creates commits per turn for rollback.

---

### 11. MCP Integration (`src/mcp/engine.ts`)

**Why:** VoidRift becomes a universal client. Any MCP server = new tools, resources, prompts available to the model.

**How:** Full MCP client spec: tools, resources, prompts, sampling (bidirectional), elicitation, OAuth2+PKCE, roots. Per-server configs in `.voidrift/mcp/<name>.json`. Tools route through the same permission gate as builtins.

---

### 12. Plugin System (`src/plugins/`)

**Why:** No tool anticipates every workflow. Plugins add commands, agents, skills, prompts, panels, and event handlers.

**How:** npm packages with `"voidrift": { "plugin": true }`. Sandboxed `CoreAPI` surface — registration only, no direct access to context or model. Event-driven integration via the bus.

---

### 13. Event Bus (`src/events/bus.ts`)

**Why:** Decoupled communication between subsystems. The TUI doesn't import the orchestration layer. The logger doesn't import the permission gate.

**How:** Typed publish/subscribe. All significant actions emit events (tool calls, file changes, turn completions, errors). Plugins, logger, stats, watcher, and UI all subscribe independently.

---

### 14. Model Adapters (`src/adapters/`)

**Why:** LangChain abstracts provider differences. VoidRift doesn't care if you're running Ollama locally or calling Claude's API.

**How:**
- **Factory** (`factory.ts`): Creates `BaseChatModel` instances from config. Supports OpenAI, Anthropic, Google protocols.
- **Streaming** (`stream.ts`): Universal `.stream()` method with chunk accumulation for tool call assembly.
- **Three tiers:** flash (chat + subagents), utility (preflight + internal ops), dense (escalation). Fallback chain: if primary fails, try next tier automatically.

---

### 15. TUI (`src/main.tsx`, `src/ui/`)

**Why:** Terminal-native. Starts in 200ms, works over SSH, uses 50MB RAM.

**How:** React/Ink. `<Static>` for committed history (immutable). Live state (streaming, pending tools, thinking) renders below. Panels are individual files in `src/ui/panels/`. Input handling via `useInput` hooks with busy/panel state guards.

---

## File Layout

```
src/
├── main.tsx              # TUI entry point
├── turn.ts              # Turn execution logic
├── engine.ts            # EngineContext type definition
├── index.ts             # Public exports
├── serve.ts             # Headless JSON-RPC mode
├── adapters/            # Model connectivity (LangChain)
├── agents/              # Agent registry and manifests
├── bootstrap/           # Startup (cli.ts, core.ts, container, headless, cleanup, validate)
├── codemap/             # Workspace code map generation + summarizer
├── commands/            # Slash command registration
├── config/              # Config loading and validation (Zod)
├── events/              # Event bus
├── logging/             # Audit logger
├── mcp/                 # MCP client (engine, OAuth, credentials, discovery)
├── operator/            # DTOs + JSON-RPC protocol constants (for serve mode)
├── orchestration/       # Tool loop, guardrails, scheduler, run, task registry
├── output/              # Budget watcher, truncator, autocomplete
├── plugins/             # CoreAPI (single interface) + plugin registry
├── prompts/             # Prompt registry (core.rules, chat, compact)
├── registry/            # CoreRegistry (commands, capabilities)
├── router/              # Three-tier model router + escalation
├── safeguards/          # Git checkpoint, diff computation
├── security/            # Permission gate + policy engine
├── session/             # Context manager, brain, plan, memory, compactor, stats
├── skills/              # Skill manager + builtins
├── tasks/               # Task registry (named repeatable definitions)
├── templates/           # Template service (plan templates, overrides)
├── tools/               # Tool schemas, executors, web tools
├── ui/                  # Panels, markdown renderer, table, scroll-view, raw-input
├── utils/               # Editor, clipboard
├── watcher/             # File watcher + resource watcher
└── worktree/            # Git worktree engine for subagent isolation
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| LangChain as abstraction | Provider-specific translation (tool schemas, streaming, content blocks) handled universally. Model independence without our own adapter layer. |
| Zod single source of truth | One schema definition drives: model binding, display metadata, validation. No drift between what the model sees and what the executor expects. |
| Registration pattern | OCP: adding a tool never touches graph.ts. Register executor, done. |
| Four context layers | Prompt cache optimization. Stable prefix = faster, cheaper. Volatile suffix = churn doesn't invalidate cache. |
| Permission gate as event suspension | Non-blocking architecture. The tool loop pauses, TUI shows dialog, user responds, loop resumes. No polling, no timeouts (configurable). |
| Guardrails as advisory injection | Enforcement without blocking. Model sees the warning in its tool result and self-corrects. Lighter than hard gates for soft rules. |
| Skills over docs | Skills have metadata, triggers, and structured content. Progressive disclosure is built-in. Docs are flat files with no activation logic. |
| Event bus decoupling | Subsystems evolve independently. Logger, UI, stats, plugins all subscribe to the same events without importing each other. |
| Git worktree isolation | Subagents can't corrupt the user's working tree. Path-mutex prevents two agents from touching the same files. Merge handles conflicts with recovery branches. |
| Session-scoped trust | Security resets on restart. Trust accumulates during a session via user approval patterns, but never persists silently. Persistent rules require explicit `/policy add`. |

---

## Single Interface: CoreAPI

```
import { createCore } from "voidrift";
const core = await createCore({ workspaceRoot });
```

CoreAPI is the **only** public interface. Every client — plugins, TUI, VS Code, Electron, CLI — uses the same surface.

| Namespace | Purpose |
|-----------|---------|
| `core.session.*` | Turn execution, commands, shutdown, resume |
| `core.agents.*` | Activate, create, list, cycle agents |
| `core.plan.*` | CRUD plan items |
| `core.memory.*` | Load/unload memories |
| `core.skills.*` | List/reindex skills |
| `core.models.*` | Switch models, stats, context detail |
| `core.tools.*` | List available tools |
| `core.mcp.*` | Connect/disconnect MCP servers |
| `core.templates.*` | Template overrides |
| `core.prompts.*` | Prompt overrides |
| `core.policy.*` | Security rules |
| `core.audit.*` | Event history |
| `core.workspace.*` | File ops, config, tasks, spawn subagents |
| `core.plugins.*` | List installed plugins |
| `core.register.*` | Extend the harness (commands, agents, skills, panels, providers) |
| `core.events.*` | Pub/sub on the event bus |

No `_engine`. No raw subsystem access. If the API doesn't expose it, the client doesn't need it.

---

## Data API Rule

**The TUI is a consumer of CoreAPI, not a peer of it.**

Every piece of data a frontend displays MUST come through a CoreAPI namespace method. Every mutation a frontend performs MUST go through a CoreAPI namespace method. No frontend — TUI, VS Code, Electron, web — reaches into engine internals directly.

```
┌─────────────────────────────────────────────────┐
│  CoreAPI                                        │
│  core.models.stats(), core.plan.list()          │
│  core.session.execute(), core.agents.activate() │
└────────┬────────────────┬──────────────┬────────┘
         │                │              │
    ┌────▼─────┐    ┌────▼──────┐  ┌───▼────────┐
    │   TUI    │    │  VS Code  │  │  Electron  │
    │  (Ink)   │    │ (webview) │  │  (React)   │
    └──────────┘    └───────────┘  └────────────┘
```

**Why:** If a panel can't work over JSON-RPC, it can't work in VS Code or any future frontend. CoreAPI IS the universal data layer. Panels are a rendering concern local to each frontend.

**Enforcement:**
- New TUI panels MUST source data from CoreAPI namespace methods
- If the API doesn't expose the needed data, ADD a method first
- Panel schemas (`getItems`, `getContent`, `actions.handler`) call CoreAPI, not engine internals
- The `_engine` accessor is deleted — the boundary is sealed

---

## Data Flow: One Turn

VoidRift is event-driven. The turn is a thin orchestrator that publishes lifecycle events.
Internal features and plugins are both event subscribers — same mechanism, same priority.

```
1. User types message
2. turn.ts (inline): extract images, add user message to context
3. turn.ts (inline): resolve model tier, check de-escalation
4. await bus.publishAndWait("TURN_BEFORE")
   └── Subscribers (FIFO registration order):
       • Message decay — compact old turns if over threshold
       • Context pressure — inject budget warning if >50%
       • Skill resolution — load skills matching triggers + inheritance
       • (Plugin subscribers run here too)
5. turn.ts: compile prompt (reads enriched context from step 4)
6. graph.ts directChat(): stream model
7. Model produces tool calls
8. For each tool call:
   a. Permission gate: allow/deny/ask
   b. Guardrails: check rules, produce advisories
   c. Execute tool via registry
   d. Push result (+ advisories) as ToolMessage
9. Loop back to step 6 (max 10 rounds, extendable)
10. Model produces final text response
11. turn.ts (inline): record stats, add assistant message to chain, update budget
12. await bus.publishAndWait("TURN_AFTER")
    └── Subscribers (FIFO registration order):
        • Context summary — one-sentence recap stored on the message
        • Escalation check — handle escalate/deescalate tool calls
        • (Plugin subscribers run here too)
13. bus.publish("TURN_COMPLETE") — fire-and-forget
    └── Brain persistence, git checkpoint, audit log (all existing subscribers)
14. TUI: progressive reveal animation of response
```

### Event Bus Contract

- `publishAndWait`: sequential, awaits each subscriber. Used for `TURN_BEFORE`/`TURN_AFTER`.
- `publish`: fire-and-forget. Used for informational events (`TURN_COMPLETE`, `FILE_MODIFIED`).
- Subscribers run in **FIFO registration order**. Priority is metadata, not enforcement.
- A throwing subscriber is caught and logged — doesn't kill the turn.
