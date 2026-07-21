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
| `send(params)` | Send a message (fire-and-forget, streams via events) |
| `execute(text, callbacks)` | Execute a turn with streaming callbacks |
| `cancel()` | Abort active generation |
| `clear()` | Reset conversation history |
| `compact()` | Compress old messages |
| `resume(sessionId)` | Load a previous session |
| `list()` | List all saved sessions |
| `command(name, args)` | Execute a slash command programmatically |
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

### `core.plan`

| Method | Description |
|--------|-------------|
| `list()` | All plan items grouped by priority |
| `get(filename)` | Get a plan item's full body |
| `add(input)` | Create a new plan item |
| `updatePriority(input)` | Move item to different lane |
| `updateBody(input)` | Edit item body (search/replace) |
| `remove(filename)` | Delete a plan item |

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
| `delete(name)` | Delete a skill |

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
| `map()` | Generate workspace code map |
| `exec(cmd)` | Execute a shell command |
| `tasks()` | Background task list |
| `runningCount()` | Active background processes |
| `diff()` | Uncommitted git changes |
| `config()` | Current merged configuration |

### `core.routines`

| Method | Description |
|--------|-------------|
| `list()` | All saved routines |
| `get(filename)` | Get routine body |
| `add(name, description, body)` | Create a routine |
| `remove(filename)` | Delete a routine |

### `core.plugins`

| Method | Description |
|--------|-------------|
| `list()` | Discovered plugins and status |
| `enable(id, scope)` | Enable a plugin |
| `disable(id)` | Disable a plugin |

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
