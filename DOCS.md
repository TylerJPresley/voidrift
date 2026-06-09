# VoidRift Documentation

Complete reference for features, commands, tools, and configuration.

---

## Modes

VoidRift has three operating modes. Switch with **Shift+Tab**.

| Mode | Behavior | Tool Access | Approval |
|------|----------|-------------|----------|
| **Chat** | Collaborative assistant. Asks before making changes. | All tools | Write/network/MCP tools require approval |
| **Plan** | Read-only architect. Produces plans, doesn't modify files. | Read tools + plan tools | N/A (no writes) |
| **Vibe** | Fully autonomous. Executes without asking. | All tools | None (auto-approved) |

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Interactive help panel with pages (general, commands, shortcuts, context) |
| `/exit` | Save session and exit |
| `/clear` | Reset conversation history and focused files |
| `/plan` | View, edit, or delete plan items. Supports priority tabs (now/next/later) |
| `/compact` | Compact conversation history to free context budget |
| `/resume` | Browse and resume previous sessions |
| `/rewind [turn]` | Rollback to a previous turn number |
| `/model [name]` | Switch active model or list available models |
| `/stats` | Session analytics (tokens, cost, turns, timing) |
| `/context` | Context visualizer showing all four partitions |
| `/tools` | List all available tools (core + MCP) with details |
| `/diff` | View uncommitted git changes |
| `/skills` | Skill registry — create, edit, delete, toggle skills |
| `/agents` | Agent manager — view and configure agents |
| `/mcp` | MCP server manager — add, connect, auth, configure |
| `/memory` | Memory manager — view and manage saved facts |
| `/templates` | Template registry |
| `/prompts` | Prompt manager — view and override system prompts |
| `/tasks` | Background task monitor |
| `/goal [instruction]` | Launch autonomous execution loop |
| `/schedule` | Background timer and cron task manager |
| `/plugins` | Plugin manager |
| `/policy` | View active security policy rules |
| `/policy add <allow\|deny> <tool> <pattern>` | Add a persistent policy rule |
| `/history` | Audit event history — chronological log of all actions |

---

## Tools

### File Operations

| Tool | Description | Approval |
|------|-------------|----------|
| `read_file` | Read file content with optional offset/limit for large files | Auto |
| `glob_files` | Scan workspace with glob patterns | Auto |
| `write_file` | Create or overwrite a file | Required |
| `edit_file` | Surgical search-and-replace block edit | Required |

**read_file parameters:**
- `path` (required) — Relative or absolute file path
- `offset` (optional) — Line offset to start reading from (0-indexed)
- `limit` (optional) — Maximum lines to read

Files under ~100K estimated tokens are returned in full. Larger files return the first chunk with guidance to use offset/limit.

**edit_file parameters:**
- `path` (required) — File path
- `search` (required) — Exact text block to find
- `replace` (required) — Replacement text block

### Shell Execution

| Tool | Description | Approval |
|------|-------------|----------|
| `execute_command` | Run a terminal command | Required (safe commands auto-approve within workspace) |

**Parameters:**
- `command` (required) — Shell command to execute
- `timeout` (optional) — Timeout in ms (default 30000)

**Shell classification:**
- **Safe** (auto-approve within workspace): `ls`, `head`, `tail`, `wc`, `pwd`, `echo`, `date`, `whoami`, `tree`, `file`, `which`, `type`, `git status/log/diff/branch/show`, version checks
- **Dangerous** (always ask): `rm -rf`, `chmod`, `sudo`, `dd`, `git push --force`, `drop table`
- **Has equivalent** (auto-denied with guidance): `cat`→read_file, `find`→glob_files, `grep`→search_content, `curl/wget`→web_fetch
- **Outside workspace** (always ask): Any command targeting paths outside the project directory

### Network

| Tool | Description | Approval |
|------|-------------|----------|
| `web_search` | Search the web (DuckDuckGo, Tavily, or Google) | Required |
| `web_fetch` | Fetch a URL and convert to markdown | Required |

### Planning

| Tool | Description | Approval |
|------|-------------|----------|
| `read_plan` | Read all plan items grouped by priority | Auto |
| `write_plan` | Add, remove, or reprioritize plan items | Auto |
| `update_plan` | Edit the body of a plan item via search/replace | Auto |

**write_plan actions:**
- `add` — Create item with name, description, rationale, priority, body
- `remove` — Delete item by name
- `prioritize` — Change item priority (now/next/later)

Plan items are stored as `.voidrift/plan/{name}.md` with YAML frontmatter.

### Memory

| Tool | Description | Approval |
|------|-------------|----------|
| `save_memory` | Save a fact or directive to long-term memory | Auto |

**Parameters:**
- `title` (required) — Short title
- `content` (required) — The fact to remember
- `keywords` (required) — Comma-separated keywords for retrieval
- `scope` (optional) — `local` (project) or `global` (all projects)

### Orchestration

| Tool | Description | Approval |
|------|-------------|----------|
| `spawn_subagent` | Spawn a subagent in an isolated git worktree | Required |
| `run_task_agent` | Delegate work to a specialized task agent | Required |
| `schedule` | Schedule a delayed or recurring task | Auto |

### LSP

| Tool | Description | Approval |
|------|-------------|----------|
| `lsp_definition` | Go to definition | Auto |
| `lsp_references` | Find all references | Auto |
| `lsp_hover` | Get type information | Auto |

### MCP

| Tool | Description | Approval |
|------|-------------|----------|
| `connect_mcp_server` | Connect to an MCP server by URI | Required |
| `mcp_*` (dynamic) | Any tool from a connected MCP server | Required |

---

## Permission System

Every tool call goes through the **PolicyEngine** before execution.

### Approval Flow

When a tool requires approval, an arrow-key selector appears:

```
╭──────────────────────────────────────────────────────╮
│ ⚠ Tool requires approval                             │
│   edit_file(path: "src/main.ts", search: "...")       │
│                                                       │
│  ❯ Yes, allow once                                    │
│    Trust "src/main.ts" in this session                │
│    Trust "src/**" in this session                     │
│    No                                                 │
│                                                       │
│   ↑↓ navigate · enter select · esc/ctrl+c cancel     │
╰──────────────────────────────────────────────────────╯
```

- **Yes, allow once** — Approve this single call. No rule saved.
- **Trust (exact)** — Approve this pattern for the rest of the session.
- **Trust (broad)** — Approve a broader pattern for the session.
- **No / esc / ctrl+c** — Deny and cancel the entire turn.

### Trust Patterns

| Tool Type | Exact | Broad |
|-----------|-------|-------|
| File tools | `src/utils/foo.ts` | `src/utils/**` |
| Shell commands | `ls /var/log/app` | `ls /var/log/*`, `ls *` |
| MCP tools | `mcp_research_search_papers` | `mcp_research_*` |

### Policy Rules

Rules persist in `.voidrift/policies.json` (workspace) or `~/.config/voidrift/policies.json` (global).

Add via CLI:
```
/policy add allow execute_command 'npm run *'
/policy add deny execute_command 'rm *'
```

### Workspace Boundary

The workspace root is the security boundary. Any file read, write, or shell command targeting paths **outside** the workspace requires explicit approval, even if the command would normally auto-approve.

---

## Configuration

### File Locations

| Path | Purpose |
|------|---------|
| `~/.config/voidrift/config.json` | Global configuration |
| `.voidrift/config.json` | Project-level overrides |
| `.voidrift/mcp/{name}.json` | MCP server configs (workspace) |
| `~/.config/voidrift/mcp/{name}.json` | MCP server configs (global) |
| `~/.config/voidrift/credentials/{name}.json` | Encrypted OAuth tokens |
| `.voidrift/plan/{name}.md` | Plan items |
| `.voidrift/skills/{name}.md` | Workspace skills |
| `~/.config/voidrift/skills/{name}.md` | Global skills |
| `.voidrift/memory/` | Project memory |
| `~/.config/voidrift/memory/` | Global memory |
| `.voidrift/policies.json` | Workspace policy rules |
| `~/.config/voidrift/policies.json` | Global policy rules |

### Config Schema

```json
{
  "tiers": {
    "flash": "model-name",
    "utility": "model-name",
    "dense": "model-name"
  },
  "models": {
    "model-name": {
      "protocol": "openai | anthropic | google",
      "model": "model-identifier",
      "baseUrl": "http://endpoint/v1",
      "apiKeyEnv": "ENV_VAR_NAME",
      "contextLimit": 32768,
      "temperature": 0.2,
      "maxOutputTokens": 4096,
      "topP": 0.95,
      "topK": 40,
      "additionalHeaders": {}
    }
  },
  "editor": "vscode | vim | nvim | emacs | cursor | zed | nano",
  "summarizeThreshold": 500,
  "maxReadLines": 1000,
  "maxConcurrentAgents": 1,
  "plugins": [],
  "search": {
    "provider": "duckduckgo | tavily | google",
    "apiKey": "optional-api-key"
  },
  "tracing": {
    "enabled": false,
    "apiKeyEnv": "LANGCHAIN_API_KEY",
    "project": "voidrift",
    "endpoint": "optional-custom-endpoint"
  }
}
```

### Model Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `protocol` | `"openai" \| "anthropic" \| "google"` | Yes | Provider protocol |
| `model` | string | Yes | Model identifier (passed directly to API) |
| `baseUrl` | string | Yes | API endpoint URL |
| `apiKeyEnv` | string | No | Environment variable containing the API key |
| `contextLimit` | number | Yes | Maximum token context window |
| `temperature` | number | No | Generation temperature (default 0.2) |
| `maxOutputTokens` | number | No | Max output tokens per response |
| `topP` | number | No | Nucleus sampling (0-1) |
| `topK` | number | No | Top-K sampling (anthropic/google only) |
| `additionalHeaders` | object | No | Extra HTTP headers (anthropic only) |

### Three-Tier Model Router

The router selects which model to use based on task complexity:

- **Flash** — Short inputs, simple tasks. Fast and cheap (local models).
- **Utility** — Medium complexity. Good balance of speed and capability.
- **Dense** — Long context, complex reasoning. Expensive cloud models.

**Auto-escalation:** If context usage exceeds 85% of the current model's limit, the router escalates to the next tier for subsequent turns.

**De-escalation:** If context drops below 50% (after compaction), reverts to auto routing.

---

## MCP (Model Context Protocol)

### Adding a Server

1. Open `/mcp` panel
2. Press `c` to create
3. Choose scope: `(w)` workspace or `(g)` global
4. Enter a server name
5. Paste the server URL
6. VoidRift auto-discovers auth requirements and generates the config

### Server Config Format

`.voidrift/mcp/{name}.json`:
```json
{
  "transport": "http-sse",
  "url": "https://mcp.example.com/mcp",
  "autoConnect": true,
  "auth": {
    "type": "oauth2",
    "authorizeUrl": "https://example.com/oauth/authorize",
    "tokenUrl": "https://example.com/oauth/token",
    "clientId": "client-id",
    "scopes": ["read", "write"],
    "tokenEnvVar": "EXAMPLE_TOKEN",
    "codeChallengeMethod": "S256"
  }
}
```

For local stdio servers:
```json
{
  "command": "npx",
  "args": ["-y", "@example/mcp-server"],
  "env": { "API_KEY": "$MY_API_KEY" },
  "autoConnect": true
}
```

### MCP Panel Actions

**List view:** `↑↓` navigate, `enter` details, `c` create, `del` delete (y/n confirm)

**Detail view:** `x` connect/disconnect, `o` run OAuth flow, `e` edit config, `a` toggle auto-connect, `esc` back

### Protocol Support

VoidRift implements the full MCP client specification:

- **Transport:** stdio and HTTP+SSE (Streamable HTTP)
- **Tools:** list, call, list_changed notifications
- **Resources:** list, read, subscribe/unsubscribe, list_changed
- **Prompts:** list, get, list_changed
- **Sampling:** Server can request model calls (routed to Flash tier)
- **Elicitation:** Server can request user input (shown as approval dialog)
- **Roots:** Server can query workspace roots
- **Completion:** Argument autocompletion from server
- **Logging:** Set server log verbosity
- **Instructions:** Server-provided instructions injected into system prompt
- **Session:** Managed by SDK transport layer

---

## Skills

Skills are markdown files with YAML frontmatter that provide domain-specific guidance to the model. They load dynamically based on context.

### Skill File Format

`.voidrift/skills/react-patterns.md`:
```markdown
---
name: "react-patterns"
description: "React component patterns and hooks best practices"
triggers:
  extensions: [".tsx", ".jsx"]
  files: ["package.json"]
  keywords: ["component", "hook", "react"]
agents: ["chat", "vibe"]
active: true
---

## React Standards

- Use functional components with hooks
- Prefer composition over inheritance
...
```

### Loading Behavior

- **Agent-bound:** Loads when the skill's `agents` list includes the active agent
- **Trigger-based:** Loads when focused files match extensions/filenames, or user input matches keywords
- **Discovery index:** Model always sees a lightweight list of available skills (name + description) so it knows what exists

---

## Context Architecture

Context is assembled in four layers ordered by ascending volatility:

### Agent Layer (static per agent)
- Persona (agent identity and behavior)
- Tool schemas
- Bound skills (always-loaded for this agent)
- Skill discovery index
- Memory index

### Orbit Layer (semi-static, ~5% change rate)
- Active plan (now items)
- Active skills (triggered by context)
- Active memory (loaded facts)

### Drift Layer (dynamic, ~30% change rate)
- File map (workspace structure)
- Active/focused files (summaries of recently accessed files)
- Workspace changes (modified/created/deleted)

### Void Layer (volatile, every turn)
- Conversation messages
- Diagnostics

---

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `Enter` | Input | Submit message |
| `Tab` | Input | Autocomplete file path or command |
| `Shift+Tab` | Input | Cycle mode (Chat → Plan → Vibe) |
| `Esc` | During generation | Cancel current turn |
| `Esc` | In panel | Close panel |
| `Ctrl+C` | Anywhere | Cancel turn / close panel / exit (double) |
| `↑↓` | Panel | Navigate items |
| `←→` | Help/Tools | Switch pages |
| `Enter` | Panel | View details / select |
| `Del` | Panel | Delete item (with y/n confirmation) |

---

## Prompts & Overrides

System prompts are modular and overridable.

### Override Cascade

1. `.voidrift/prompts/{key}.md` (workspace)
2. `~/.config/voidrift/prompts/{key}.md` (global)
3. Built-in default

### Overridable Keys

| Key | Purpose |
|-----|---------|
| `core.context-guide` | Explains the 4-layer context architecture to the model |
| `core.rules` | Behavioral constraints (retry cap, conciseness, etc.) |
| `core.tool-usage` | Tool selection guidance and efficiency rules |
| `chat` | Chat agent identity |
| `plan` | Plan agent identity |
| `vibe` | Vibe agent identity |

Override via file or `/prompts` panel.
