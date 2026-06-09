# VoidRift Plugin Development Guide

Everything you need to build plugins for VoidRift.

---

## Overview

Plugins extend VoidRift by registering commands, agents, prompts, panels, and event handlers through a single `CoreAPI` interface. Plugins never import internal modules directly — all interaction goes through the public API.

---

## Plugin Discovery

VoidRift discovers plugins in two ways:

1. **npm packages** with `"voidrift": { "plugin": true }` in their `package.json`
2. **Local packages** in your workspace's `node_modules`

A discovered plugin must export an `activate` function:

```typescript
import type { CoreAPI } from "@voidrift/core";

export function activate(api: CoreAPI): void {
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
api.registerCommand("deploy", "Deploy to production", async (args) => {
  const env = args[0] || "staging";
  api.output(`Deploying to ${env}...`);
  const result = api.executeCommand(`./scripts/deploy.sh ${env}`);
  api.output(result.output);
});
```

#### `registerAgent(manifest)`

Register a custom agent with its own persona, tools, and model tier.

```typescript
api.registerAgent({
  id: "reviewer",
  name: "Code Reviewer",
  description: "Reviews code changes and suggests improvements",
  type: "interactive",
  modelTier: "utility",
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
api.registerPrompt(
  "style.typescript",
  "Use strict TypeScript. No `any`. Prefer `unknown` with type guards.",
  "TypeScript Style",
  "Strict typing guidelines for TypeScript projects"
);
```

#### `registerTemplate(key, content, label?, description?)`

Register a reusable template.

```typescript
api.registerTemplate(
  "pr-description",
  "## Summary\n{summary}\n\n## Changes\n{changes}\n\n## Testing\n{testing}",
  "PR Description",
  "Pull request description template"
);
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
api.registerPanel("deploys", {
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
api.registerEvent("DEPLOY_STARTED");
api.registerEvent("DEPLOY_COMPLETED");
```

#### `subscribeEvent(type, handler)`

Listen for events. Returns an unsubscribe function.

```typescript
const unsub = api.subscribeEvent("TURN_COMPLETE", (event) => {
  console.log(`Turn completed: ${event.payload.turnId}`);
});

// Later: unsub() to stop listening
```

#### `emitEvent(key, payload)`

Publish an event.

```typescript
api.emitEvent("DEPLOY_STARTED", { env: "production", commit: "abc123" });
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
const map = api.getWorkspaceMap();
api.output(map);
```

#### `getWorkspaceRoot()`

Get the absolute workspace path.

```typescript
const root = api.getWorkspaceRoot();
```

#### `injectTurnContext(label, content)`

Add context to the current turn's prompt (visible to the model for this turn only).

```typescript
api.injectTurnContext("Deploy Status", "Last deploy: staging @ 2024-01-15 14:30 (success)");
```

---

## Event Bus

All subsystems communicate through a central event bus. Plugins can subscribe to any event.

### Built-in Events

| Event | Payload | Description |
|-------|---------|-------------|
| `FILE_CREATED` | `{ path }` | File created in workspace |
| `FILE_MODIFIED` | `{ path }` | File modified |
| `FILE_DELETED` | `{ path }` | File deleted |
| `RESOURCE_CHANGED` | `{ path, type }` | Config/resource file changed |
| `USER_INPUT` | `{ text }` | User submitted input |
| `TOKEN_STREAM` | `{ token, done }` | Streaming token received |
| `TOOL_CONFIRMATION_REQUEST` | `{ tool, args, requestId, diff?, inferredPatterns? }` | Permission gate requesting approval |
| `TOOL_CONFIRMATION_RESPONSE` | `{ approved, requestId?, persist?, chosenPattern? }` | User responded to confirmation |
| `ERROR_OCCURRED` | `{ message, source? }` | Error from any subsystem |
| `TURN_COMPLETE` | `{ turnId }` | Model turn finished |
| `LOCKS_UPDATED` | `{ activeLocks }` | Worktree lock state changed |
| `SUBAGENT_SPAWNED` | `{ subagentId, worktreePath }` | Subagent started |
| `SUBAGENT_COMPLETED` | `{ subagentId, status }` | Subagent finished |
| `SESSION_START` | `{ workspaceRoot, globalConfig }` | Session began |
| `SESSION_END` | `{ sessionDurationMs, exitCode }` | Session ending |
| `MODE_CHANGED` | `{ previousMode, newMode }` | Agent mode switched |
| `BEFORE_TOOL_EXECUTE` | `{ toolName, arguments }` | Tool about to execute |
| `AFTER_TOOL_EXECUTE` | `{ toolName, arguments, status, output }` | Tool execution completed |
| `WORKSPACE_CHANGED` | `{ filePaths, changeType }` | Batch workspace change |

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
  modelTier: "flash" | "utility" | "dense" | "auto" | string;
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
| `modelTier` | Which model to use (`auto` = router decides) |
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
api.subscribeEvent("BEFORE_TOOL_EXECUTE", (event) => {
  if (event.payload.toolName === "execute_command") {
    api.injectTurnContext("Deploy Warning", "Production deploys require approval from #ops channel.");
  }
});
```

---

## Example Plugin

A complete plugin that adds a `/lint` command and monitors file saves:

```typescript
import type { CoreAPI } from "@voidrift/core";

export function activate(api: CoreAPI): void {
  // Register command
  api.registerCommand("lint", "Run linter on workspace", async (args) => {
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
  api.subscribeEvent("FILE_MODIFIED", (event) => {
    const path = event.payload.path;
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      const result = api.executeCommand(`npx eslint "${path}" --format compact`);
      if (result.output.includes("error")) {
        api.injectTurnContext("Lint Errors", result.output);
      }
    }
  });

  // Register panel
  api.registerPanel("lint-results", {
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
