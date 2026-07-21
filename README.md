# VoidRift

An AI harness that runs in your terminal, connects to any model, and gives you complete control over what it can do.

![GitHub Sponsors](https://img.shields.io/github/sponsors/TylerJPresley)
![GitHub contributors](https://img.shields.io/github/contributors/TylerJPresley/voidrift)
![NPM Last Update](https://img.shields.io/npm/last-update/voidrift)
![NPM Version](https://img.shields.io/npm/v/voidrift)
![GitHub Repo stars](https://img.shields.io/github/stars/TylerJPresley/voidrift)
![GitHub watchers](https://img.shields.io/github/watchers/TylerJPresley/voidrift)
![GitHub forks](https://img.shields.io/github/forks/TylerJPresley/voidrift)

## Why VoidRift Exists

Most AI tools are closed ecosystems. They lock you into one model, one provider, one way of working. They run in the cloud, meter your usage, and decide what the AI can access. You get a chat window someone else designed and a bill at the end of the month.

VoidRift is the opposite. It's a local-first harness — an orchestration layer that sits between you and any model. You bring your own models (local or cloud), define your own rules, and extend it with plugins and MCP servers. Nothing phones home. Nothing is rate-limited by a third party. Your workspace, your models, your rules.

## What It Does

- **Model Independence** — Connect to any provider (Ollama, Claude, Gemini, GPT, vLLM, Groq). Switch mid-session. Assign an escalation model for complex tasks.
- **Real Permission System** — Policy engine with pattern matching, workspace boundaries, and command classification. The model physically cannot act without going through the gate.
- **Context Architecture** — Four-layer system designed for cache efficiency. Stable content caches between calls, volatile content churns. Faster, cheaper, more headroom.
- **MCP Support** — Full Model Context Protocol implementation. Connect any MCP server — databases, APIs, monitoring tools become available tools.
- **Planning & Memory** — Persistent task tracking and compounding project knowledge across sessions.
- **Skills & Plugins** — Injectable domain expertise and extensible architecture via events, panels, agents, and tools.
- **Workspace Tools** — Structured file access, git checkpointing, web research, command execution with full permission controls.
- **Programmable SDK** — CoreAPI exposes every capability as a TypeScript interface. Build VS Code extensions, web UIs, CI pipelines, or Slack bots on the same engine.
- **Terminal-Native** — React/Ink TUI that starts instantly, works over SSH, and stays out of your way.

## Quick Start

```bash
npm install -g voidrift
```

**Requirements:** Node.js ≥ 22, Git ≥ 2.30

### Configure

Create `~/.config/voidrift/config.json`:

```json
{
  "models": {
    "local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:7b-instruct",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768
    }
  },
  "modelSelected": "local"
}
```

That's it. One model, one field. Run `voidrift` and start working.

### Multi-Model Setup

Use a cheap local model for routine work. Escalate to a cloud model for complex reasoning:

```json
{
  "models": {
    "local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:14b",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768,
      "preflight": true
    },
    "claude": {
      "protocol": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "contextLimit": 200000,
      "maxOutputTokens": 8192
    }
  },
  "modelSelected": "local",
  "modelEscalation": "claude",
  "modelUtility": "local"
}
```

When `modelEscalation` is set:
- The local model handles all routine work
- Plan creation requires escalation (forces the stronger model to architect)
- 2 consecutive failures auto-escalate
- The model can call `escalate` when overwhelmed
- The escalation model calls `deescalate` when reasoning is done

### Supported Providers

| Provider | Protocol | Example `baseUrl` |
|----------|----------|-------------------|
| Ollama | `openai` | `http://localhost:11434/v1` |
| vLLM | `openai` | `http://localhost:8000/v1` |
| LM Studio | `openai` | `http://localhost:1234/v1` |
| Groq | `openai` | `https://api.groq.com/openai/v1` |
| Together | `openai` | `https://api.together.xyz/v1` |
| DeepSeek | `openai` | `https://api.deepseek.com/v1` |
| OpenAI | `openai` | `https://api.openai.com/v1` |
| Anthropic | `anthropic` | (uses native API) |
| Google Gemini | `google` | (uses native API) |

Any OpenAI-compatible endpoint works. Set `apiKeyEnv` to the environment variable holding your key.

## How It Works

### Operating Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Chat** | Asks before making changes | Day-to-day collaborative work |
| **Plan** | Read-only, produces plans and analysis | Architecture, research, design |
| **Vibe** | Fully autonomous, no permission gates | Trusted bulk operations |

Switch with `Shift+Tab`.

### Permission System

Every write, execute, and network action goes through a gate:

```
⚠ Tool requires approval
  edit_file(path: src/auth.ts, search: ..., replace: ...)

  -const token = sign(payload, "HS256")
  +const token = sign(payload, "RS256")

  ❯ Yes, allow once
    Allow this session, "src/auth.ts"
    Always allow (project), "src/**"
    No
```

Trust accumulates through patterns. "Always allow `src/**`" means future writes to src/ pass without asking. Rules persist to your config.

Safe commands (`git status`, `ls`, `npm test`) auto-approve. Dangerous commands (`rm -rf`, `sudo`) always ask. Commands with dedicated tool equivalents (`cat`, `grep`, `curl`) are denied with guidance.

### Context Architecture

The prompt is assembled in four layers, ordered by stability:

```
Agent   (static)      — persona, tool schemas, skills index
Orbit   (semi-static) — active plan, triggered skills, loaded memories
Drift   (dynamic)     — focused file summaries, git status
Void    (volatile)    — conversation messages
```

Providers that support prompt caching (Anthropic, Gemini) cache from the top. Stable content stays cached across turns → faster responses, lower cost.

### Planning & Memory

**Plans** track multi-step work:
```
/plan → view active items
```
Plans persist to disk, survive restarts, and auto-inject into context. The model reads the plan each turn and works through checklist items.

**Memory** compounds knowledge:
```
Model: "I'll remember that — auth uses RS256 JWTs with Supabase."
```
Memories persist across sessions. Directive memories load automatically. Reference memories load when keywords match.

### Skills

Domain knowledge that loads contextually. Working on Docker files? The Docker skill loads. Discussing deployment? The deployment skill loads. No manual management — triggers handle it.

Built-in skills cover: planning workflow, memory usage, delegation patterns, workspace navigation, context budget management, escalation, routines, and task definitions.

Create project-specific skills in `.voidrift/skills/`:
```markdown
---
name: "project-conventions"
description: "Coding conventions for this project"
triggers:
  keywords: ["convention", "style"]
  extensions: [".ts", ".tsx"]
active: true
---

- Functional components only
- Tests colocated: src/foo.ts → src/foo.test.ts
- API calls through src/api/ layer
```

### MCP Servers

Connect any Model Context Protocol server — databases, APIs, monitoring tools become available as model tools:

```json
{
  "mcp": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "$POSTGRES_URL" },
      "autoConnect": true
    }
  }
}
```

MCP tools go through the same permission gate as built-in tools. OAuth2 with PKCE is supported for remote servers.

### Background Execution

Run autonomous tasks without blocking your session:

```
/run Fix all TypeScript errors in src/
/run routine deploy-staging
/run plan auth-refactor
```

Background tasks use a separate model (`modelBackground`), run in their own context, and report results to the `/tasks` panel.

### SDK

VoidRift exposes its entire engine as a TypeScript SDK:

```typescript
import { createCore } from "voidrift";

const core = await createCore({ workspaceRoot: process.cwd() });
const result = await core.session.execute("Summarize this project", {
  onChunk: (chunk) => {
    if (chunk.type === "content") process.stdout.write(chunk.text);
  },
});
await core.session.shutdown();
```

Build VS Code extensions, web apps, CI tools, or anything else on the same CoreAPI. See the [SDK Reference](./docs/SDK.md).

### Plugins

Extend VoidRift with npm packages:

```typescript
export function register(core) {
  core.register.command("deploy", "Deploy to production", async (args) => { /* ... */ });
  core.register.guardrail((tool, args) => { /* ... */ });
  core.register.skill({ name: "docker", triggers: { extensions: [".dockerfile"] }, content: "..." });
}
```

See the [Plugin Guide](./docs/PLUGINS.md).

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Interactive help |
| `/model` | Switch models, assign roles |
| `/plan` | View and manage plans |
| `/run` | Autonomous background execution |
| `/skills` | Domain knowledge registry |
| `/memory` | Persistent knowledge |
| `/agents` | Agent management |
| `/mcp` | MCP server connections |
| `/context` | Context budget visualizer |
| `/stats` | Session analytics |
| `/diff` | Code diff viewer |
| `/config` | Edit configuration |

Full command reference in the [CLI Guide](./docs/CLI.md).

## Project Steering

Create a `VOIDRIFT.md` in your project root to give persistent instructions:

```markdown
# Project Rules

- This is a Rust project using Axum
- Database is PostgreSQL via sqlx
- Never use unwrap() in production code
- Deploy target is AWS ECS Fargate
```

This loads into every session automatically, at the highest cache priority. The model follows these rules without being told twice.

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [CLI Guide](./docs/CLI.md) | Users | Configuration, commands, panels, shortcuts, troubleshooting |
| [SDK Reference](./docs/SDK.md) | Developers | CoreAPI namespaces, events, headless mode |
| [Plugin Guide](./docs/PLUGINS.md) | Plugin Authors | Registration APIs, examples, lifecycle |
| [Architecture](./docs/ARCHITECTURE.md) | Contributors | System design, subsystems, data flow |
| [Contributing](./docs/CONTRIBUTING.md) | Contributors | Build, test, PR workflow |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development setup, testing, and pull request guidelines.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
