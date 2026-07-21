# VoidRift

An AI harness that runs in your terminal, connects to any model, and gives you complete control over what it can do. 

I'm still actively developing this while I use it. Feel free to give some feedback and let me know your successes and failures. I mostly built this for myself, but I also decided to share. I'm working on a dedicated development plugin and a VSCode integration. More to come on that later. Not everything has been fully vetted. 

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

I believe working with AI will land on a mix: local models on personal hardware, company-hosted models on internal infrastructure, and cloud APIs for heavy reasoning. VoidRift connects to all of them the same way. Run a 7B model on your GPU for fast iteration, point it at your company's Bedrock endpoint for compliance, escalate to Claude or GPT when the task demands it. The harness doesn't care where the model lives.

The model collaborates with you. It researches, proposes, and waits for your direction. It doesn't act unilaterally, doesn't overwrite your work, and doesn't exclude you from the process. Everything is customizable — prompts, skills, agents, permissions, tool access. Override what doesn't fit. The harness is an extension of how you work, not a replacement for it.


## What Makes VoidRift Different

**You own the stack.** There's no SaaS dependency. VoidRift connects to Ollama running on your GPU, a vLLM instance in your cluster, Claude via API, Gemini, Groq, DeepSeek — anything with an OpenAI-compatible endpoint. Switch models mid-session. Run a 7B local model for quick tasks and escalate to Opus for complex reasoning. You control cost, latency, and privacy.

**The permission system is real.** Not a prompt that says "please ask before writing files." A policy engine with pattern matching, workspace boundary enforcement, command classification, and an interactive approval flow. The model physically cannot write a file or run a command without going through the gate. You see exactly what it wants to do, approve or deny with one keypress, and build up trust rules that reduce friction over time without sacrificing security.

**Context is architected, not dumped.** Most tools shove your files and conversation into a single blob and hope it fits. VoidRift has a four-layer context architecture designed for cache efficiency and token optimization. Stable content (persona, tools, skills) lives in layers that rarely change — providers cache these between calls. Volatile content (conversation, file changes) lives in a separate layer that churns. The result: faster responses, lower costs, and more headroom for actual work.

**MCP makes it universal.** The Model Context Protocol turns VoidRift into a client for anything. Connect a research database, a deployment system, a monitoring tool, an internal API — any MCP server becomes a set of tools the model can call. Full spec implementation: tools, resources, prompts, sampling, elicitation, OAuth. One interface, infinite capabilities.

**It runs in a terminal.** Not an Electron app consuming 2GB of RAM. Not a browser tab competing with your other 47 tabs. A React/Ink TUI that starts instantly, works over SSH, and stays out of your way. Panels give you deep visibility (context usage, model stats, audit logs) without leaving the terminal.

## Features

### Model Independence

VoidRift doesn't care which model you use. It connects to anything.

Every major AI tool is married to a single provider. That means you inherit their pricing, their rate limits, their availability, and their context window sizes. When a better model launches from a competitor, you're stuck.

VoidRift connects to any model through a simple config block. Run a 7B model on your GPU for fast iteration, point it at your company's Bedrock endpoint for compliance, escalate to Claude or GPT when the task demands it. The harness doesn't care where the model lives.

**You select a model.** In the `/model` panel, pick which model to use for your conversations. Your choice is persisted per-project.

**Escalation is optional.** If you assign an escalation model (`modelEscalation`), the harness can switch to a more capable model when your primary model is stuck. The model calls `escalate` and a more capable model takes over. When the complex part is done, it calls `deescalate` to return to your primary. If you don't configure escalation, none of this exists — just one model doing everything.

**Automatic escalation** also fires when the primary model fails 2 consecutive tool calls, or when context usage exceeds 85% of the current model's window.

**Utility is the internal engine (optional).** If you assign a utility model (`modelUtility`), it runs preflight classifiers (tool selection), file summarization, and harness-internal processing. It never talks to the user directly. If you don't configure utility, these features use your selected model or are skipped.

**Utility must be fast, not smart.** The utility model should be:
- The lowest-latency endpoint you have (local > cloud)
- Configured with `temperature: 0` (deterministic classification)
- A model that does NOT use thinking/reasoning tokens (no chain-of-thought overhead)
- Small and fast — a 7B model on a local GPU is ideal

**Preflight is off by default.** Most models handle full tool schemas fine. Enable preflight (`"preflight": true` on a model) only if your model gets confused by too many tools — typically small local models (7B-13B).

**Background model.** You can assign a separate model for `/run`, routines, and subagents (`modelBackground`). This lets you use a different model for autonomous work than for interactive chat. Defaults to your selected model if not set.

**Task agents use roles.** Background agents (indexer, summarizer, custom task agents) declare which model role they run on — typically utility. They don't use your selected model. Their role is fixed in their agent config.

**Supported providers:**
- Any OpenAI-compatible API (Ollama, vLLM, Groq, DeepSeek, Together, Anyscale, LM Studio)
- Anthropic (Claude) — native protocol
- Google (Gemini) — native protocol

**Why this matters:** Model independence is insurance against lock-in. When the next breakthrough model ships — from any provider — you add a config block and use it immediately. No migration, no waiting for your tool vendor to add support.

### Permission System & Security

Every AI tool that can write files and run commands is a potential footgun. VoidRift takes this seriously with a real security layer — not just prompting the model to "be careful."

**The workspace boundary** is the first line of defense. The model can freely read files inside your project. The moment it tries to read, write, or execute outside the workspace root — even to `~/` — the permission gate fires. This prevents the model from wandering into your SSH keys, other projects, or system files.

**Shell command classification** categorizes every command before execution:
- **Safe commands** (ls, git status, npm test) auto-approve within the workspace — no friction for harmless operations
- **Dangerous commands** (rm -rf, chmod, sudo, git push --force) always ask regardless of trust rules
- **Has-equivalent commands** (cat, find, grep, curl) are auto-denied with guidance to use the dedicated tool instead — this prevents the model from bypassing the permission system via shell

**The confirmation dialog** is not a yes/no prompt. It's an arrow-key selector with contextual options:
- Allow once (no rule saved)
- Allow this session (pattern-based, lost on restart)
- Always allow — project scope (persists to `.voidrift/config.json`, shared with team)
- Always allow — user scope (persists to `~/.config/voidrift/config.json`, personal)
- Deny (and cancel the entire turn)

Patterns are inferred automatically — if the model edits `src/utils/auth.ts`, you can trust `src/utils/**` with one keypress. Session-scoped trust resets on restart. Project and user-scoped rules persist permanently.

**Persistent policy rules** (`/policy add`) let you pre-approve patterns permanently. `npm test` should always be allowed? Add a rule. `rm` should always be denied? Add a rule. Rules can be workspace-level (per-project) or global (personal, across all projects).

**Why this matters:** You can't productively use an AI tool if you're scared of what it might do. The permission system gives you confidence to grant the model real capabilities (shell, network, MCP) because you have real enforcement. It's not "the model promised to ask" — it physically cannot act without going through the gate.

### Context Architecture

Context is the model's working memory. Every tool wastes most of it. VoidRift doesn't.

The context window is assembled in **four layers**, ordered from most stable to most volatile:

**Agent Layer** (static per agent) — The model's identity, tool schemas, bound skills, and discovery indexes. This layer changes only when you switch agents. Because it's always at the top of the prompt and never changes mid-conversation, providers can cache it between API calls — saving you time and money on every turn.

**Orbit Layer** (semi-static) — Your active plan, triggered skills, and loaded memories. Changes maybe once every 20 turns. This is the project landscape — stable enough to cache but dynamic enough to reflect your current focus.

**Drift Layer** (dynamic) — The workspace file map, focused file summaries, and git status. Changes whenever the model reads or writes files. This is the model's awareness of the workspace's current state.

**Void Layer** (volatile) — The conversation messages and diagnostics. Changes every turn. This is what gets compacted when budget runs low.

**Progressive skill disclosure** means the model always sees a lightweight index of everything available (skills, memories, tools) without paying the token cost of loading it all. It loads full content on demand when relevant.

**Automatic compaction** summarizes older conversation turns when context gets tight, preserving key decisions and facts while freeing budget for new work.

**Message decay** proactively compacts old turns before they become a problem. After a configurable number of turns (default 20), older messages are automatically summarized — you don't have to wait for context to fill up. Configure via `contextDecayAfterTurns`. Set to 0 to disable.

**Context pressure awareness** injects budget warnings directly into the model's prompt at 50% and 80% usage. The model sees its own context state and adjusts behavior — being more concise, avoiding unnecessary file loads, and asking the user before starting large work that might not fit.

**Why this matters:** Context management is the difference between a tool that works on small tasks and one that handles real projects. VoidRift's layered architecture means you get cache hits (faster, cheaper), efficient budget usage (more headroom for actual files and conversation), and graceful degradation (compaction instead of truncation) — automatically, without thinking about it.

### MCP (Model Context Protocol)

MCP is what makes VoidRift an open platform instead of a closed tool.

The Model Context Protocol is an open standard that lets AI clients (like VoidRift) connect to external servers that provide tools, resources, and prompts. Any service that implements the MCP spec becomes instantly usable — the model can call its tools, read its resources, and follow its instructions.

**What this means in practice:**
- Connect a research database → model can search academic papers
- Connect your deployment system → model can check build status, trigger deploys
- Connect your internal API → model can query your data
- Connect a monitoring service → model can check alerts and metrics

**VoidRift implements the full MCP client spec:**
- **Tools** — list, call, and receive notifications when tools change
- **Resources** — list, read, subscribe to changes
- **Prompts** — list and get prompt templates from servers
- **Sampling** — servers can request model calls back through VoidRift (bidirectional)
- **Elicitation** — servers can request user input through VoidRift's confirmation UI
- **OAuth2 + PKCE** — automatic authentication discovery, browser-based flows, encrypted credential storage
- **Roots** — servers can query your workspace for grounding
- **Notifications** — real-time updates when server capabilities change

**Adding a server takes 30 seconds:** Open `/mcp`, press `c`, paste a URL. VoidRift auto-discovers auth requirements, generates the config, and you're connected.

**Permission integration:** Every MCP tool call goes through the same permission gate as built-in tools. You see exactly what the model wants to call, on which server, with which arguments. Trust rules work with `mcp_servername_*` patterns for broad server-level trust.

**Why this matters:** MCP turns VoidRift from "an AI that reads your files" into "an AI that can interact with any system you give it access to." The ecosystem is growing — dozens of MCP servers for everything from databases to cloud providers to research tools. Each one you connect multiplies VoidRift's capabilities without changing a line of code.

### Multi-Agent Architecture

Different tasks need different approaches. VoidRift doesn't force one mode.

**Three interaction modes** (Shift+Tab to cycle):

**Chat** — Collaborative. The model proposes changes and you approve them. It has full tool access but every write/execute operation goes through the permission gate. This is your default for most work — you maintain control and the model handles the tedious parts.

**Plan** — Read-only architect. The model reads files and produces plans but cannot modify anything. Use this when you want to think through an approach before committing to changes. The model creates structured plan items you can review, reprioritize, and then execute in Chat or Vibe mode.

**Vibe** — Fully autonomous. The model reads, writes, executes, and iterates without asking. All permissions auto-approve. Use this for well-defined tasks where you trust the model to execute without supervision — test writing, mechanical refactors, boilerplate generation.

**Background subagents** run in isolated git worktrees. When the model spawns a subagent, it gets its own branch and directory — physically isolated from your working tree. A path-mutex scheduler prevents conflicts. This means the model can delegate work to background agents running on the cheap Flash model while you continue working in the foreground.

**Task agents** are purpose-built agents with constrained tools and specific personas. A "test writer" agent only has file read/write access and a persona focused on testing. A "documentation" agent writes docs but can't touch source code. You define what each agent can do.

**Why this matters:** The mode system matches the AI to the task. You wouldn't want autonomous execution for exploring a new project (use Chat). You wouldn't want approval dialogs for writing 50 test files (use Vibe). You wouldn't want file writes while brainstorming architecture (use Plan). One tool, three correct modes of use.

### Planning System

Plans give the model — and you — a persistent roadmap that survives across sessions and modes.

When you have a multi-step task, the model can break it into structured plan items with priorities:
- **Now** — actively working on these
- **Next** — queued, do these after now is done
- **Later** — backlog, acknowledged but not urgent

Each plan item has a description, rationale (why it matters), and a body (detailed notes, approach, acceptance criteria). They persist as markdown files in `.voidrift/plan/` — readable, editable, and version-controlled with your project.

**The model manages plans in any mode.** In Chat, it creates plans when you ask for them. In Plan mode, planning is the primary activity. In Vibe mode, it reads the active plan and works through items systematically.

**Plans carry context across sessions.** Resume a conversation tomorrow and the model immediately sees what was planned, what's done, and what's next. No re-explaining.

**Why this matters:** Without plans, AI assistants are stateless — they do what you ask in the moment and forget the bigger picture. Plans give continuity. They also give you editorial control: the model proposes a plan, you reprioritize items, remove things you disagree with, and the model follows your version.

### Memory System

Memory lets the model accumulate knowledge that compounds over time.

Every time the model discovers something important — a naming convention, an important decision, a user preference, a gotcha about the project — it can save it to long-term memory. Next session, that knowledge is available without you having to repeat it.

**Two scopes:**
- **Local memory** (`.voidrift/memory/`) — project-specific facts. "Our API uses snake_case." "The auth module is being deprecated." "Tests must use the mock database, never real connections."
- **Global memory** (`~/.config/voidrift/memory/`) — personal preferences across all projects. "Use descriptive variable names." "Prefer functional patterns." "Always add error handling."

**Selective loading:** Directive memories (rules, preferences) load automatically every session. Reference memories load on demand when the harness detects relevance via keyword matching. The model can browse all memories with `list_memory` and remove outdated ones with `delete_memory`.

**Why this matters:** Memory is what turns a tool into a collaborator. After a week of working on a project, VoidRift knows your project's conventions, your team's standards, and your personal preferences. A fresh session starts with 90% of the context a human collaborator would have, without any onboarding.

### Skills System

Skills are injectable expertise — domain knowledge the model loads based on what you're working on. VoidRift provides the skill system; you bring the skills.

A skill is a markdown file with trigger rules that you write for your domain. When you open a React file, your React skill loads automatically. When you're working on database code, your SQL skill activates. Each skill contains the guidelines, patterns, conventions, and anti-patterns that matter to your team.

**We provide the capability, you bring the skills.** VoidRift ships built-in skills for its own systems (planning, memory, tool-usage, context-guide) but doesn't ship domain skills — it gives you the infrastructure to encode your own expertise. Your team's component patterns. Your company's API standards. Your security policies. Write them once as markdown, and the model loads them at the right time.

**Trigger types:**
- **Extensions** — load when you focus files with matching extensions (`.tsx`, `.py`, `.rs`)
- **Files** — load when your workspace contains specific files (`Dockerfile`, `package.json`)
- **Keywords** — load when your input mentions specific terms ("deploy", "auth", "database")
- **Agent-bound** — declared in the agent's `skills` array, always loaded when that agent is active

**Progressive disclosure:** The model always sees a one-line description of every available skill. It doesn't pay the token cost of loading them all — just the ones triggered by current context. When you start working on something new, the relevant skill loads automatically.

**Workspace vs. global:** Project-specific skills live in `.voidrift/skills/` (scoped to the workspace you're running in). Personal skills live in `~/.config/voidrift/skills/` (available across all workspaces).

**Why this matters:** A general model knows a little about everything but isn't an expert in anything. Skills let you encode real expertise into the harness. The model performs like a domain expert because it has your domain-expert instructions loaded at the right time.

### Workspace Tools

VoidRift gives the model structured access to your project — reading, writing, searching, and executing within defined boundaries.

**File operations:** Read files with offset/limit for large files (no need to load 10K lines to read the first 50). Write new files. Edit existing files with surgical search-and-replace (the model specifies the exact block to find and what to replace it with — not a full rewrite). Glob search across the workspace.

**Workspace discovery:** The model explores your project structure on demand via the `workspace_map` tool — browsing directories, inspecting file symbols, and orienting itself progressively. No pre-loaded file tree consuming tokens every turn.

**Shell execution:** Run any terminal command with a 30-second default timeout. The permission system classifies commands and the model sees the full stdout/stderr output. Safe commands auto-approve within the workspace.

**Web access:** Search the web (DuckDuckGo, Tavily, or Google) and fetch URLs (HTML stripped to markdown). Both gated through the permission system.

**Git integration:** Automatic checkpointing before changes, diff viewer to inspect modifications, rollback capability via `/rewind`. The model can't accidentally destroy work — there's always a restore point.

**File summarization:** Large files are summarized by the Flash model into a compact representation with line-range indexing. The model can read the summary to understand structure, then read specific line ranges for details. This keeps context efficient.

**Why this matters:** These aren't novel capabilities individually — it's the integration. The permission system wraps every operation. The context architecture tracks what's been read and summarized. Git checkpointing makes everything reversible. The tools work together as a coherent system, not a bag of functions bolted onto a chat window.

### Plugin System

VoidRift is designed to be extended. Plugins add commands, agents, tools, panels, prompts, and event handlers through a single API surface.

**Plugin discovery:** Any npm package with `"voidrift": { "plugin": true }` in its package.json is automatically discovered. Local packages in your monorepo work too.

**CoreAPI surface:**
- Register slash commands with custom handlers
- Register agents with custom personas, tool sets, and model roles
- Register prompts and templates (or override built-in ones)
- Register panels with custom data views
- Subscribe to events (file changes, tool execution, session lifecycle)
- Inject context per-turn based on conditions
- Spawn subagents in isolated worktrees

**Event-driven architecture:** Everything in VoidRift publishes events — file changes, tool calls, session start/end, mode changes. Plugins can subscribe to any event and react (inject context, trigger automation, log to external systems).

**MCP servers as plugins:** Connected MCP servers are effectively plugins — they contribute tools, resources, and prompts to the system through the same registry.

**Why this matters:** No tool can anticipate every workflow. Plugins let you build the exact integrations your team needs. A deployment plugin that hooks into your CI. A lint plugin that auto-checks after edits. A metrics plugin that reports usage to your team dashboard. The harness handles orchestration; plugins handle domain logic.

### Terminal Interface

VoidRift runs as a React/Ink application in your terminal. No browser, no Electron, no GUI.

**Panels** give deep visibility into the system: context usage, model statistics, audit logs, security policies, plan items, memory entries, connected MCP servers. Everything is inspectable. You're never guessing what the model is working with.

**Tab completion** for file paths and commands. Type `/` and tab to see commands. Type a partial path and tab to complete it.

**Markdown rendering** in responses — code blocks, headers, lists, emphasis all render properly in the terminal.

**Token budget visualization** in the status bar shows real-time context usage so you know when you're approaching limits.

**Audit logging** records every action — what was called, what was approved, what was denied, when, with what arguments. Full accountability.

**Why this matters:** A terminal application starts in 200ms, works over SSH, uses 50MB of RAM, and doesn't fight your text editor for screen space. The panels give you the visibility of a GUI without the overhead. And because it's React/Ink, the UI is component-based and extensible — plugins can register their own panels.

## Installation

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Linux, macOS, or WSL | — | Native Windows is not currently supported |
| [Node.js](https://nodejs.org) | ≥ 22 | Runtime |
| [Git](https://git-scm.com) | ≥ 2.30 | Workspace checkpointing, worktree isolation |
| A model endpoint | — | Ollama, vLLM, cloud API, or any OpenAI-compatible server |

**For development only:**
- [Bun](https://bun.sh) ≥ 1.0 — package manager and dev server

**Optional:**
- [Ollama](https://ollama.ai) — easiest way to run local models
- A text editor set in config (`vscode`, `vim`, `nvim`, `cursor`, `zed`, `emacs`, `nano`) — for skill/prompt editing via panels

### Install Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

### Install VoidRift

```bash
# Install globally
npm install -g voidrift

# Or with Bun
bun install -g voidrift
```

### Run

```bash
# Navigate to your project
cd ~/my-project

# Launch
voidrift
```

VoidRift launches in the current directory as the workspace root. Type `/help` for the interactive guide, or just start typing.

### Development Install (from source)

If you want to contribute or run the latest unreleased version:

```bash
git clone https://github.com/TylerJPresley/voidrift.git
cd voidrift
bun install

# Run from source (TUI)
bun start

# Build and link globally (makes `voidrift` available on PATH)
npm run build
npm link
```

After `npm link`, any rebuild (`npm run build`) updates the global binary instantly. This is also how the VS Code extension finds the engine during development — it looks for `voidrift` on PATH.

## Configuration

VoidRift needs at least one model configured to function. Configuration lives in two places:

| Location | Scope | Purpose |
|----------|-------|---------|
| `~/.config/voidrift/config.json` | Global | Your default models and preferences |
| `.voidrift/config.json` | Project | Per-project overrides |

Project config is merged on top of global — you can override model assignments, add models, or change settings per workspace.

### Minimal Configuration (Local Model)

If you're running Ollama locally:

```bash
# Pull a model first
ollama pull qwen2.5-coder:7b-instruct

# Create config
mkdir -p ~/.config/voidrift
cat > ~/.config/voidrift/config.json << 'EOF'
{
  "models": {
    "local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:7b-instruct",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768,
      "temperature": 0.2
    }
  },
  "modelSelected": "local"
}
EOF
```

### Multi-Model Configuration (Mixed Local + Cloud)

Use cheap local models for simple tasks, cloud models for heavy reasoning:

```json
{
  "models": {
    "qwen-local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:7b-instruct",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768,
      "temperature": 0.2
    },
    "claude-sonnet": {
      "protocol": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "contextLimit": 200000,
      "temperature": 0.2,
      "maxOutputTokens": 8192
    },
    "claude-opus": {
      "protocol": "anthropic",
      "model": "claude-opus-4-20250514",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "contextLimit": 200000,
      "temperature": 0.2,
      "maxOutputTokens": 16384
    }
  },
  "modelSelected": "qwen-local",
  "modelEscalation": "claude-opus",
  "modelUtility": "claude-sonnet"
}
```

### Google Gemini Configuration

```json
{
  "models": {
    "gemini-flash": {
      "protocol": "google",
      "model": "gemini-2.0-flash",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "apiKeyEnv": "GOOGLE_API_KEY",
      "contextLimit": 1000000,
      "temperature": 0.2
    },
    "gemini-pro": {
      "protocol": "google",
      "model": "gemini-2.5-pro",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "apiKeyEnv": "GOOGLE_API_KEY",
      "contextLimit": 1000000,
      "temperature": 0.2,
      "maxOutputTokens": 65536
    }
  },
  "modelSelected": "gemini-flash",
  "modelEscalation": "gemini-pro",
  "modelUtility": "gemini-flash"
}
```

### vLLM / OpenAI-Compatible Server

Any endpoint that speaks the OpenAI chat completions API:

```json
{
  "models": {
    "my-server": {
      "protocol": "openai",
      "model": "meta-llama/Llama-3.1-70B-Instruct",
      "baseUrl": "http://your-server:8000/v1",
      "apiKeyEnv": "VLLM_API_KEY",
      "contextLimit": 131072,
      "temperature": 0.2
    }
  }
}
```

### Environment Variables

API keys are never stored in config files. Reference them by environment variable name:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_API_KEY="AIza..."
export OPENAI_API_KEY="sk-..."
```

The `apiKeyEnv` field in model config tells VoidRift which env var to read.

### Additional Config Options

```json
{
  "editor": "nvim",
  "summarizeThreshold": 500,
  "maxReadLines": 1000,
  "maxConcurrentAgents": 1,
  "plugins": [],
  "tracing": { "enabled": false, "apiKeyEnv": "LANGCHAIN_API_KEY", "project": "voidrift" },
  "search": {
    "provider": "duckduckgo"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `editor` | none | Editor for opening skill/prompt/agent files from panels |
| `selectedModel` | `"auto"` | Active model for user turns. Must reference a model in the models block. |
| `summarizeThreshold` | 500 | Lines above which files get Flash-summarized instead of full-loaded |
| `maxReadLines` | 1000 | Default max lines returned by read_file |
| `maxConcurrentAgents` | 1 | How many background subagents can run simultaneously |
| `approvalTimeout` | 120 | Seconds to wait for tool approval before auto-denying. 0 = wait forever |
| `contextDecayAfterTurns` | 20 | Auto-compact messages older than N turns. 0 = no decay |
| `contextKeepRecentTurns` | 10 | Messages to keep verbatim during compaction |
| `retentionMaxCacheAgeDays` | 14 | Purge cache files older than N days. 0 = never |
| `retentionMaxSessionCount` | 20 | Keep at most N sessions (oldest purged). 0 = unlimited |
| `retentionMaxLogAgeDays` | 14 | Purge log files older than N days. 0 = never |
| `plugins` | `[]` | Additional npm packages to load as plugins |
| `hooks` | `{}` | Event hooks: map of event name → shell commands (convention: `.voidrift/scripts/`) |
| `tracing` | `{ enabled: false, ... }` | LangSmith/Langfuse tracing: `enabled`, `apiKeyEnv`, `project`, optional `endpoint` |
| `search.provider` | `"duckduckgo"` | Web search backend (`duckduckgo`, `tavily`, `google`) |
| `search.apiKey` | none | API key for Tavily or Google search (not needed for DuckDuckGo) |

#### Orchestration (turns* + tasks*)

| Field | Default | Description |
|-------|---------|-------------|
| `turnsMaxToolRounds` | 10 | Max tool execution rounds per turn. 0 = unlimited |
| `turnsPreflight` | unset | Override preflight classifier. `true` = always run, `false` = never run, unset = use per-model `preflight` setting |
| `tasksMaxRunTurns` | 50 | Max turns in a `/run` autonomous loop |
| `turnsTrimThresholdLines` | 80 | Tool output lines above which output is trimmed to head/tail |
| `turnsTrimHead` | 30 | Lines kept from start of trimmed output |
| `turnsTrimTail` | 20 | Lines kept from end of trimmed output |
| `turnsContextBudgetStopPct` | 0.6 | Stop tool execution when context exceeds this % of limit |
| `modelEscalationThreshold` | 0.85 | Context usage % that triggers auto-escalation to dense model |
| `modelEscalationFailureCount` | 2 | Consecutive failures that trigger auto-escalation |
| `turnsSuggestionThreshold` | 3 | Repeated pattern occurrences before trace analyzer suggests improvement |

#### Network (network*)

| Field | Default | Description |
|-------|---------|-------------|
| `networkModelRetries` | 3 | Retries on model API failures |
| `networkModelTimeoutMs` | 120000 | Model API call timeout in ms |
| `networkModelFinalTimeoutMs` | 60000 | Timeout for final text response after tool execution completes |
| `networkModelRetryTimeoutMs` | 30000 | Timeout for nudge/retry when model returns empty or times out |
| `networkCommandTimeoutMs` | 30000 | Default shell command timeout in ms |
| `networkFetchTimeoutMs` | 10000 | Web fetch timeout in ms |
| `networkOauthCallbackPort` | 9876 | Localhost port for OAuth callback server |

#### Limits (turns* + context* + network* + tasks*)

| Field | Default | Description |
|-------|---------|-------------|
| `turnsMaxOutputLines` | 50 | Shell output truncation threshold (lines) |
| `turnsMaxReadLines` | 2000 | Maximum lines returned by read_file without offset/limit |
| `contextCodeMapDepth` | 5 | Workspace map directory walk depth |
| `networkWebMaxContentLength` | 50000 | Max characters from web fetch |
| `networkWebSmallFileLines` | 50 | Web content lines below which full content is returned inline |
| `tasksWorktreeTtlMinutes` | 120 | Stale worktree TTL before cleanup on boot |
| `contextCompactionKeepRecent` | 10 | Messages to keep verbatim during in-turn compaction |
| `contextReflectionBatchSize` | 3 | Sessions processed per batch during /reflection |

## Tuning Guide

VoidRift ships with conservative defaults that work for any setup. If you know your model and environment, tuning these values can significantly improve responsiveness and quality.

### Single Cloud Model (Claude, GPT, Gemini, Qwen-Max)

You have one capable model doing everything. Optimize for minimal latency:

```json
{
  "models": { "cloud": { "protocol": "...", "model": "...", "contextLimit": 200000 } },
  "modelSelected": "cloud"
}
```

No additional tuning needed. When only one model is configured:
- Preflight is skipped (no classifier call before each turn)
- Escalation prompt is not injected (no escalation model configured)
- The model handles everything directly

### Single Local Model (Ollama, vLLM — 7B-32B)

Small models benefit from reduced tool schemas and guardrails:

```json
{
  "models": { "local": { "protocol": "openai", "model": "qwen2.5-coder:7b", "baseUrl": "http://localhost:11434/v1", "contextLimit": 32768, "preflight": true } },
  "modelSelected": "local",
  "turnsMaxToolRounds": 5,
  "turnsReminderInterval": 10
}
```

Key settings:
- `preflight: true` on the model — enables the tool classifier so the model sees fewer schemas per turn (reduces confusion on small models)
- `turnsMaxToolRounds: 5` — prevents runaway tool loops that burn context
- `turnsReminderInterval: 10` — more frequent behavioral reminders (small models drift faster)

### Multi-Model (Local Primary + Cloud Escalation)

Local handles routine work cheaply, cloud fires for complex reasoning when needed:

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

How it works:
- Your primary model (local) handles chat, tool execution, and routine work
- When it tries to create a plan, the harness blocks it and forces escalation to cloud
- When it fails 2 consecutive tool calls, the harness auto-escalates to cloud
- Cloud creates the plan or resolves the complex issue, then deescalates back to your primary
- `modelBackground` controls what `/run` and subagents use (defaults to your selected model)

### Key Tuning Parameters

| Parameter | What it does | When to increase | When to decrease |
|-----------|-------------|-----------------|-----------------|
| `turnsMaxToolRounds` | Tool calls per turn before forced stop | Capable models on complex tasks | Small models that loop |
| `turnsReminderInterval` | Behavioral nudge frequency (0=disabled) | Never (confuses some models) | Small models that drift |
| `modelEscalationFailureCount` | Failures before auto-escalation to dense | Models that recover quickly | Models that spin on errors |
| `turnsContextBudgetStopPct` | Context % that halts tool execution | Large context models | Small context models |
| `contextDecayAfterTurns` | Auto-compact after N turns | Long sessions | Short sessions |
| `networkModelTimeoutMs` | Model API timeout | Slow endpoints | Fast local models |
| `networkModelTimeoutMs` | Model API timeout | Slow endpoints | Fast local models |

## Troubleshooting

### VoidRift won't start

**"Cannot find module" or import errors:**
```bash
# Clean install
rm -rf node_modules
bun install
```

**"bun: command not found":**
```bash
# Bun isn't in your PATH. Re-run the installer or add manually:
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

**Blank screen or immediate exit:**
- Your terminal must support 256 colors and Unicode. Most modern terminals do (iTerm2, Alacritty, Kitty, Windows Terminal, GNOME Terminal). Older terminals like raw `xterm` may not work.
- Minimum terminal size: 80 columns × 24 rows.

### Model connection issues

**"Connection refused" or timeout:**
- Verify the model endpoint is running: `curl http://localhost:11434/v1/models` (for Ollama)
- Check the `baseUrl` in your config — it should include `/v1` for OpenAI-compatible APIs
- For remote endpoints, ensure the port is accessible and not firewalled

**"401 Unauthorized" or "Invalid API key":**
- Check that the environment variable specified in `apiKeyEnv` is set: `echo $ANTHROPIC_API_KEY`
- Verify the key is valid with a direct curl: `curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages`
- Environment variables must be set in the shell that launches VoidRift, not just in a `.env` file

**"Model not found":**
- For Ollama: run `ollama list` to see installed models. The `model` field in config must match exactly.
- For cloud APIs: verify you have access to the model. Some models require waitlist approval.

**Model responds but output is garbage or empty:**
- Check `contextLimit` matches the actual model's limit. Setting it too high can cause silent failures.
- Try increasing `temperature` slightly (some models produce empty output at 0.0).
- Verify the model supports tool/function calling (required for VoidRift's tool system).

### Startup warnings (yellow ⚠ callouts)

VoidRift validates your configuration on startup. Yellow callouts indicate issues:

- **"References unknown skill"** — An agent's `skills` array names a skill that doesn't exist. Create the skill file in `.voidrift/skills/` or `~/.config/voidrift/skills/`, or remove the reference from the agent config.
- **"Missing required frontmatter keys"** — A skill file is missing `triggers`, `agents`, or `active` in its YAML header. Add the missing fields.
- **"Editor not found"** — The `editor` in your config isn't on PATH. Install it or change the setting.

These are non-fatal — VoidRift still runs, but the referenced features won't work correctly until fixed.

**"Changes rejected"** — When you edit a resource file (memory, skill, template, agent, prompt) and the result is invalid, VoidRift rejects the change:
- The invalid file is saved to `.voidrift/cache/rejected-<id>.<ext>` (your work is not lost)
- The original file is restored
- A warning tells you what was wrong and where your edit was saved
- Fix the issue in the cached file and save it to the correct location

### Permission issues

**Model keeps asking for approval on everything:**
- In Chat mode, all write operations require approval by design. Use Vibe mode (`Shift+Tab` twice) for autonomous execution.
- Add policy rules for common patterns: `/policy add allow execute_command 'npm test'`
- Trust broader patterns during the session or permanently (select project/user scope in the confirmation dialog)

**"auto-denied: use read_file instead":**
- The model tried to use `cat` or `grep` via shell. This is intentional — dedicated tools are safer and produce better context. The model should self-correct on the next attempt.

**Can't read files outside workspace:**
- By design. Approve the confirmation dialog to allow it, or use an absolute path which triggers the gate.

### MCP server issues

**"Server not connecting" or timeout:**
- Verify the URL is reachable: `curl https://mcp.example.com/mcp`
- Check if the server requires authentication. Open `/mcp`, select the server, press `o` to run the OAuth flow.
- Some servers need a warm-up period after first connection.

**"Schema is missing a method literal":**
- Update VoidRift to the latest version. This was a bug in older versions related to SDK request handlers.

**OAuth flow fails:**
- Ensure your browser can open from the terminal (`xdg-open` on Linux, `open` on macOS)
- The OAuth callback server runs on a random localhost port. Ensure no firewall blocks localhost connections.
- Check that the server's OAuth configuration hasn't expired or been revoked.

**MCP tools not appearing after connect:**
- The server may have no tools (only resources or prompts). Check the detail view in `/mcp` for tool count.
- Try disconnecting and reconnecting: detail view → `x` to disconnect → `x` again to connect.

### Context and performance

**Model seems to "forget" things from earlier:**
- Check context usage with `/stats` or the status bar. If above 80%, run `/compact` to free space.
- The model has limited working memory. Older conversation turns get compacted automatically, preserving key facts but losing detail.

**Slow responses:**
- Check `/stats` for tokens/second. If low, the model endpoint may be overloaded.
- Local models are CPU-bound without GPU. A 7B model needs ~8GB VRAM for reasonable speed.
- Large files in context slow everything down. Use the summarizer (files above `summarizeThreshold` get auto-summarized).

**"Context limit exceeded":**
- The model's context window is full. Run `/compact` or switch to a model with a larger `contextLimit`.
- The router automatically escalates to denser models when context fills up, but only if a larger model is configured.

### Git and workspace

**"Not a git repository":**
- VoidRift works without git, but checkpointing and `/rewind` require it. Initialize with `git init` if needed.
- Subagent isolation (worktrees) requires git.

**Unexpected file changes:**
- Use `/diff` to see what changed. Use `/rewind` to roll back to a previous turn.
- In Vibe mode, the model writes without asking. Switch to Chat mode if you want approval on changes.

### Getting help

- `/help` — built-in interactive guide
- [FEATURES.md](./docs/FEATURES.md) — full technical reference
- [GitHub Issues](https://github.com/TylerJPresley/voidrift/issues) — bug reports and feature requests

## Further Reading

- [FEATURES.md](./docs/FEATURES.md) — Complete technical reference (commands, tools, configuration, permissions)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System design, subsystems, data flow
- [PATTERNS.md](./docs/PATTERNS.md) — Clean Architecture patterns, repository pattern, testing practices
- [PLUGINS.md](./docs/PLUGINS.md) — Plugin development guide (CoreAPI, events, panels, agents)
- [VS Code Extension](https://github.com/TylerJPresley/voidrift-vscode) — Native VS Code frontend (same engine, different UI)

## Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for details on our development setup, testing, and pull request guidelines.

## Code of Conduct

We expect all participants in our community to adhere to our [CODE_OF_CONDUCT.md](./docs/CODE_OF_CONDUCT.md) to foster a respectful and welcoming environment.

## Security

If you discover any security vulnerabilities, please refer to our [SECURITY.md](./docs/SECURITY.md) policy for instructions on reporting them privately.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
