# VoidRift Plugin Development Guide

Everything you need to build plugins for VoidRift.

---

## Overview

Plugins extend VoidRift by registering commands, agents, skills, prompts, templates, panels, and event handlers through a single `CoreAPI` interface. Plugins are npm packages — versioned, testable, and distributable.

**Plugins provide versioned defaults.** A plugin registers skills, agents, and prompts as code-defined defaults. Users can still override any of them via the filesystem cascade:

```
User override (.voidrift/) → Plugin defaults → Core built-ins
```

This means a company can ship `@acme/voidrift-standards` v2.3.0 with approved skills, agents, and prompts. Teams install the package and get deterministic behavior. Individual users can override specific pieces via their local `.voidrift/` directory without forking the plugin.

**What plugins add beyond filesystem resources:**
- **Slash commands** — custom runtime behavior (code, not markdown)
- **Event handlers** — react to tool calls, file changes, session lifecycle
- **Panels** — custom TUI data views
- **Context injection** — inject content per-turn based on conditions
- **Subagent spawning** — isolated worktree execution

---

## Plugin Discovery

VoidRift discovers plugins in two ways:

1. **npm packages** with `"voidrift": { "plugin": true }` in their `package.json`
2. **Local packages** in your workspace's `node_modules`

A discovered plugin must export an `activate` function:

```typescript
import type { CoreAPI } from "voidrift";

export function register(api: CoreAPI): void {
  // Register your extensions here
}
```

### package.json

```json
{
  "name": "@voidrift/plugin-example",
  "version": "1.0.0",
  "description": "Example VoidRift plugin",
  "voidrift": { "plugin": true },
  "main": "dist/index.js",
  "license": "MIT"
}
```

---

## CoreAPI Reference

### Registration Methods

#### `registerCommand(name, description, handler)`

Register a slash command.

```typescript
api.register.command("deploy", "Deploy to production", async (args) => {
  const env = args[0] || "staging";
  api.output(`Deploying to ${env}...`);
  const result = api.executeCommand(`./scripts/deploy.sh ${env}`);
  api.output(result.output);
});
```

#### `registerAgent(manifest)`

Register a custom agent with its own persona, tools, and model tier.

```typescript
api.register.agent({
  id: "reviewer",
  name: "Code Reviewer",
  description: "Reviews code changes and suggests improvements",
  type: "interactive",
  role: "utility",
  prompt: "You are a senior code reviewer. Analyze code for correctness, performance, security, and maintainability.",
  tools: ["read_file", "glob_files", "web_search"],
  approvalMode: "deny",
  allowedTools: ["read_file", "glob_files", "web_search"],
  active: true,
});
```

#### `registerPrompt(key, content, label?, description?)`

Register a prompt snippet available in the `/prompts` panel.

```typescript
api.register.prompt(
  "style.typescript",
  "Use strict TypeScript. No `any`. Prefer `unknown` with type guards.",
  "TypeScript Style",
  "Strict typing guidelines for TypeScript projects"
);
```

#### `registerTemplate(key, content, label?, description?)`

Register a reusable template.

```typescript
api.register.template(
  "pr-description",
  "## Summary\n{summary}\n\n## Changes\n{changes}\n\n## Testing\n{testing}",
  "PR Description",
  "Pull request description template"
);
```

#### `registerSkill(entry)`

Register a skill programmatically. Skills are loaded based on triggers or agent bindings.

```typescript
api.register.skill({
  name: "company-standards",
  description: "Engineering standards for ACME Corp",
  triggers: { keywords: ["review", "standards", "lint"] },
  agents: ["chat"],
  active: true,
  content: "# ACME Standards\n\n- All functions must have JSDoc...",
});
```

#### `overridePrompt(key, content)`

Replace an existing prompt by key. Overrides built-in prompts.

```typescript
api.overridePrompt("core.rules", "Your custom rules here...");
```

#### `extendPrompt(key, content)`

Append to an existing prompt without replacing it.

```typescript
api.extendPrompt("core.rules", "\n- Always use conventional commits");
```

#### `registerPanel(name, definition)`

Register a custom panel accessible via slash command.

```typescript
api.register.panel("deploys", {
  title: "Deploy History",
  columns: [
    { key: "env", label: "Environment", width: 12 },
    { key: "status", label: "Status", width: 10 },
    { key: "time", label: "Time", width: 20 },
  ],
  getItems: () => getDeployHistory(),
  actions: {
    r: { label: "Rollback", handler: (item) => rollback(item.id) },
  },
});
```

### Event Methods

#### `registerEvent(name)`

Declare a custom event type.

```typescript
api.events.register("DEPLOY_STARTED");
api.events.register("DEPLOY_COMPLETED");
```

#### `subscribeEvent(type, handler)`

Listen for events. Returns an unsubscribe function.

```typescript
const unsub = api.events.subscribe("TURN_COMPLETE", (event) => {
  console.log(`Turn completed: ${event.payload.turnId}`);
});

// Later: unsub() to stop listening
```

#### `emitEvent(key, payload)`

Publish an event.

```typescript
api.events.emit("DEPLOY_STARTED", { env: "production", commit: "abc123" });
```

### Service Methods

#### `output(text)`

Print text to the TUI output area.

```typescript
api.output("Build successful ✓");
```

#### `openPanel(name)`

Open a registered panel.

```typescript
api.openPanel("deploys");
```

#### `spawnSubagent(fileBoundaries, execute)`

Run work in a git worktree with file-level isolation.

```typescript
const task = await api.spawnSubagent(
  ["src/auth/", "tests/auth/"],
  async (worktreePath) => {
    // Do work in the isolated worktree
    return "success";
  }
);
```

#### `executeCommand(cmd, cwd?, timeout?)`

Execute a shell command.

```typescript
const result = api.executeCommand("npm run build", undefined, 60000);
if (result.output.includes("error")) {
  api.output("Build failed!");
}
```

#### `getWorkspaceMap()`

Get the structural code map of the workspace.

```typescript
const map = api.workspace.map();
api.output(map);
```

#### `getWorkspaceRoot()`

Get the absolute workspace path.

```typescript
const root = api.workspace.root();
```

#### `injectTurnContext(label, content)`

Add context to the current turn's prompt (visible to the model for this turn only).

```typescript
api.injectTurnContext("Deploy Status", "Last deploy: staging @ 2024-01-15 14:30 (success)");
```

---

## Event Bus

All subsystems communicate through a central event bus. Plugins can subscribe to any event.

### Event-Driven Architecture

VoidRift is event-driven. The turn flow is:

```
User Input → TURN_BEFORE (subscribers enrich context) → Model Invocation → TURN_AFTER (subscribers react) → TURN_COMPLETE
```

Internal features (message decay, skill resolution, context summaries, escalation) are all event subscribers — the same mechanism plugins use. There are no second-class citizens.

**`publishAndWait`** is used for lifecycle events (`TURN_BEFORE`, `TURN_AFTER`) where subscribers must complete before the turn proceeds. Fire-and-forget `publish` is used for informational events (`TURN_COMPLETE`, `FILE_MODIFIED`) where ordering doesn't matter.

### Priority (Metadata Only)

Subscriptions accept an optional priority label. Priority does NOT affect execution order — subscribers always run in FIFO registration order. Priority is metadata for future routing and UI highlighting.

```typescript
type EventPriority = "critical" | "high" | "normal" | "low" | "background";

api.events.subscribe("TURN_BEFORE", handler, { priority: "normal" });
```

| Priority | Use case |
|----------|----------|
| `critical` | User interrupts, permission denials, safety blocks |
| `high` | Merge conflicts, agent failures, user corrections |
| `normal` | Standard processing (default) |
| `low` | Scheduled cleanup, entropy scans |
| `background` | Diagnostics, telemetry, debug logging |

### Built-in Events

| Event | Payload | Awaited? |
|-------|---------|----------|
| `SESSION_START` | `{ workspaceRoot, globalConfig }` | No |
| `SESSION_END` | `{ sessionDurationMs, exitCode }` | No |
| `SESSION_RESUMED` | `{ sessionId, turnCount }` | No |
| `TURN_BEFORE` | `{ userMessage, activeTools, activePlan, recentSummaries, recentTools }` | Yes |
| `TURN_AFTER` | `{ userMessage, responseText, toolsUsed, turnId, model?, usage?, timingMs? }` | Yes |
| `TURN_COMPLETE` | `{ turnId }` | No |
| `TURN_CANCELLED` | `{ reason, turnId }` | No |
| `MODEL_RESOLVED` | `{ name, tier, protocol }` | No |
| `MODEL_ESCALATED` | `{ from, to, reason, auto }` | No |
| `MODEL_DEESCALATED` | `{ from, to }` | No |
| `TOKEN_STREAM` | `{ token, done }` | No |
| `BEFORE_TOOL_EXECUTE` | `{ toolName, arguments }` | No |
| `AFTER_TOOL_EXECUTE` | `{ toolName, arguments, status, output }` | No |
| `TOOL_CONFIRMATION_REQUEST` | `{ tool, args, requestId?, diff?, inferredPatterns? }` | No |
| `TOOL_CONFIRMATION_RESPONSE` | `{ approved, requestId?, persist?, chosenPattern? }` | No |
| `TOOL_BOUND` | `{ tools, source }` | No |
| `TOOL_UNBOUND` | `{ tools, reason }` | No |
| `CONTEXT_BUDGET_UPDATED` | `{ used, limit, percentage }` | No |
| `CONTEXT_COMPACTED` | `{ beforeCount, afterCount, freedTokens }` | No |
| `CONTEXT_PRESSURE` | `{ percentage, level }` | No |
| `FILE_FOCUSED` | `{ path, totalLines, tokensUsed }` | No |
| `FILE_UNFOCUSED` | `{ path, reason }` | No |
| `SKILL_LOADED` | `{ name, trigger }` | No |
| `SKILL_UNLOADED` | `{ name }` | No |
| `MEMORY_LOADED` | `{ id, title, scope }` | No |
| `MEMORY_UNLOADED` | `{ id }` | No |
| `MEMORY_SAVED` | `{ id, title, scope, type }` | No |
| `FILE_CREATED` | `{ path }` | No |
| `FILE_MODIFIED` | `{ path }` | No |
| `FILE_DELETED` | `{ path }` | No |
| `FILE_INDEXED` | `{ path, symbolCount }` | No |
| `WORKSPACE_CHANGED` | `{ filePaths, changeType }` | No |
| `RESOURCE_CHANGED` | `{ path, type }` | No |
| `CODEMAP_UPDATED` | `{ fileCount, dirCount }` | No |
| `MODE_CHANGED` | `{ previousMode, newMode }` | No |
| `AGENT_ACTIVATED` | `{ from, to, trigger }` | No |
| `SUBAGENT_SPAWNED` | `{ subagentId, worktreePath }` | No |
| `SUBAGENT_COMPLETED` | `{ subagentId, status }` | No |
| `LOCKS_UPDATED` | `{ activeLocks }` | No |
| `TASK_SCHEDULED` | `{ taskId, type, pattern }` | No |
| `TASK_FIRED` | `{ taskId, instruction }` | No |
| `TASK_COMPLETED` | `{ taskId, status, output? }` | No |
| `PERMISSION_GRANTED` | `{ tool, pattern?, persist }` | No |
| `PERMISSION_DENIED` | `{ tool, reason }` | No |
| `POLICY_RULE_ADDED` | `{ tool, pattern?, decision, source }` | No |
| `STRUGGLE_DETECTED` | `{ text, expectedAction }` | No |
| `ERROR_OCCURRED` | `{ message, source? }` | No |
| `WARNING_EMITTED` | `{ message, source, category? }` | No |
| `PLAN_ITEM_ADDED` | `{ name, priority, description }` | No |
| `PLAN_ITEM_REMOVED` | `{ name }` | No |
| `PLAN_ITEM_UPDATED` | `{ name, field, oldValue?, newValue? }` | No |
| `USER_INPUT` | `{ text }` | No |

### Plugin Integration Rules

1. **Subscribe, don't poll.** If you need to know when something happens, subscribe to the event.
2. **TURN_BEFORE is your context injection point.** Need to add information before the model runs? Subscribe to `TURN_BEFORE` and call `api.injectTurnContext()`.
3. **TURN_AFTER is your reaction point.** Need to log, summarize, or trigger follow-up after a turn? Subscribe to `TURN_AFTER`.
4. **Don't block TURN_BEFORE unnecessarily.** Subscribers run sequentially. If your handler is slow, it delays the entire turn. Keep handlers fast (<100ms for local work).
5. **Error resilience.** If your subscriber throws, the bus catches it and continues to the next subscriber. Your error won't kill the turn.
6. **Custom events for plugin-to-plugin communication.** Register with `api.events.register("MY_EVENT")`, emit with `api.events.emit()`, subscribe with `api.events.subscribe()`.
7. **Priority is documentation.** Use it to signal intent (`critical` for safety, `background` for telemetry). It doesn't change execution order today.

---

## Panel Definition Schema

Panels are data-driven UI components rendered in the TUI.

```typescript
interface PanelColumn {
  key: string;     // Property name on row object
  label: string;   // Column header text
  width?: number;  // Character width (optional)
}

interface PanelAction {
  label: string;
  handler: (item: any) => void | Promise<void>;
}

interface PanelDefinition {
  title: string;
  columns: PanelColumn[];
  getItems: () => any[];
  actions?: Record<string, PanelAction>;
}
```

### Rules

- Every panel dismisses with ESC
- Use `ScrollView` for content exceeding terminal height
- Table cells use `trunc(str, max)` — never raw overflow
- Column widths are fixed integers; total must fit 80-char minimum
- `getItems()` is called on each render — keep it cheap (no async, no I/O)
- Actions keyed by single-char hotkeys shown in footer
- Destructive actions require y/n confirmation

---

## Agent Manifest

Custom agents define WHO the model is for a given mode.

```typescript
interface AgentManifest {
  id: string;
  name: string;
  description: string;
  type: "interactive" | "task";
  role: "flash" | "utility" | "dense" | "auto" | string;
  prompt: string;
  tools: string[];
  approvalMode: "prompt" | "deny" | "autonomous";
  allowedTools: string[];
  welcomeMessage?: string;
  active: boolean;
  resources?: string[];
  async?: boolean;
}
```

| Field | Description |
|-------|-------------|
| `type` | `interactive` = user-facing mode, `task` = background delegation |
| `role` | Which model to use (`auto` = router decides) |
| `prompt` | Identity/persona prompt (WHO the agent is, not HOW it behaves) |
| `tools` | Tools available to this agent |
| `approvalMode` | `prompt` = ask for gated tools, `deny` = no writes, `autonomous` = no confirmation |
| `allowedTools` | Tools that auto-approve without the permission gate |
| `resources` | File URIs to auto-load into context when this agent activates |
| `async` | If true, task agent runs concurrently in a worktree |

---

## Skill Integration

Plugins can provide skills by placing markdown files in the skill directories, or by using `extendPrompt` to inject guidance dynamically.

### Skill File Format

```markdown
---
name: "my-plugin-skill"
description: "Domain knowledge provided by my plugin"
triggers:
  extensions: [".py"]
  keywords: ["django", "flask"]
agents: ["chat", "vibe"]
active: true
---

## Your Skill Content

Guidelines, patterns, and knowledge here...
```

### Dynamic Injection

For context-sensitive guidance that changes per turn:

```typescript
api.events.subscribe("BEFORE_TOOL_EXECUTE", (event) => {
  if (event.payload.toolName === "execute_command") {
    api.injectTurnContext("Deploy Warning", "Production deploys require approval from #ops channel.");
  }
});
```

---

## Example Plugin

A complete plugin that adds a `/lint` command and monitors file saves:

```typescript
import type { CoreAPI } from "voidrift";

export function register(api: CoreAPI): void {
  // Register command
  api.register.command("lint", "Run linter on workspace", async (args) => {
    const target = args[0] || ".";
    api.output(`Linting ${target}...`);
    const result = api.executeCommand(`npx eslint ${target} --format compact`);
    if (result.output.includes("error")) {
      api.output(`❌ Lint errors found:\n${result.output}`);
    } else {
      api.output("✓ No lint errors");
    }
  });

  // Auto-lint on file save
  api.events.subscribe("FILE_MODIFIED", (event) => {
    const path = event.payload.path;
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      const result = api.executeCommand(`npx eslint "${path}" --format compact`);
      if (result.output.includes("error")) {
        api.injectTurnContext("Lint Errors", result.output);
      }
    }
  });

  // Register panel
  api.register.panel("lint-results", {
    title: "Lint Results",
    columns: [
      { key: "file", label: "File", width: 30 },
      { key: "errors", label: "Errors", width: 8 },
      { key: "warnings", label: "Warnings", width: 10 },
    ],
    getItems: () => getLintResults(),
  });
}
```

---

## MCP as a Plugin Pattern

MCP servers function as first-class plugins. When connected, their tools are automatically registered and available to the model. The permission gate handles approval. Server instructions are injected into the system prompt.

To build an MCP server that integrates with VoidRift, follow the [MCP specification](https://modelcontextprotocol.io). VoidRift supports the full client spec including sampling (server requests model calls) and elicitation (server requests user input).
