# VoidRift Plugin Development

Plugins extend VoidRift with new commands, agents, tools, skills, panels, extractors, guardrails, and context providers. They're npm packages that export a `register` function.

## Quick Start

```bash
mkdir my-voidrift-plugin && cd my-voidrift-plugin
npm init -y
```

**package.json:**
```json
{
  "name": "my-voidrift-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "voidrift": {
    "plugin": true
  }
}
```

**index.js:**
```javascript
export function register(core) {
  core.register.command("hello", "Say hello", async (args) => {
    // This runs when user types /hello
  });
}
```

**Install and enable:**
```bash
# In your project
npm install my-voidrift-plugin

# Add to .voidrift/config.json
{ "plugins": ["my-voidrift-plugin"] }
```

Restart VoidRift. Your plugin loads on boot.

## Discovery

VoidRift scans `node_modules/` for packages with `"voidrift": { "plugin": true }` in their package.json. Scoped packages (`@org/plugin-name`) are supported.

A plugin can be:
- **Available** — discovered but not enabled
- **Enabled (global)** — listed in `~/.config/voidrift/config.json` → `plugins[]`
- **Enabled (workspace)** — listed in `.voidrift/config.json` → `plugins[]`

Users manage plugins via `/plugins` panel or config.

## The `register` Function

Your plugin's entry point. Called once on boot with a `CoreAPI` instance scoped to your plugin name:

```typescript
import type { CoreAPI } from "voidrift";

export function register(core: CoreAPI) {
  // All registration happens here
}
```

Everything you register is tagged with your plugin name for attribution and cleanup.

## Registration APIs

### Commands

Add slash commands to the TUI:

```typescript
core.register.command("deploy", "Deploy to environment", async (args) => {
  // args = string[] (everything after /deploy)
  const env = args[0] || "staging";
  // Do work...
});
```

Commands appear in `/help`, autocomplete, and the command palette.

### Agents

Register custom agents (personas with specific tool sets):

```typescript
core.register.agent({
  id: "reviewer",
  name: "Code Reviewer",
  description: "Reviews code for quality and correctness",
  type: "interactive",  // or "passive" for background workers
  role: "",             // "" = modelSelected, "utility", or "escalation"
  prompt: "You are a code reviewer. Analyze code for bugs, style issues, and potential improvements. Never modify files — only report findings.",
  tools: ["read_file", "glob_files", "search_contents", "workspace_map"],
  approvalMode: "deny", // read-only agent
  allowedTools: ["read_file", "glob_files", "search_contents", "workspace_map"],
  active: true,
});
```

**Agent types:**
- `"interactive"` — user-facing, appears in Shift+Tab cycle
- `"passive"` — background worker, invoked via `run_task_agent`

**Agent roles:**
- `""` (empty) — uses `modelSelected` (or `modelBackground` for passive)
- `"utility"` — uses `modelUtility`
- `"escalation"` — uses `modelEscalation`

### Skills

Inject domain knowledge that loads contextually:

```typescript
core.register.skill({
  name: "docker-conventions",
  description: "Docker and container best practices for this org",
  triggers: {
    extensions: [".dockerfile"],
    files: ["Dockerfile", "docker-compose.yml"],
    keywords: ["docker", "container", "image", "compose"],
  },
  agents: [],  // empty = loads for all agents when triggered
  active: true,
  sourcePlugin: "my-plugin",
  content: `# Docker Conventions

- Multi-stage builds always
- Pin base image versions (no :latest)
- Non-root user in production images
- Health checks on all services
- .dockerignore must exclude node_modules, .git, dist
`,
});
```

Skills load automatically when their triggers match the current context (focused files, user input keywords, file extensions).

### Guardrails

Add mechanical enforcement rules to the tool loop:

```typescript
core.register.guardrail((tool, args, ctx) => {
  // Block production database writes
  if (tool === "execute_command") {
    const cmd = args.command;
    if (cmd.includes("production") && cmd.includes("migrate")) {
      return {
        block: true,
        preWarning: "Error: Production migrations require manual execution. Use staging first.",
      };
    }
  }

  // Advisory: warn about large file writes
  if (tool === "write_file" && args.content && args.content.length > 10000) {
    return {
      postWarning: "⚠️ Large file write (10K+ chars). Consider breaking into smaller files.",
    };
  }

  return null; // No opinion — let it through
});
```

**Return values:**
- `null` — no opinion, pass through
- `{ block: true, preWarning: "..." }` — reject the tool call, return error to model
- `{ preWarning: "..." }` — inject warning before tool result
- `{ postWarning: "..." }` — inject warning after tool result

Guardrails run AFTER the permission gate, BEFORE tool execution.

### Extractors

Register custom symbol extractors for the workspace code map:

```typescript
core.register.extractor({
  extensions: [".prisma"],
  extract(path, content) {
    const lines = content.split("\n");
    const symbols = [];

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^model\s+(\w+)/);
      if (match) {
        symbols.push({ name: match[1], kind: "model", line: i + 1 });
      }
      const enumMatch = lines[i].match(/^enum\s+(\w+)/);
      if (enumMatch) {
        symbols.push({ name: enumMatch[1], kind: "enum", line: i + 1 });
      }
    }

    return { symbols, lines: lines.length };
  },
});
```

Extractors are cached by file hash. They only re-run when file content changes. Later registrations override earlier ones for the same extension (plugin extractors override the base regex extractor).

### Prompts

Register system prompts (overridable by operators):

```typescript
core.register.prompt(
  "my-plugin.rules",
  "Always validate input before processing. Never trust user-supplied paths.",
  "Plugin Rules",       // label
  "Security rules from my-plugin"  // description
);
```

Operators can override via `.voidrift/prompts/my-plugin.rules.md`.

### Templates

Register document templates:

```typescript
core.register.template(
  "my-plugin.adr",
  `---
title: ADR-{{number}}: {{title}}
status: proposed
---

## Context

## Decision

## Consequences
`,
  "ADR Template",
  "Architecture Decision Record template"
);
```

### Context Providers

Inject dynamic content into prompt layers:

```typescript
// Agent layer (static per session — highest cache priority)
core.register.agentProvider("my-status", () => {
  return `Current deploy status: ${getDeployStatus()}`;
});

// Orbit layer (semi-static — project landscape)
core.register.orbitProvider("my-metrics", () => {
  const metrics = loadProjectMetrics();
  return metrics ? `## Project Health\n${metrics}` : null;
});

// Drift layer (dynamic — changes on tool use)
core.register.driftProvider("my-state", () => {
  return `Active feature flags: ${getActiveFlags().join(", ")}`;
});
```

Return `null` to skip injection for this turn.

### Panels

Register custom TUI panels (advanced):

```typescript
core.register.panel("my-panel", {
  title: "My Panel",
  columns: [
    { key: "name", label: "Name", width: 20 },
    { key: "status", label: "Status" },
  ],
  getItems: () => [
    { name: "Item 1", status: "active" },
    { name: "Item 2", status: "pending" },
  ],
});
```

Panels are opened via slash commands you register separately.

## Event Bus

Subscribe to harness events for reactive behavior:

```typescript
// React to tool execution
core.events.subscribe("AFTER_TOOL_EXECUTE", (event) => {
  if (event.payload.toolName === "execute_command" && event.payload.status === "error") {
    // Track build failures
    recordFailure(event.payload.output);
  }
});

// React to file changes
core.events.subscribe("FILE_MODIFIED", (event) => {
  if (event.payload.path.endsWith(".env")) {
    // Warn about env changes
    core.events.emit("WARNING_EMITTED", {
      message: "⚠️ .env modified — restart may be needed",
      source: "my-plugin",
      category: "info",
    });
  }
});

// React to session lifecycle
core.events.subscribe("SESSION_START", (event) => {
  // Initialize plugin state
});

core.events.subscribe("TURN_COMPLETE", (event) => {
  // Post-turn cleanup
});
```

### Custom Events

Register and emit your own events:

```typescript
core.events.register("MY_PLUGIN_EVENT");
core.events.emit("MY_PLUGIN_EVENT", { data: "value" });

// Other plugins or the host can subscribe
core.events.subscribe("MY_PLUGIN_EVENT", (e) => { /* ... */ });
```

## Package Metadata

Full package.json for a published plugin:

```json
{
  "name": "@myorg/voidrift-plugin-deploy",
  "version": "1.0.0",
  "description": "Deployment automation for VoidRift",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "voidrift": {
    "plugin": true,
    "description": "Adds /deploy command and deployment guardrails"
  },
  "keywords": ["voidrift", "voidrift-plugin", "deploy"],
  "peerDependencies": {
    "voidrift": ">=0.3.0"
  },
  "scripts": {
    "build": "tsc"
  }
}
```

**Conventions:**
- Use `voidrift` as a peer dependency (not regular dependency)
- Set `"voidrift": { "plugin": true }` for discovery
- Export a named `register` function
- Use ESM (`"type": "module"`)

## TypeScript

Import types from voidrift:

```typescript
import type { CoreAPI, AgentManifest, Guardrail, SymbolExtractor } from "voidrift";

export function register(core: CoreAPI) {
  // Full type safety
}
```

## Lifecycle

1. **Discovery** — VoidRift scans node_modules on boot
2. **Activation** — plugins listed in config `plugins[]` are loaded
3. **Registration** — `register(core)` is called with a scoped CoreAPI
4. **Runtime** — commands, agents, skills, guardrails are live
5. **Shutdown** — no explicit teardown (use event subscribers for cleanup)

Plugins cannot:
- Access the filesystem directly (use registered tools)
- Modify other plugins' registrations
- Access the raw engine context (only CoreAPI surface)

## Testing Plugins

```typescript
import { createCore } from "voidrift";
import { register } from "./index.js";

const core = await createCore({ workspaceRoot: "/tmp/test-workspace" });
register(core);

// Verify command registered
const cmds = core.session.listCommands();
assert(cmds.some(c => c.name === "deploy"));

// Verify agent registered
const agents = core.agents.list();
assert(agents.agents.some(a => a.id === "reviewer"));

await core.session.shutdown();
```

## Examples

### Minimal: Custom Command

```typescript
export function register(core) {
  core.register.command("todos", "Find all TODOs in codebase", async () => {
    const result = core.workspace.exec("grep -rn 'TODO\\|FIXME' src/ | head -20");
    // Output goes to the user
  });
}
```

### Medium: Agent + Skill + Guardrail

```typescript
export function register(core) {
  // Agent that only reads
  core.register.agent({
    id: "auditor",
    name: "Security Auditor",
    description: "Scans for security issues",
    type: "interactive",
    role: "",
    prompt: "You are a security auditor. Scan code for vulnerabilities. Report findings. Never modify files.",
    tools: ["read_file", "glob_files", "search_contents", "workspace_map", "web_search"],
    approvalMode: "deny",
    allowedTools: ["read_file", "glob_files", "search_contents", "workspace_map", "web_search"],
    active: true,
  });

  // Skill loaded when auditor is active
  core.register.skill({
    name: "security-patterns",
    description: "Common vulnerability patterns to check",
    triggers: { keywords: ["security", "vulnerability", "audit"] },
    agents: ["auditor"],
    active: true,
    sourcePlugin: "my-plugin",
    content: "# Security Patterns\n\nCheck for: SQL injection, XSS, path traversal, hardcoded secrets, insecure deserialization...",
  });

  // Block production access from auditor
  core.register.guardrail((tool, args, ctx) => {
    if (tool === "execute_command" && args.command?.includes("prod")) {
      return { block: true, preWarning: "Error: Auditor cannot access production systems." };
    }
    return null;
  });
}
```

### Advanced: Custom Extractor + Context Provider

```typescript
export function register(core) {
  // Parse GraphQL schema files for the code map
  core.register.extractor({
    extensions: [".graphql", ".gql"],
    extract(path, content) {
      const lines = content.split("\n");
      const symbols = [];
      for (let i = 0; i < lines.length; i++) {
        const typeMatch = lines[i].match(/^type\s+(\w+)/);
        if (typeMatch) symbols.push({ name: typeMatch[1], kind: "type", line: i + 1 });
        const queryMatch = lines[i].match(/^\s+(query|mutation|subscription)\s*\(/);
        if (queryMatch) symbols.push({ name: queryMatch[1], kind: "operation", line: i + 1 });
      }
      return { symbols, lines: lines.length };
    },
  });

  // Inject API schema summary into Orbit layer
  core.register.orbitProvider("graphql-schema", () => {
    try {
      const schema = core.workspace.exec("cat schema.graphql | head -50");
      return schema ? `## GraphQL Schema (preview)\n\`\`\`\n${schema}\n\`\`\`` : null;
    } catch { return null; }
  });
}
```
