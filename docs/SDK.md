# VoidRift SDK Reference

The VoidRift SDK (CoreAPI) is a standalone TypeScript interface for building AI-powered tools. The terminal UI is one client — you can build VS Code extensions, web apps, Slack bots, or CI pipelines on the same SDK.

## Quick Start

```typescript
import { createCore } from "voidrift";

const core = await createCore({ workspaceRoot: process.cwd() });

// Execute a turn
const result = await core.session.execute("What files are in this project?", {
  onChunk: (chunk) => {
    if (chunk.type === "content") process.stdout.write(chunk.text);
    if (chunk.type === "tool_call") console.log(`[${chunk.name}]`);
  },
});

// Shutdown
await core.session.shutdown();
```

## Headless Mode (JSON-RPC)

For external frontends (VS Code, web UIs), run VoidRift as a headless server:

```bash
voidrift --serve --workspace /path/to/project
```

Communicates over stdin/stdout using JSON-RPC 2.0. See `src/operator/protocol.ts` for the full method/notification contract.

## CoreAPI Namespaces

### `core.session`

| Method | Description |
|--------|-------------|
| `id` | Current session ID |
| `warnings` | Startup warning messages |
| `send(params)` | Send a message (fire-and-forget, streams via events) |
| `execute(text, callbacks)` | Execute a turn with streaming callbacks |
| `cancel()` | Abort active generation |
| `clear()` | Reset conversation history |
| `compact()` | Compress old messages |
| `confirm(params)` | Respond to a tool confirmation request |
| `resume(sessionId)` | Load a previous session |
| `list()` | List all saved sessions |
| `loadMessages(sessionId)` | Load messages from a session without resuming |
| `messages()` | Get current conversation messages |
| `rewind(turn)` | Rollback to a specific turn |
| `command(name, args)` | Execute a slash command programmatically |
| `listCommands()` | List all registered slash commands |
| `shutdown()` | Clean shutdown (abort streams, close MCP) |

### `core.models`

| Method | Description |
|--------|-------------|
| `list()` | All configured models with role assignments |
| `switch(params)` | Change the active model |
| `switchBackground(name)` | Change the background model |
| `persistTiers()` | Save role assignments to workspace config |
| `stats()` | Session token/timing statistics |
| `context()` | Context budget usage |
| `contextDetail()` | Full four-layer context breakdown |
| `contextPct()` | Current context usage percentage |

### `core.agents`

| Method | Description |
|--------|-------------|
| `list()` | All registered agents |
| `get(id)` | Get a specific agent |
| `activate(id)` | Switch to an agent (sets persona, tools, skills) |
| `cycle()` | Cycle to next active interactive agent |
| `create(id, type, scope)` | Create a new agent |
| `deactivate(id)` | Disable an agent |
| `deleteOverride(id, scope)` | Delete override files for an agent |
| `reindex()` | Re-scan agent directories |
| `getOverrideCascade(id)` | Get the full override cascade (default/global/workspace) |
| `scaffoldOverride(id, target)` | Create an override file with default content |
| `deleteFile(path)` | Delete a specific override file |
| `resetOverride(id, target)` | Reset an override to defaults |
| `renameAgent(oldId, newId)` | Rename a custom agent |
| `getLocation(id)` | Get location (workspace or global) |

### `core.plan`

| Method | Description |
|--------|-------------|
| `list()` | All plan items grouped by priority |
| `get(filename)` | Get a plan item's full body |
| `add(input)` | Create a new plan item |
| `updatePriority(input)` | Move item to different lane |
| `updateBody(input)` | Edit item body (search/replace) |
| `remove(filename)` | Delete a plan item |
| `dir()` | Plan directory path |

### `core.memory`

| Method | Description |
|--------|-------------|
| `list()` | All saved memories |
| `load(id)` | Inject memory into active context |
| `unload(id)` | Remove memory from context |
| `delete(id)` | Permanently delete a memory |

### `core.skills`

| Method | Description |
|--------|-------------|
| `list()` | All indexed skills |
| `reindex()` | Re-scan skill directories |
| `create(name, scope)` | Create a new skill file |
| `rename(oldName, newName)` | Rename a skill |
| `delete(name)` | Delete a skill |
| `createOverride(name, scope)` | Create an override for a builtin skill |

### `core.tools`

| Method | Description |
|--------|-------------|
| `list()` | Core tools + MCP tools available to current agent |

### `core.mcp`

| Method | Description |
|--------|-------------|
| `list()` | All MCP server configs and status |
| `connect(name)` | Connect to a configured server |
| `disconnect(name)` | Disconnect a server |
| `listConfigs()` | Raw server configurations |
| `saveConfig(config)` | Save a new server config |
| `removeConfig(name)` | Delete a server config |

### `core.workspace`

| Method | Description |
|--------|-------------|
| `root()` | Workspace root path |
| `branch()` | Current git branch |
| `shortPath()` | Shortened display path (~/...) |
| `map()` | Generate workspace code map |
| `exec(cmd, cwd?, timeout?)` | Execute a shell command |
| `tasks()` | Background task list |
| `runningCount()` | Active background processes + worktree locks |
| `locks()` | Active worktree path locks |
| `killTasks()` | Kill all running background processes |
| `spawn(files, execute)` | Spawn a subagent in isolated worktree |
| `inject(label, content)` | Inject one-shot content into current turn context |
| `config()` | Current merged configuration object |
| `configPaths()` | Paths to global and workspace config files |
| `shortenPath(path)` | Shorten absolute path for display |
| `diff()` | Uncommitted git changes (raw lines) |
| `listFiles(maxDepth?)` | List workspace files for autocomplete |

### `core.routines`

| Method | Description |
|--------|-------------|
| `list()` | All saved routines |
| `get(filename)` | Get routine body |
| `add(name, description, body)` | Create a routine |
| `remove(filename)` | Delete a routine |
| `dir()` | Routines directory path |

### `core.plugins`

| Method | Description |
|--------|-------------|
| `list()` | Discovered plugins and status |
| `enable(id, scope)` | Enable a plugin |
| `disable(id)` | Disable a plugin |
| `getScope(id)` | Check where a plugin is enabled (global/workspace/available) |

### `core.templates`

| Method | Description |
|--------|-------------|
| `list()` | All registered templates |
| `get(key)` | Get a template's resolved content |
| `slots()` | All template slots with resolution metadata |
| `resolve(key)` | Resolve a slot (content + source level) |
| `create(name, scope)` | Create a custom template file |
| `createSlotOverride(key, scope)` | Create an override for a system template |
| `rename(oldName, newName)` | Rename a custom template |
| `delete(name)` | Delete a custom template |

### `core.prompts`

| Method | Description |
|--------|-------------|
| `list()` | All registered prompts |
| `get(key)` | Get a prompt's resolved content |
| `createOverride(key, scope)` | Create an override file |
| `deleteOverride(key)` | Delete an override |

### `core.policy`

| Method | Description |
|--------|-------------|
| `list()` | All active policy rules (source, tool, pattern, decision, priority) |

### `core.audit`

| Method | Description |
|--------|-------------|
| `list(limit?)` | Recent audit log entries (default 50) |

### `core.editor`

| Method | Description |
|--------|-------------|
| `open(filePath)` | Open file in configured editor |
| `editValidated(filePath, type)` | Edit with validation (temp copy → validate → apply) |
| `viewReadonly(content, filename)` | View content read-only in editor |
| `hasEditor()` | Check if editor is configured |

### `core.register`

| Method | Description |
|--------|-------------|
| `command(name, description, handler)` | Register a slash command |
| `agent(manifest)` | Register an agent |
| `skill(entry)` | Register a skill |
| `extractor(extractor)` | Register a symbol extractor |
| `guardrail(fn)` | Register a guardrail rule |
| `prompt(key, content, label?, description?)` | Register a system prompt |
| `template(key, content, label?, description?)` | Register a template |
| `panel(name, definition)` | Register a TUI panel |
| `agentProvider(key, provider)` | Register an Agent layer context provider |
| `orbitProvider(key, provider)` | Register an Orbit layer context provider |
| `driftProvider(key, provider)` | Register a Drift layer context provider |

### `core.events`

| Method | Description |
|--------|-------------|
| `register(name)` | Register a custom event type |
| `subscribe(type, handler, opts?)` | Subscribe to an event (returns unsubscribe fn) |
| `emit(key, payload)` | Publish an event |

## Event Bus

Subscribe to harness events for real-time state:

```typescript
// Stream tokens
core.events.subscribe("TOKEN_STREAM", (e) => {
  process.stdout.write(e.payload.token);
});

// Tool execution
core.events.subscribe("AFTER_TOOL_EXECUTE", (e) => {
  console.log(`${e.payload.toolName}: ${e.payload.status}`);
});

// Model escalation
core.events.subscribe("MODEL_ESCALATED", (e) => {
  console.log(`Escalated: ${e.payload.from} → ${e.payload.to}`);
});
```

Key event types: `TURN_BEFORE`, `TURN_AFTER`, `TURN_COMPLETE`, `TOKEN_STREAM`, `BEFORE_TOOL_EXECUTE`, `AFTER_TOOL_EXECUTE`, `TOOL_CONFIRMATION_REQUEST`, `MODEL_ESCALATED`, `MODEL_DEESCALATED`, `CONTEXT_COMPACTED`, `FILE_CREATED`, `FILE_MODIFIED`, `FILE_DELETED`.

## Plugin Development

Plugins register via the CoreAPI surface:

```typescript
// my-plugin/index.ts
export function register(core) {
  // Add a slash command
  core.register.command("deploy", "Deploy to production", async (args) => {
    // ...
  });

  // Add a tool
  core.register.extractor({
    extensions: [".prisma"],
    extract(path, content) { /* ... */ }
  });

  // Listen to events
  core.events.subscribe("TURN_COMPLETE", (e) => { /* ... */ });
}
```

Enable in config:
```json
{ "plugins": ["my-plugin"] }
```

## Agent Authoring

Create agents in `.voidrift/agents/<id>/`:

```
.voidrift/agents/my-agent/
├── agent.json    # Config (type, tools, approvalMode)
└── prompt.md     # System prompt
```

**agent.json:**
```json
{
  "id": "my-agent",
  "name": "My Agent",
  "description": "Custom agent for specific workflow",
  "type": "interactive",
  "tools": ["read_file", "write_file", "edit_file", "execute_command"],
  "approvalMode": "prompt",
  "allowedTools": ["read_file"],
  "active": true
}
```

Agent types:
- `"interactive"` — user-facing, appears in mode cycle
- `"passive"` — background worker (subagents, indexers)

Agent roles (model override):
- `""` (empty) — uses `modelSelected`
- `"utility"` — uses `modelUtility`
- `"escalation"` — uses `modelEscalation`

## Skill Authoring

Skills are markdown files with YAML frontmatter:

```markdown
---
name: "my-skill"
description: "Domain knowledge for my workflow"
triggers:
  keywords: ["deploy", "release", "staging"]
  extensions: [".yaml"]
agents: []
active: true
---

# My Skill

Instructions and knowledge loaded when triggered...
```

Place in `.voidrift/skills/` (workspace) or `~/.config/voidrift/skills/` (global).

## Tool Registration

Register custom tool executors:

```typescript
import { registerToolExecutor } from "voidrift";

registerToolExecutor({
  name: "my_custom_tool",
  async execute(args, ctx) {
    // ctx.workspaceRoot, ctx.config, ctx.context available
    return `Result: ${args.input}`;
  },
});
```

Tool schemas are defined in `src/tools/langchain-tools.ts` using Zod (single source of truth).

## Lifecycle

### Initialization

`createCore()` performs the full bootstrap sequence:

1. Loads configuration (global `~/.config/voidrift/config.json` + workspace `.voidrift/config.json`)
2. Runs boot cleanup (prunes stale worktrees, resets lock ledger)
3. Starts file watcher (chokidar on workspace)
4. Initializes all subsystems: context manager, agents, skills, memory, plan, MCP, worktree engine, scheduler, checkpointer
5. Discovers and loads plugins
6. Registers slash commands
7. Wires event bus subscribers (turn lifecycle, stats, escalation, context pressure)
8. Returns bound CoreAPI instance

```typescript
import { createCore } from "voidrift";

const core = await createCore({ workspaceRoot: "/path/to/project" });
// Engine is fully initialized. All namespaces are ready.
```

### Shutdown

```typescript
await core.session.shutdown();
```

This:
- Aborts any active model streams
- Kills background tasks (scheduler)
- Disconnects all MCP servers
- Publishes `SESSION_END` event
- Shuts down the container (stops file watcher)

### Error Recovery

The SDK wraps model calls in an `ExceptionGuard`. If a model API call fails:
- The error is recorded as an assistant message in context
- `ERROR_OCCURRED` event is published
- The turn returns `null` (caller can retry or surface to user)

Network-level retries are handled automatically (configurable via `networkModelRetries`).

## Context System

The context manager organizes all model input into four layers, ordered by ascending volatility:

```
┌─────────────────────────────────────────────┐
│ Agent (static)                              │  ← Changes on agent switch only
│   persona, tool schemas, bound skills,      │
│   skill index, memory index                 │
├─────────────────────────────────────────────┤
│ Orbit (semi-static)                         │  ← Changes ~5% of turns
│   active skills, plan, loaded memories      │
├─────────────────────────────────────────────┤
│ Drift (dynamic)                             │  ← Changes ~30% of turns
│   workspace code map, focused files,        │
│   git status                                │
├─────────────────────────────────────────────┤
│ Void (volatile)                             │  ← Changes every turn
│   conversation messages, diagnostics,       │
│   turn-injected context                     │
└─────────────────────────────────────────────┘
```

**Why this ordering matters:** Providers that support prompt caching (Anthropic, Gemini) cache from the top. Stable content at the top means higher cache hit rates across turns. Cheaper and faster.

### Accessing Context

```typescript
const ctx = core.models.contextDetail();

// Layer sizes in tokens
ctx.agent.personaTokens;
ctx.orbit.planTokens;
ctx.drift.filesTokens;
ctx.void.messagesTokens;

// What's loaded
ctx.agent.tools;            // bound tool names
ctx.drift.focusedFiles;     // [{path, totalLines, readRanges}]
ctx.orbit.plan;             // compiled plan summary or null
```

### Injecting Context

Plugins can inject content into the prompt via context providers:

```typescript
core.register.agentProvider("my-key", () => {
  return "Custom instructions injected into Agent layer.";
});

core.register.orbitProvider("my-data", () => {
  return "Project state injected into Orbit layer.";
});

core.register.driftProvider("my-status", () => {
  return "Dynamic data injected into Drift layer.";
});
```

Or inject one-shot content for the current turn only:

```typescript
core.workspace.inject("Custom Label", "Content visible only this turn.");
```

### Context Pressure

The SDK monitors context usage and responds in stages:

| Usage | Response |
|-------|----------|
| < 50% | Normal operation |
| 50-70% | Warns model to be concise |
| 70-80% | Masks old tool results to one-line summaries |
| 80-90% | Prunes oldest turns via compaction |
| 90%+ | Aggressive prune to last 6 turns |

Subscribe to pressure events:
```typescript
core.events.subscribe("CONTEXT_COMPACTED", (e) => {
  console.log(`Freed ${e.payload.freedTokens} tokens`);
});
core.events.subscribe("CONTEXT_PRESSURE", (e) => {
  console.log(`Context at ${e.payload.percentage}% — level: ${e.payload.level}`);
});
```

## Permission System

Every outbound action (write, execute, network, MCP) goes through the permission gate. The gate delegates to the policy engine.

### Policy Engine

Rules are evaluated by priority (highest wins):

```
session (300) > workspace (200) > user/global (100) > defaults (0)
```

```typescript
// List all active rules
const rules = core.policy.list();

// Rules have: tool, pattern, decision, priority, source, label
// decision: "allow" | "deny" | "ask"
```

### Shell Command Classification

Commands are auto-classified:
- **safe:** `git status`, `ls`, `node --version` → auto-approved
- **dangerous:** `rm -rf`, `sudo`, `git push --force` → always asks
- **has_equivalent:** `cat`, `grep`, `curl` → denied with guidance to use dedicated tools
- **unknown:** everything else → asks

### Plan Scope

Plans can declare a scope. Actions within scope auto-approve:

```typescript
core.plan.add({
  name: "auth-refactor",
  description: "Refactor auth module",
  priority: "now",
  body: "...",
  scope: {
    write: ["src/auth/**", "tests/auth/**"],
    execute: ["bun run test"]
  }
});
```

### Programmatic Rule Management

```typescript
// Add a session rule (lost on restart)
// Use core.session.command("policy", ["add", "allow", "execute_command", "bun run *"])

// Persistent rules are stored in .voidrift/config.json under "policies"
```

## Event Bus

### Event Flow

```
TURN_BEFORE → (context enrichment subscribers run)
  → Model invocation
  → Tool loop (BEFORE_TOOL_EXECUTE → AFTER_TOOL_EXECUTE per tool)
  → TURN_AFTER (stats, escalation check, summary generation)
  → TURN_COMPLETE (session persistence, fire-and-forget)
```

### Subscriber Priority

Subscribers execute in registration order within priority bands:

| Priority | Use Case |
|----------|----------|
| `critical` | Security gates, abort signals |
| `high` | Context compaction, escalation checks |
| `normal` | Skill resolution, standard enrichment |
| `low` | Logging, analytics |
| `background` | Stats recording, async summaries |

```typescript
core.events.subscribe("TURN_BEFORE", handler, { priority: "high" });
```

### `publishAndWait` vs `publish`

- `publishAndWait` — sequential, blocks until all subscribers complete. Used for `TURN_BEFORE` and `TURN_AFTER` where subscribers must finish before proceeding.
- `publish` — fire-and-forget. Used for `TURN_COMPLETE`, notifications, telemetry.

### Key Events

```typescript
// Turn lifecycle
"TURN_BEFORE"         // Enrich context before model call
"TURN_AFTER"          // React to model response
"TURN_COMPLETE"       // Persist session (fire-and-forget)

// Tool execution
"BEFORE_TOOL_EXECUTE" // { toolName, arguments }
"AFTER_TOOL_EXECUTE"  // { toolName, arguments, status, output }

// Model
"MODEL_RESOLVED"      // { name, tier, protocol }
"MODEL_ESCALATED"     // { from, to, reason, auto }
"MODEL_DEESCALATED"   // { from, to }

// Context
"CONTEXT_COMPACTED"   // { beforeCount, afterCount, freedTokens }
"CONTEXT_PRESSURE"    // { percentage, level }
"FILE_FOCUSED"        // { path, totalLines, tokensUsed }

// Workspace
"FILE_CREATED"        // { path }
"FILE_MODIFIED"       // { path }
"FILE_DELETED"        // { path }

// Security
"PERMISSION_GRANTED"  // { tool, pattern, persist }
"PERMISSION_DENIED"   // { tool, reason }
"STRUGGLE_DETECTED"   // { text, expectedAction }

// Tasks
"SUBAGENT_SPAWNED"    // { subagentId, worktreePath }
"SUBAGENT_COMPLETED"  // { subagentId, status }
```

## Model Resolution

### Role-Based Resolution

The SDK resolves models by role:

| Role | Config Field | Fallback |
|------|-------------|----------|
| `selected` | `modelSelected` | (required — no fallback) |
| `utility` | `modelUtility` | `modelSelected` |
| `escalation` | `modelEscalation` | `modelSelected` |

Background tasks use `modelBackground` (falls back to `modelSelected`).

### Escalation Mechanics

Escalation is binary: either `modelEscalation` is configured or it isn't.

When configured:
- Plan creation (`add_plan`) is blocked on the primary model — forces escalation
- 2 consecutive tool failures auto-swap to escalation model
- Context > 85% triggers auto-escalation
- Model can call `escalate(reason)` manually (auto-approves)
- Escalation model calls `deescalate()` to return

The swap happens mid-turn — same context, same tool results. No restart.

### Fallback Chain

If the primary model fails, the SDK tries the next role in order:
```
selected → utility → escalation
```

Only applies when models are different. If utility and selected resolve to the same model, no fallback is added.

## Orchestration

### The Tool Loop

`directChat()` is the core execution function. It:

1. Compiles the system prompt from all four context layers
2. Binds tools (preflight classifier selects relevant subset)
3. Streams the model response
4. If response contains tool calls → execute each → feed results back → repeat
5. Continues until model responds with text only (no tool calls)

```
Stream → Tool Calls? → Execute → ToolMessage → Stream → ... → Final Text
```

### Guardrails

Mechanical enforcement rules that run before each tool execution:

| Rule | Enforcement | Reason |
|------|-------------|--------|
| Read before edit | Blocking | Prevents blind overwrites |
| No /tmp writes | Blocking | Redirects to `.voidrift/cache/` |
| Large replacement (>50 lines) | Blocking | Forces `write_file` for full rewrites |
| Generator script | Advisory | Warns about string escaping issues |
| Repetitive pattern (4+ same tool) | Advisory | Suggests batching |

Register custom guardrails:
```typescript
core.register.guardrail((tool, args, ctx) => {
  if (tool === "execute_command" && args.command.includes("production")) {
    return { block: true, preWarning: "Error: Production commands require manual execution." };
  }
  return null;
});
```

### Loop Detection

The tool loop has three termination mechanisms:

1. **Consecutive errors (3):** Model gets "STOP calling tools" message
2. **Same tool failing (4x):** Tool-specific block
3. **Fingerprint doom-loop:** Same tool+args called 3x in 20 calls

### Stall Recovery

When the model states intent but doesn't act:

1. Utility classifier determines COMPLETED vs STALLED
2. First nudge: "Check your work — did you finish?"
3. If still stalled + escalation configured: "If this exceeds your capacity, call escalate."

Configurable: `turnsStallRecovery: false` to disable.

### Tool Output Trimming

Large tool outputs (>80 lines) are trimmed to head + tail. Full output is cached to `.voidrift/cache/tool-output/`. The model gets:
```
[first 30 lines]
[... N lines omitted — full output at .voidrift/cache/tool-output/xyz.txt ...]
[last 20 lines]
```

`read_file` results are never trimmed.

## Session Persistence

### Brain

The `SessionBrain` writes partition files to `.voidrift/sessions/<id>/` on every `TURN_COMPLETE`:

```
.voidrift/sessions/abc123/
├── system.metadata.json    # sessionId, startTime, turnCount
├── system.turns.json       # [{turn, timestamp, agentId, gitSha}]
├── governance.persona.md   # active persona text
├── governance.tools.json   # active tool list
├── workspace.plan.md       # active plan
├── workspace.focused.json  # focused files with read ranges
├── work.messages.json      # full conversation history
└── work.diagnostics.md     # active diagnostics
```

### Resume

```typescript
const sessions = core.session.list();
// [{id, startTime, turnCount, lastActivity}]

core.session.resume(sessions[0].id);
// Loads messages, plan, diagnostics into context
```

### Git Checkpointing

Every turn with workspace changes creates a git commit:
```
voidrift-checkpoint-turn-1
voidrift-checkpoint-turn-2
...
```

Rollback:
```typescript
core.session.rewind(5); // Reset to turn 5
```

### Compaction

When context grows too large, old turns are summarized:

```typescript
core.session.compact();
// Keeps last N turns at full fidelity
// Older turns → structured summary (activity log, files, diagnostics)
```

Automatic compaction fires at 80%+ context usage via the `TURN_BEFORE` subscriber.

## MCP Integration

### Connecting Servers

Configure in `.voidrift/config.json`:

```json
{
  "mcp": {
    "my-db": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "$POSTGRES_URL" },
      "autoConnect": true
    },
    "remote-api": {
      "transport": "http-sse",
      "url": "https://mcp.example.com/sse",
      "auth": {
        "type": "oauth2",
        "authorizeUrl": "https://auth.example.com/authorize",
        "tokenUrl": "https://auth.example.com/token",
        "scopes": ["read", "write"],
        "tokenEnvVar": "REMOTE_API_TOKEN"
      }
    }
  }
}
```

### Programmatic Access

```typescript
// List servers
const servers = core.mcp.list();

// Connect
await core.mcp.connect("my-db");

// MCP tools appear as mcp_<server>_<tool> in the tool list
const tools = core.tools.list();
// tools.mcp = [{name: "query", server: "my-db", fullName: "mcp_my-db_query", ...}]
```

### Sampling Handler

MCP servers can request model calls back through the client (sampling). The SDK wires this automatically using the utility model:

```typescript
// Already configured — MCP servers that call createMessage get
// a response from your utility model transparently.
```

### Server Instructions

Connected MCP servers can provide instructions that get injected into the system prompt automatically. Access them:

```typescript
// Instructions are injected into the Agent layer automatically.
// No action needed — just connect the server.
```

## Building a Client

End-to-end example of a minimal non-TUI client:

```typescript
import { createCore } from "voidrift";

async function main() {
  const core = await createCore({ workspaceRoot: process.cwd() });

  // Subscribe to events
  core.events.subscribe("TOOL_CONFIRMATION_REQUEST", (e) => {
    // Auto-approve everything (dangerous — for CI only)
    core.session.confirm({
      requestId: e.payload.requestId,
      approved: true,
    });
  });

  // Execute turns in a loop
  const questions = ["What files are in src/?", "Summarize the main module."];

  for (const q of questions) {
    console.log(`\n> ${q}\n`);

    const result = await core.session.execute(q, {
      onChunk: (chunk) => {
        if (chunk.type === "content") process.stdout.write(chunk.text);
        if (chunk.type === "tool_call" && chunk.status === "complete") {
          console.log(`  [${chunk.name}] ✓`);
        }
      },
    });

    console.log(`\n(${result?.response.usage.totalTokens} tokens)\n`);
  }

  await core.session.shutdown();
}

main();
```

### Handling Confirmations

In interactive clients, you must handle tool confirmation requests:

```typescript
core.events.subscribe("TOOL_CONFIRMATION_REQUEST", (e) => {
  const { tool, args, requestId, diff, inferredPatterns } = e.payload;

  // Show UI, get user decision, then respond:
  core.session.confirm({
    requestId,
    approved: true,          // or false
    persist: true,           // save rule for future
    chosenPattern: "src/**", // which pattern to trust
  });
});
```

If you don't respond within `securityApprovalTimeout` seconds (default 120), the action is denied.

## Testing

### Mocking CoreAPI

The SDK provides in-memory repository implementations for testing:

```typescript
import {
  InMemoryAgentRepository,
  InMemorySessionRepository,
  InMemoryMemoryRepository,
  InMemoryPlanRepository,
  InMemorySkillRepository,
  InMemoryRoutineRepository,
} from "voidrift";
```

### Running Tests

```bash
npm test              # vitest run
npm run test:watch    # vitest (watch mode)
npm run typecheck     # tsc --noEmit
```

Tests mirror the `src/` directory structure under `tests/`.
