# VoidRift CLI Guide

Everything you need to install, configure, and use VoidRift in your terminal.

## Installation

```bash
npm install -g voidrift
```

**Requirements:**
- Node.js ≥ 22
- Git ≥ 2.30
- Linux, macOS, or WSL

## Configuration

VoidRift uses a two-level config system:
- **Global:** `~/.config/voidrift/config.json` — your models, defaults
- **Workspace:** `.voidrift/config.json` — per-project overrides

Workspace config merges on top of global.

### Minimal Configuration

One model is all you need:

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

### Multi-Model Configuration

Use cheap local models for routine work, cloud models for complex reasoning:

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

### Model Fields

| Field | Required | Description |
|-------|----------|-------------|
| `modelSelected` | Yes | Your primary model. Must reference a model in the `models` block. |
| `modelEscalation` | No | Lifeline model for complex tasks. If set, enables escalation. |
| `modelUtility` | No | Internal harness operations (preflight, summarization). If not set, those features are off. |
| `modelBackground` | No | Model for `/run`, routines, subagents. Defaults to `modelSelected`. |

### Escalation

If you assign an escalation model, the harness can switch to it when your primary model is stuck:
- Plan creation is blocked on the primary model — forces escalation
- 2 consecutive tool failures trigger automatic escalation
- Context usage exceeding 85% triggers escalation
- The model can call `escalate` manually when overwhelmed

The escalation model calls `deescalate` when the complex reasoning is done. No user intervention needed.

### Supported Providers

- **OpenAI-compatible:** Ollama, vLLM, Groq, DeepSeek, Together, Anyscale, LM Studio
- **Anthropic:** Claude (native protocol)
- **Google:** Gemini (native protocol)

## Operating Modes

Switch modes with `Shift+Tab`:

| Mode | Behavior |
|------|----------|
| **Chat** | Collaborative. Asks before making changes. Default mode. |
| **Plan** | Read-only. Produces plans and analysis without modifying files. |
| **Vibe** | Fully autonomous. All permissions auto-approve. |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Interactive help panel |
| `/model` | Switch or assign models |
| `/plan` | View and manage plans |
| `/run <instruction>` | Autonomous background execution |
| `/run routine <name>` | Execute a saved routine |
| `/run plan <name>` | Execute a saved plan |
| `/schedule <cron\|--delay> "instruction"` | Background timer & cron |
| `/reflection` | Reflect on past sessions — extract lessons into memory |
| `/stats` | Session analytics |
| `/context` | Context layer visualizer |
| `/tools` | List available tools |
| `/skills` | Skill registry (also: `/skills create <name>`, `/skills rename <old> <new>`) |
| `/memory` | Persistent knowledge manager |
| `/agents` | Agent manager (also: `/agents create <id> [passive] [global]`, `/agents rename <old> <new>`) |
| `/mcp` | MCP server connections |
| `/templates` | Document templates (also: `/templates create <name>`, `/templates rename <old> <new>`) |
| `/prompts` | System prompt overrides |
| `/tasks` | Background task monitor |
| `/routines` | Repeatable routine manager |
| `/resume` | Session browser |
| `/rewind [turn]` | Rollback to previous turn |
| `/diff` | Code diff viewer |
| `/config [global\|workspace]` | Edit configuration in editor |
| `/policy [add <allow\|deny> <tool> <pattern>]` | Security policy rules |
| `/history` | Audit event log |
| `/plugins` | Plugin manager |
| `/compact` | Compress conversation history |
| `/clear` | Reset session |
| `/exit` | Save and quit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit input |
| `Shift+Tab` | Cycle mode (Chat → Plan → Vibe) |
| `Tab` | Autocomplete command/path |
| `Esc` | Cancel generation / close panel |
| `Ctrl+C ×2` | Exit VoidRift |
| `Ctrl+V` | Attach clipboard image |
| `Ctrl+X` | Remove attached image |
| `↑/↓` | Input history / autocomplete navigation |

## Tuning Guide

### Single Cloud Model (Claude, GPT, Gemini)

```json
{
  "models": { "cloud": { "protocol": "...", "model": "...", "contextLimit": 200000 } },
  "modelSelected": "cloud"
}
```

No additional tuning needed. Preflight is off by default. No escalation.

### Single Local Model (7B-32B)

```json
{
  "models": { "local": { "protocol": "openai", "model": "qwen2.5-coder:7b", "baseUrl": "http://localhost:11434/v1", "contextLimit": 32768, "preflight": true } },
  "modelSelected": "local",
  "turnsMaxToolRounds": 5,
  "turnsReminderInterval": 10
}
```

- `preflight: true` — enables tool classifier (reduces confusion on small models)
- `turnsMaxToolRounds: 5` — prevents runaway loops
- `turnsReminderInterval: 10` — more frequent behavioral reminders

### Multi-Model (Local + Cloud Escalation)

```json
{
  "models": {
    "local": { "protocol": "openai", "model": "qwen2.5-coder:14b", "baseUrl": "http://localhost:11434/v1", "contextLimit": 32768, "preflight": true },
    "cloud": { "protocol": "anthropic", "model": "claude-sonnet-4-20250514", "apiKeyEnv": "ANTHROPIC_API_KEY", "contextLimit": 200000 }
  },
  "modelSelected": "local",
  "modelEscalation": "cloud",
  "modelUtility": "local",
  "modelEscalationFailureCount": 2
}
```

### Tuning Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `turnsMaxToolRounds` | 10 | Tool calls per turn before forced stop |
| `turnsReminderInterval` | 25 | Behavioral nudge frequency (0=disabled) |
| `modelEscalationFailureCount` | 2 | Failures before auto-escalation |
| `turnsContextBudgetStopPct` | 0.6 | Context % that halts tool execution |
| `contextDecayAfterTurns` | 20 | Auto-compact after N turns |
| `networkModelTimeoutMs` | 120000 | Model API timeout |
| `securityApprovalTimeout` | 120 | Seconds to wait for tool approval |

## Troubleshooting

**Model returns empty responses:**
- Check your endpoint is reachable
- Check context limit isn't exceeded (`/context` panel shows usage)
- Try a fresh session (`/clear`)

**Tools not available:**
- Check `/tools` panel for bound tools
- Enable preflight (`"preflight": true`) if model is small
- Use `/skills` to check loaded domain knowledge

**Slow responses:**
- Disable preflight if using a capable cloud model
- Reduce `turnsMaxToolRounds` for small models
- Check endpoint latency directly

**Session not saving:**
- Ensure you're running from a compiled build, not `bun src/main.tsx` from another directory
- Check `.voidrift/sessions/` for files

## Panels

Panels are interactive overlays opened via slash commands. Navigate with arrow keys, close with `Esc`.

### `/model` — Model Panel

Two tabs: **interactive** (your conversation model) and **background** (for `/run`, routines, subagents).

| Key | Action |
|-----|--------|
| `Enter` | Select as active model |
| `e` | Assign to escalation role |
| `u` | Assign to utility role |
| `x` | Clear role assignment |

A `✓` prefix marks the currently selected model. Role letters (`e`, `u`, `b`) appear in the Roles column.

### `/plan` — Plan Panel

Four tabs: **now**, **next**, **later**, **complete**. Plans track multi-step work across sessions.

| Key | Action |
|-----|--------|
| `Enter` | View plan details |
| `n` | Move to now |
| `x` | Move to next |
| `l` | Move to later |
| `Delete` | Remove plan item |

In detail view: `e` opens in editor, `r` runs the plan via `/run`.

### `/agents` — Agent Panel

Four tabs: **core interactive**, **core passive**, **custom interactive**, **custom passive**.

| Key | Action |
|-----|--------|
| `Enter` | View override cascade |
| `a` | Toggle active (custom only) |
| `c` | Create new agent (custom only) |
| `r` | Rename (custom only) |
| `Delete` | Delete (custom only) |

The override cascade shows how agent config resolves: Default → Global → Workspace. You can create overrides at each level.

### `/context` — Context Panel

Five tabs: **overview**, **agent**, **orbit**, **drift**, **void**. Shows real-time token allocation across the four context layers. The grid visualization shows which components consume the most budget.

### `/skills` — Skills Panel

Two tabs: **core** (builtin) and **custom** (user-created).

Core skills have an override cascade (like agents). Custom skills open directly in your editor.

| Key | Action |
|-----|--------|
| `Enter` | Details (core) / Edit (custom) |
| `c` | Create new skill |
| `r` | Rename |
| `Delete` | Delete |

### `/memory` — Memory Panel

Lists all saved memories. Loaded memories (in active context) show a `●` indicator.

| Key | Action |
|-----|--------|
| `Enter` | Edit in editor |
| `l` | Load into context |
| `u` | Unload from context |
| `Delete` | Delete permanently |

### `/mcp` — MCP Panel

Shows all configured MCP servers with connection status and tool count.

| Key | Action |
|-----|--------|
| `Enter` | Server details (tools, auth, config) |
| `c` | Create new server |
| `Delete` | Remove server |

In detail view: `x` connect/disconnect, `o` run OAuth flow, `a` toggle auto-connect.

### `/tasks` — Task Panel

Shows background processes from `/run`, `background_exec`, and subagents.

| Key | Action |
|-----|--------|
| `Enter` | View task output |
| `k` | Kill all running tasks |

### `/stats` — Session Stats

Read-only. Shows: session duration, turn count, tool success rate, per-tool breakdown, per-model token usage, context percentage.

### `/diff` — Diff Viewer

Shows uncommitted git changes. File list with additions/deletions count. Enter to view per-file unified diff.

### `/routines` — Routine Panel

Lists saved routines. Enter for details, `r` to run, `c` to create, `Delete` to remove.

### `/plugins` — Plugin Panel

Lists discovered plugins with enable/disable status. Enter for details (commands, agents contributed). `e` to enable, `d` to disable.

### `/policy` — Policy Panel

Read-only view of all security rules (source, tool, pattern, decision).

### `/history` — Audit Panel

Scrollable log of all session events (tool calls, model invocations, errors, file changes).

## Permission System (User-Facing)

When the model wants to write a file, run a command, or call an MCP tool, you'll see a confirmation dialog:

```
⚠ Tool requires approval
  write_file(path: src/main.ts, content: ...)

  -old line
  +new line

  ❯ Yes, allow once
    Allow this session, "src/main.ts"
    Always allow (project), "src/**"
    Always allow (user), "src/**"
    No
```

Options:
- **Yes, allow once** — runs this call only
- **Allow this session** — creates a session rule (lost on restart)
- **Always allow (project)** — persists to `.voidrift/config.json`
- **Always allow (user)** — persists to `~/.config/voidrift/config.json`
- **No** — denies the action

Rules use glob patterns. `src/**` allows any write under `src/`. `bun run *` allows any `bun run` command.

### Auto-Approved Actions

These never ask (in Chat mode):
- Reading files (`read_file`, `glob_files`, `search_contents`, `workspace_map`)
- Web research (`web_search`, `web_fetch`)
- Tool discovery (`search_tools`, `load_skill`, `deescalate`)
- Safe shell commands (`git status`, `git log`, `git diff`, `ls`, `pwd`, etc.)
- Plan operations (`read_plan`, `add_plan`, `remove_plan`, `prioritize_plan`, `update_plan`)
- Memory operations (`save_memory`, `delete_memory`, `list_memory`, `list_skills`)
- Scheduling (`schedule`, `background_exec`, `check_task`)
- Escalation (`escalate`)

### Gated Actions (require approval)

These always ask in Chat mode:
- File writes (`write_file`, `edit_file`)
- Shell commands (`execute_command`) — unless classified as "safe"
- MCP tool calls

### Vibe Mode

In Vibe mode, all permissions auto-approve. The model acts autonomously with zero gates. Use for trusted, low-risk work.

## Agents

Agents are personas with different tool sets, approval modes, and prompts.

### Built-in Agents

| Agent | Type | Behavior |
|-------|------|----------|
| **Chat** | Interactive | Full tool access, asks before mutating. Default. |
| **Plan** | Interactive | Read-only. Produces analysis and plans without modifying files. |
| **Vibe** | Interactive | Autonomous. All actions auto-approve. |
| **Indexer** | Passive | Codebase indexer. Runs in background. |
| **Summarizer** | Passive | Content summarizer. Runs in background. |

Switch with `Shift+Tab` or `/agents`.

### Creating Custom Agents

```bash
# Via command
/agents create my-agent interactive workspace

# Or manually create:
# .voidrift/agents/my-agent/agent.json
# .voidrift/agents/my-agent/prompt.md
```

**agent.json:**
```json
{
  "id": "my-agent",
  "name": "My Agent",
  "description": "What this agent does",
  "type": "interactive",
  "tools": ["read_file", "write_file", "edit_file", "execute_command", "search_contents"],
  "approvalMode": "prompt",
  "allowedTools": ["read_file", "search_contents"],
  "skills": ["my-domain-skill"],
  "active": true
}
```

**Key fields:**
- `tools` — which tools the agent CAN call
- `allowedTools` — which tools auto-approve (no confirmation dialog)
- `approvalMode` — `"prompt"` (asks), `"autonomous"` (never asks), `"deny"` (blocks unless explicit allow rule)
- `skills` — skill names permanently loaded for this agent
- `active` — whether it appears in the mode cycle

### Override Cascade

Built-in agents can be customized without modifying source:

```
Default (built-in) → Global (~/.config/voidrift/agents/chat/) → Workspace (.voidrift/agents/chat/)
```

Create an override to change Chat's prompt, tools, or approval mode for a specific project.

## Skills

Skills are domain knowledge injected into the model's context when relevant. They load automatically based on triggers.

### How Skills Load

1. **Keyword trigger** — user message contains a keyword (e.g., "deploy" loads the deployment skill)
2. **Extension trigger** — focused file has a matching extension (e.g., `.prisma` loads database skill)
3. **File trigger** — focused file matches a name (e.g., `Dockerfile` loads container skill)
4. **Agent binding** — skill declares it belongs to a specific agent
5. **Description matching** — 2+ significant words from skill description appear in user message

### Creating Skills

```markdown
---
name: "my-project-conventions"
description: "Coding conventions for this project"
triggers:
  keywords: ["convention", "style", "format", "lint"]
  extensions: [".ts", ".tsx"]
agents: []
active: true
---

# Project Conventions

- Use functional components, no classes
- Error boundaries at route level only
- API calls go through src/api/ layer
- Tests colocated: src/foo.ts → src/foo.test.ts
```

Place in `.voidrift/skills/` (project-specific) or `~/.config/voidrift/skills/` (global).

### Built-in Skills

| Skill | Triggers | Content |
|-------|----------|---------|
| planning | plan, break down, organize | Plan creation workflow |
| memory | remember, preference, forget | Memory system usage |
| delegation | delegate, background, parallel | Subagent/task patterns |
| workspace | workspace, file tree, explore | Workspace navigation |
| context-budget | context, compaction, token | Context layer guide |
| tasks | register_task, invoke_task | Reusable task patterns |
| model-escalation | escalate, stuck, reasoning | Escalation workflow |
| routines | routine, repeatable, recipe | Routine creation |

Override any built-in by creating a file with the same name in `.voidrift/skills/`.

## Memory

Memories are persistent facts that survive across sessions. They compound project knowledge over time.

### Types

- **directive** — loads EVERY session automatically. Use for absolute rules. ("Always use snake_case for API fields")
- **reference** — loads on demand when keywords match. Default type. ("Auth module is being deprecated")

### Scope

- **local** (`.voidrift/memory/`) — this project only
- **global** (`~/.config/voidrift/memory/`) — all projects

### How Memories Load

1. On startup, directive memories load into context automatically
2. Each turn, the memory index is checked against user input keywords
3. If keywords match, the memory's full body is injected into Orbit layer

### Creating Memories

The model creates memories via `save_memory` tool. You can also create them manually:

```markdown
---
id: mem-abc123
title: Auth uses JWT RS256
summary: Authentication module uses RS256 JWT tokens with Supabase
type: reference
context:
  keywords: ["auth", "jwt", "token", "supabase"]
---

The auth module (src/auth/) uses Supabase with RS256 JWTs.
Cookie-based sessions. Refresh token rotation enabled.
Never use HS256 — we had a security incident in Q2.
```

## Plans

Plans track multi-step work. They persist to disk, survive session restarts, and inject into the model's context.

### Priority Lanes

| Lane | Meaning |
|------|---------|
| **now** | Active work this session. Descriptions auto-inject into context. |
| **next** | Queued. Worked after current items complete. |
| **later** | Backlog. Acknowledged but not urgent. |
| **complete** | Done. Kept for reference. |

### Workflow

1. Model creates a plan (via `add_plan` — requires escalation if configured)
2. Plan appears in `/plan` panel under "now"
3. Model reads the plan each turn (`read_plan`) and works through checklist items
4. Items checked off as completed
5. When done, model removes the plan (`remove_plan`)

### Plan Files

Stored in `.voidrift/plan/`:

```markdown
---
priority: now
description: Refactor auth module to use JWT RS256
rationale: Current HS256 is a security risk
---

## Why
Security audit flagged HS256 as vulnerable.

## Tasks
- [x] Read current auth implementation
- [x] Create migration plan
- [ ] Update token generation
- [ ] Update verification middleware
- [ ] Run test suite

## Done When
All tests pass and no HS256 references remain.
```

## Routines

Routines are repeatable instructions that persist permanently. Unlike plans, they never move through lifecycle lanes — they're standing recipes you execute on demand.

### Creating Routines

```bash
/routines  # then press 'c'
```

Or have the model create one:
> "Create a routine called deploy-staging that runs the test suite, builds, and deploys to staging."

### Running Routines

```bash
/run routine deploy-staging
```

This spawns an autonomous background execution loop that follows the routine steps.

### Routine Format

Stored in `.voidrift/routines/`:

```markdown
---
description: Deploy to staging environment
---

## Steps
- [ ] Run test suite: bun run test
- [ ] Build: bun run build
- [ ] Deploy: ./scripts/deploy.sh staging
- [ ] Verify: curl -f https://staging.example.com/health

## Done When
Health check returns 200 and no test failures.
```

## Background Execution (`/run`)

Three modes:

### Ad-hoc Instruction

```bash
/run Fix all TypeScript errors in src/
```

The harness generates a plan, then executes it autonomously on the background model.

### Run a Plan

```bash
/run plan auth-refactor
```

Executes an existing plan item. Reads the plan body and works through it.

### Run a Routine

```bash
/run routine deploy-staging
```

Executes a saved routine. Fresh context each turn (no history accumulation).

### Monitoring

Background tasks appear in the footer (`⟳ 1`). Open `/tasks` to see output, status, and kill running tasks.

## Session Management

### Resume

```bash
/resume
```

Opens the session browser. Shows all past sessions with turn count, last activity, and last user message. Select to resume — conversation history loads back into context.

### Rewind

```bash
/rewind
# or
/rewind 5
```

Rolls back to a previous turn. Uses git checkpoints created automatically each turn. Destructive — conversation after that turn is lost.

### Compact

```bash
/compact
```

Manually triggers history compaction. Old turns are summarized into a structured recap. Recent turns keep full fidelity.

## VOIDRIFT.md (Steering File)

Create a `VOIDRIFT.md` in your project root (or `.voidrift/VOIDRIFT.md`) to give the model persistent project instructions:

```markdown
# Project Rules

- This is a Rust project using Axum for HTTP
- Database is PostgreSQL via sqlx (compile-time checked queries)
- Never use unwrap() in production code — always handle errors
- Tests use a dedicated test database, not mocks
- Deploy target is AWS ECS Fargate
```

This content injects into the Agent layer (highest cache priority) and takes precedence over general system prompt rules. A global `~/.config/voidrift/VOIDRIFT.md` applies to all projects.

## MCP Server Setup

### Local Server (stdio)

Most MCP servers run as local processes:

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

The server starts as a subprocess. Tools appear automatically once connected.

### Remote Server (HTTP)

For cloud-hosted MCP servers:

```json
{
  "mcp": {
    "remote-api": {
      "transport": "http-sse",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

### OAuth Authentication

If a server requires OAuth:

```json
{
  "mcp": {
    "github": {
      "transport": "http-sse",
      "url": "https://mcp.github.com/sse",
      "auth": {
        "type": "oauth2",
        "authorizeUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "clientId": "your-client-id",
        "scopes": ["repo", "read:org"],
        "tokenEnvVar": "GITHUB_MCP_TOKEN"
      }
    }
  }
}
```

Run the OAuth flow from the MCP panel: open server details → press `o`.

### Auto-Discovery

When creating a server in the MCP panel, VoidRift probes the URL and auto-discovers:
- Transport type
- Auth requirements
- Registers a dynamic client if supported

## Editor Integration

Configure your editor for file viewing/editing from panels:

```json
{
  "editor": "vscode"
}
```

Supported: `vscode`, `code`, `cursor`, `windsurf`, `zed`, `vim`, `nvim`, `neovim`, `emacs`, `nano`, `subl`, `kate`.

Terminal editors (vim, nvim, emacs, nano) block until you close the file. GUI editors open in the background.

## Configuration Reference

All configuration fields with defaults:

### Models

| Field | Default | Description |
|-------|---------|-------------|
| `modelSelected` | (required) | Primary model for conversations |
| `modelEscalation` | — | Lifeline model for complex tasks |
| `modelUtility` | — | Internal operations model |
| `modelBackground` | — | Background task model (defaults to selected) |
| `modelEscalationThreshold` | 0.85 | Context % that triggers auto-escalation |
| `modelEscalationFailureCount` | 2 | Consecutive failures before auto-escalation |

### Turns

| Field | Default | Description |
|-------|---------|-------------|
| `turnsMaxToolRounds` | 10 | Max tool calls per turn (0=unlimited) |
| `turnsPreflight` | — | Override preflight per workspace |
| `turnsReminderInterval` | 25 | Behavioral reminder every N tools (0=off) |
| `turnsMaxReadLines` | 2000 | Max lines from read_file |
| `turnsStallRecovery` | true | Detect stalled model and nudge |
| `turnsContextBudgetStopPct` | 0.6 | Stop tools at this context % |
| `turnsShowThinking` | false | Show reasoning tokens |

### Tasks

| Field | Default | Description |
|-------|---------|-------------|
| `tasksMaxRunTurns` | 50 | Max turns in autonomous `/run` loop |
| `tasksMaxConcurrent` | 1 | Simultaneous background subagents |

### Context

| Field | Default | Description |
|-------|---------|-------------|
| `contextDecayAfterTurns` | 20 | Auto-compact after N turns (0=off) |
| `contextKeepRecentTurns` | 10 | Turns kept at full fidelity |
| `contextCodeMapDepth` | 5 | Workspace tree depth |
| `contextSummarizeThreshold` | 500 | Lines above which files get summarized |

### Network

| Field | Default | Description |
|-------|---------|-------------|
| `networkModelTimeoutMs` | 120000 | Model API timeout |
| `networkModelRetries` | 3 | API retry count |
| `networkCommandTimeoutMs` | 30000 | Shell command timeout |
| `networkFetchTimeoutMs` | 10000 | Web fetch timeout |

### Security

| Field | Default | Description |
|-------|---------|-------------|
| `securityApprovalTimeout` | 120 | Seconds to wait for approval (0=no timeout) |

### Retention

| Field | Default | Description |
|-------|---------|-------------|
| `retentionMaxCacheAgeDays` | 14 | Purge cache older than N days |
| `retentionMaxSessionCount` | 20 | Keep at most N sessions |
| `retentionMaxLogAgeDays` | 14 | Purge logs older than N days |
