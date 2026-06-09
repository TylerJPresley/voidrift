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

### Command Details

---

#### `/help` — Interactive Help

**Intent:** Give new and experienced users immediate access to the system's capabilities without leaving the terminal.

**Why it matters:** VoidRift has a lot of surface area — modes, tools, context layers, hotkeys. Without a built-in reference, users would have to context-switch to external docs. The help panel keeps you in flow.

**Walkthrough:**

1. Type `/help` and press Enter
2. The help panel opens with four pages:
   - **general** — Version, workspace path, session ID
   - **commands** — Every registered slash command (core + plugin)
   - **shortcuts** — All keyboard bindings organized by context
   - **context** — Detailed explanation of the 4-layer context architecture with what each sublayer contains
3. Press `←` / `→` to navigate between pages
4. Press `esc` to close

The commands page also shows plugin-contributed commands in a separate section, so you can see what extensions have added.

---

#### `/plan` — Task Planning

**Intent:** Let you and the model collaborate on structured task breakdowns that persist across sessions and guide autonomous work.

**Why it matters:** Without a plan, conversations are ephemeral — the model forgets what you agreed to do. Plans create a persistent roadmap. When the model has an active plan in context, it works systematically instead of ad-hoc. Plans are also the input for `/goal` autonomous execution.

**Walkthrough:**

1. Type `/plan` to open the plan panel
2. The panel shows three priority pages: **now** (immediate), **next** (upcoming), **later** (backlog)
3. Navigate with `←` / `→` between priority pages
4. Use `↑` / `↓` to select items on the current page
5. Press `enter` to open the detail view showing the full body of the plan item
6. Reprioritize items directly:
   - `n` — move item to "now"
   - `x` — move item to "next"
   - `l` — move item to "later"
7. Press `del` then `y` to remove an item permanently
8. In detail view, press `e` to open the item in your configured editor

**Storage:** `.voidrift/plan/{name}.md` — each item is a markdown file with YAML frontmatter (priority, description, rationale) and a body containing detailed implementation notes.

**Model integration:** The model has `read_plan`, `write_plan`, and `update_plan` tools. It can create items, change priorities, and update bodies as it works. This means you can say "plan out the refactor" and it produces structured items you can review and reprioritize.

---

#### `/memory` — Persistent Knowledge

**Intent:** Let the model learn facts, preferences, and directives that survive across sessions. Memories are indexed and selectively loaded into context when relevant.

**Why it matters:** Without memory, every new session starts from zero. You'd repeat "use tabs not spaces" or "the database is Postgres 15" every time. Memory lets the model accumulate project knowledge and personal preferences that compound over time.

**Walkthrough:**

1. Type `/memory` to open the memory panel
2. You'll see all indexed memories with their titles and summaries
3. Navigate with `↑` / `↓`
4. Items marked `[LOADED]` are currently active in the model's context
5. Press `l` to load a memory into active context (model can see it this session)
6. Press `u` to unload (removes from active context but keeps the memory stored)
7. Press `esc` to close

**How memories are created:** The model has a `save_memory` tool. When it discovers something important about your project or preferences, it can save it. You can also ask directly: "Remember that we use ESM imports only."

**Scopes:**
- **Local** (`.voidrift/memory/`) — project-specific knowledge (tech stack, architecture decisions, naming conventions)
- **Global** (`~/.config/voidrift/memory/`) — personal preferences that apply everywhere (coding style, communication preferences)

**Loading behavior:** The model always sees a lightweight index of all memories (title + summary). It loads full bodies on demand when they're relevant to the current task.

---

#### `/skills` — Domain Knowledge Registry

**Intent:** Manage skill files that inject domain-specific expertise and guidelines into the model's context. Skills are triggered automatically based on what you're working on.

**Why it matters:** A general model doesn't know your team's patterns, your framework's conventions, or your project's architecture rules. Skills encode that knowledge. When you open a React file, the React skill loads automatically — the model immediately knows your component patterns, hook conventions, and testing approach.

**Walkthrough:**

1. Type `/skills` to open the skills panel
2. You'll see all skill files with their name, location (workspace/global), and validation status
3. Skills marked `[X]` in red have validation issues (missing frontmatter fields, referencing non-existent agents)
4. Navigate with `↑` / `↓`
5. Press `enter` to open a skill in your editor for modification
6. Press `c` to create a new skill:
   - Choose scope: `w` for workspace (this project only) or `g` for global (all projects)
   - Type a skill ID (lowercase, hyphens only)
   - The skeleton file is created and opened in your editor
7. Press `r` to rename a skill
8. Press `del` then `y` to delete

**Skill file format:**

```markdown
---
name: "react-patterns"
description: "React component and hook conventions"
triggers:
  extensions: [".tsx", ".jsx"]
  files: ["package.json"]
  keywords: ["component", "hook", "useEffect"]
agents: ["chat", "vibe"]
active: true
---

## Component Rules
- Functional components only, no class components
- Props interfaces named {Component}Props
...
```

**Trigger system:** Skills load when:
- You focus a file matching an extension trigger
- The workspace contains a file matching a filename trigger
- Your input contains a keyword trigger
- The skill is bound to the active agent

**Locations:**
- Workspace: `.voidrift/skills/` — project-specific (checked into git)
- Global: `~/.config/voidrift/skills/` — personal preferences across projects

---

#### `/agents` — Agent Configuration

**Intent:** View, create, and customize the agents (personas) that the model operates as. Each agent has different tools, permissions, model tiers, and behavioral instructions.

**Why it matters:** Different tasks need different personas. A code reviewer shouldn't have write access. A task agent should use the cheap model. A planning agent should think carefully without touching files. Agents let you define WHO the model is for each context.

**Walkthrough:**

1. Type `/agents` to open the agents panel
2. Four pages (navigate with `←` / `→`):
   - **core interactive** — Built-in user-facing agents (chat, plan, vibe)
   - **core task** — Built-in background agents
   - **custom interactive** — Your custom user-facing agents
   - **custom task** — Your custom background agents
3. Navigate with `↑` / `↓`, press `enter` for detail view
4. Detail view shows a cascade override system (like prompts/templates):
   - **Default** — built-in behavior
   - **Global** — `~/.config/voidrift/agents/{id}/`
   - **Workspace** — `.voidrift/agents/{id}/`
5. Press `enter` on a level to open/create an override file
6. On custom pages: `c` create, `r` rename, `del` delete (y/n confirm)

**Override system:** Each agent has two files:
- `agent.json` — Configuration (model tier, tools, approval mode, type)
- `prompt.md` — Identity/persona instructions

Workspace overrides take precedence over global, which takes precedence over defaults. This means you can make the chat agent more aggressive for one project without affecting others.

---

#### `/mcp` — MCP Server Management

**Intent:** Add, connect, authenticate with, and manage Model Context Protocol servers that extend the model's capabilities with external tools.

**Why it matters:** MCP turns VoidRift into a universal client. Research databases, deployment tools, monitoring systems, internal APIs — anything with an MCP server becomes a tool the model can call. You go from "model that reads files" to "model that can search papers, deploy code, and query your database."

**Walkthrough — Adding a server:**

1. Type `/mcp` to open the MCP panel
2. Press `c` to create a new server
3. Choose scope: `w` (workspace — shared with team) or `g` (global — personal)
4. Enter a server ID (e.g., `research`, `deploy-prod`)
5. Paste the server URL (e.g., `https://mcp.example.com/mcp`)
6. VoidRift auto-discovers the server:
   - Probes the URL for MCP capabilities
   - Checks `.well-known/mcp` for metadata
   - Detects OAuth requirements
   - Generates the config file automatically
7. If auth is required, the panel shows a message. Press `o` to authenticate.

**Walkthrough — Connecting:**

1. In the server list, select a server and press `enter` for details
2. Press `x` to connect (or disconnect if already connected)
3. On connection, tools are registered and immediately available to the model
4. Tool count appears in the detail view

**Detail view hotkeys:**
- `x` — Connect / disconnect
- `o` — Run OAuth flow (opens browser for authentication)
- `e` — Open config file in editor
- `a` — Toggle auto-connect (whether to connect on startup)
- `esc` — Back to list

**List view hotkeys:**
- `↑↓` — Navigate
- `enter` — Detail view
- `c` — Create new server
- `del` then `y` — Delete server and its config

**Auto-connect:** Servers with `autoConnect: true` (the default) connect automatically when VoidRift starts. Disable for servers you only use occasionally.

---

#### `/templates` — Template Manager

**Intent:** View and manage reusable templates that structure the model's output and behavior. Templates use a cascade override system so you can customize core behavior per-project.

**Why it matters:** Templates let you standardize output formats without repeating instructions. A PR description template, a commit message format, a code review checklist — define once, use everywhere. The cascade system means you can override core templates for specific projects without affecting your global setup.

**Walkthrough:**

1. Type `/templates` to open the templates panel
2. Two pages (navigate with `←` / `→`):
   - **system** — Core templates (persona formatting, output structure)
   - **custom** — User-created templates
3. On the system page:
   - Navigate with `↑` / `↓`
   - Press `enter` to see the override cascade (default → global → workspace)
   - Select a level and press `enter` to view (default) or open/create an override (global/workspace)
4. On the custom page:
   - Navigate, press `enter` to open in editor
   - `c` — Create new template (scope: workspace/global)
   - `r` — Rename
   - `del` — Delete

**Override cascade:** When VoidRift resolves a template, it checks:
1. `.voidrift/templates/{key}.md` (workspace — highest priority)
2. `~/.config/voidrift/templates/{key}.md` (global)
3. Built-in default (lowest priority)

The panel shows which level is currently "active" for each template.

---

#### `/prompts` — System Prompt Manager

**Intent:** View and override the system prompts that define HOW the model behaves — its rules, tool usage patterns, and persona instructions.

**Why it matters:** The system prompt is the single biggest lever for model behavior. If the model is too verbose, not using the right tools, or ignoring conventions — the fix is usually a prompt override. This panel exposes every prompt section so you can tune behavior without modifying source code.

**Walkthrough:**

1. Type `/prompts` to open the prompts panel
2. You'll see all registered prompt sections in a table:
   - **Label** — Human-readable name
   - **Source** — Who registered it (core, plugin name)
   - **Override** — Where the active content comes from (default/global/workspace)
   - **Description** — What this prompt section does
3. Navigate with `↑` / `↓` and press `enter` for detail view
4. Detail view shows the cascade (like templates):
   - **Default** — press `enter` to view the built-in content (opens read-only in editor)
   - **Global** — press `enter` to open/create `~/.config/voidrift/prompts/{key}.md`
   - **Workspace** — press `enter` to open/create `.voidrift/prompts/{key}.md`

**Key prompt sections:**

| Key | What it controls |
|-----|-----------------|
| `core.context-guide` | Teaches the model about the 4-layer context system |
| `core.rules` | Behavioral rules (retry limits, conciseness, verification) |
| `core.tool-usage` | When and how to use each tool |
| `chat` | Chat agent identity and expertise |
| `plan` | Plan agent identity (read-only architect) |
| `vibe` | Vibe agent identity (autonomous executor) |

**Override cascade:** workspace → global → builtin (same as templates).

---

#### `/model` — Model Selection

**Intent:** Switch the active model or assign models to tiers (flash/utility/dense). Controls which model handles your requests and how the automatic router behaves.

**Why it matters:** Different models have different tradeoffs. A local 7B model is instant and free but less capable. Claude Opus is powerful but expensive and slow. The tier system lets you use cheap models for simple tasks and expensive ones for complex reasoning — automatically. This command gives you manual control when the router's choice isn't right.

**Walkthrough:**

**Quick switch:** `/model claude-sonnet` — immediately switches the active model.

**Panel mode:** `/model` (no arguments) opens the full panel:

1. See all configured models with their current tier assignments
2. The currently active model shows a `✓` prefix
3. Tier assignments shown as `[f]`, `[u]`, `[d]` (flash/utility/dense)
4. Navigate with `↑` / `↓`
5. Press `enter` to select a model as active for the current agent
6. Press `d` to assign the selected model to the **dense** tier
7. Press `u` to assign to the **utility** tier
8. Press `f` to assign to the **flash** tier

**Auto mode:** Select "auto" to let the three-tier router decide per-turn based on input complexity and context usage. The router escalates to denser models when context fills up (>85%), and de-escalates after compaction (<50%).

Tier assignments persist to `~/.config/voidrift/config.json`.

---

#### `/context` — Context Visualizer

**Intent:** Show exactly what's in the model's context window — every layer, every component, with token counts and visual representation.

**Why it matters:** Context is your most limited resource. When the model seems to "forget" things or behaves strangely, it's usually a context issue — either something important isn't loaded, or junk is consuming budget. This visualizer lets you diagnose exactly what's happening inside the prompt.

**Walkthrough:**

1. Type `/context` to open the context panel
2. Five pages (navigate with `←` / `→`):

**Overview page:**
- Shows all four layers with token counts and percentages
- Each layer has a visual grid (colored blocks representing token allocation)
- Legend maps symbols to content types (persona, tools, skills, etc.)
- Shows total usage: `model-name · 12.5k/32k (39.1%) Free: 19.5k`

**Agent page:**
- Lists all bound tools with descriptions
- Shows bound skills content
- Displays the full persona prompt
- Scrollable with `↑` / `↓`

**Orbit page:**
- Active skills (triggered by current work)
- Loaded memories
- Active plan content

**Drift page:**
- Git status (clean/modified)
- File map stats (total files, active count)
- Active files highlighted at top with path and line counts
- Remaining workspace files listed below

**Void page:**
- Last 10 messages (role + content preview)
- Tool result token counts
- Active diagnostics

---

#### `/stats` — Session Analytics

**Intent:** Show performance metrics for the current session — how many tokens you've used, which models handled which turns, and how fast they responded.

**Why it matters:** Token usage directly correlates with cost (for cloud models) and latency. If your session feels slow, stats tells you whether it's the model, the tools, or the context size. It also helps you understand your usage patterns for model selection.

**Walkthrough:**

1. Type `/stats` to open the stats panel
2. Sections shown:
   - **Session** — ID, duration, total turns
   - **Performance** — Wall time, total tool execution time
   - **Tools** — Call count, success/failure ratio, success rate percentage
   - **Model Usage** — Table with per-model breakdown:
     - Model name, turns handled, input tokens, output tokens, tokens/second
   - **Context** — Current budget usage with color indicator (green <50%, yellow <80%, red >80%)

---

#### `/resume` — Session Browser

**Intent:** Browse and resume previous conversations. Picks up where you left off with full history restored.

**Why it matters:** Real work spans multiple sessions. You start a refactor, take a break, come back the next day. Resume lets you continue without re-explaining context. The model gets the full conversation history back, so it remembers what was decided and what was done.

**Walkthrough:**

1. Type `/resume` to open the session browser
2. Sessions are listed newest-first with:
   - Session ID (first 8 chars), current session marked with `●`
   - Turn count
   - Last activity (relative time: "5m ago", "2h ago", "3d ago")
   - Last user message (first 60 chars)
3. Navigate with `↑` / `↓`
4. Press `enter` to resume — conversation history is restored and you continue where you left off

**Storage:** Sessions are saved in `.voidrift/sessions/{id}/` with:
- `system.metadata.json` — session config and stats
- `system.turns.json` — turn timestamps
- `work.messages.json` — full conversation history

---

#### `/rewind` — Turn Rollback

**Intent:** Undo the model's last action(s) by rolling back to an earlier turn. The git checkpoint system ensures file changes are also reverted.

**Why it matters:** The model makes mistakes. It might edit the wrong file, produce broken code, or go down a wrong path. Instead of manually undoing changes, rewind restores both the conversation AND the workspace to an earlier state.

**Walkthrough:**

**Quick rewind:** `/rewind 5` — immediately rolls back to turn 5.

**Panel mode:** `/rewind` (no number) opens a selector:

1. See all turns listed (most recent at top)
2. Navigate with `↑` / `↓`
3. Press `enter` to rewind to the selected turn
4. Conversation history is truncated to that point
5. Git checkpoint is rolled back (file changes after that turn are undone)

---

#### `/diff` — Code Changes Viewer

**Intent:** See all uncommitted changes in the workspace with syntax-colored output — additions in green, deletions in red.

**Why it matters:** When the model edits files, you need to verify what changed. The diff panel shows the full `git diff` inline without switching terminals. It's your verification step before committing or continuing.

**Walkthrough:**

1. Type `/diff` to open the diff panel
2. Shows `git diff --no-color` output with syntax coloring:
   - Green: additions
   - Red: deletions
   - Cyan: hunk headers (`@@`)
3. Scroll with `↑` / `↓` (and page up/down for large diffs)
4. Shows "No uncommitted changes" if workspace is clean
5. Press `esc` to close

---

#### `/goal` — Autonomous Execution

**Intent:** Give the model a high-level objective and let it work independently until completion. Uses the dense (most capable) model and runs in a loop — thinking, acting, verifying, iterating.

**Why it matters:** Some tasks are well-defined enough that you don't need to supervise every step. "Write tests for all the util functions" or "refactor this module to use async/await" — these are mechanical tasks where the model can self-direct. Goal mode lets you delegate and come back to results.

**Walkthrough:**

1. Type `/goal refactor src/auth to use JWT tokens`
2. VoidRift:
   - Acknowledges the goal
   - Switches to the dense model (most capable)
   - Enters an autonomous loop:
     - Read relevant files
     - Plan approach
     - Make changes
     - Run tests/builds to verify
     - Fix issues
     - Repeat until satisfied
3. Progress updates appear as `[Goal Status]` messages
4. On completion: reports success/failure, turns used, and termination reason

**Termination conditions:**
- Model declares the goal complete
- Token budget exhausted
- Error count exceeds threshold
- User cancels with `esc`

**Note:** In Chat mode, goal execution still respects the permission gate — you'll approve file writes and commands. In Vibe mode, it runs fully autonomous.

---

#### `/schedule` — Timed Tasks

**Intent:** Schedule one-shot or recurring tasks that execute automatically after a delay or on a cron pattern.

**Why it matters:** Some workflows need time-based triggers. "Run tests in 5 minutes after this build finishes." "Check deployment status every 30 minutes." Schedule lets you set up automation without external tools.

**Walkthrough:**

**One-shot delay:**
```
/schedule --delay 5m "run the test suite and report results"
```
Executes the instruction once after 5 minutes.

**Recurring cron:**
```
/schedule */30 * * * * "check if the build passed on CI"
```
Executes every 30 minutes until cancelled.

**Delay format:** `30s`, `5m`, `1h`, `2h30m`

**Viewing tasks:** Type `/tasks` to see all scheduled and active background tasks.

---

#### `/tasks` — Background Task Monitor

**Intent:** View all active background tasks — scheduled timers, running subagents, and their status.

**Why it matters:** When you have autonomous work running (goal loops, scheduled tasks, subagents), you need visibility into what's happening. This panel shows what's running, what's pending, and what completed.

**Walkthrough:**

1. Type `/tasks` to open the task monitor
2. Each task shows:
   - Status indicator (green = active, grey = completed/pending)
   - Task ID
   - Type (delay, cron, subagent)
   - Instruction text
   - Current status
3. Press `esc` to close

---

#### `/compact` — History Compaction

**Intent:** Compress conversation history to free up context budget when you're running low on tokens.

**Why it matters:** Long conversations consume context. When you hit 80%+ usage, the model starts losing access to earlier context and may behave erratically. Compaction summarizes older messages into a condensed form, preserving key decisions and facts while freeing budget for new work.

**Walkthrough:**

1. Type `/compact`
2. VoidRift analyzes the conversation:
   - If compactable: "Compacted: 48 → 12 messages"
   - If not needed: "Nothing to compact."
3. Older messages are summarized, recent ones preserved verbatim
4. The model retains awareness of what was discussed but with less detail on old turns

**When to use:** When `/stats` or the status bar shows context above 70%. Or when the model starts "forgetting" things from earlier in the conversation.

---

#### `/tools` — Tool Inspector

**Intent:** Browse all tools available to the current agent with full parameter documentation and approval requirements.

**Why it matters:** You need to know what the model can do and what requires your approval. The tools panel shows exactly which capabilities are loaded, whether they auto-approve or gate, and what parameters each tool accepts.

**Walkthrough:**

1. Type `/tools` to open the tools panel
2. Two pages (navigate with `←` / `→`):
   - **core** — Built-in tools (file ops, shell, web, planning, memory, LSP)
   - **mcp** — Tools from connected MCP servers
3. Each tool shows:
   - Lock icon (🔒 = requires approval, ✓ = auto-approved)
   - Name and description
4. Navigate with `↑` / `↓`, press `enter` for detail view
5. Detail view shows:
   - Full name, description, approval status
   - Parameters table: name, type, required/optional, description

---

#### `/policy` — Security Policy Manager

**Intent:** View and manage persistent security rules that pre-approve or pre-deny specific tool calls. Rules survive sessions (unlike trust decisions from the confirmation dialog which are session-only).

**Why it matters:** If you always want `npm test` approved without asking, or always want `rm -rf` denied, policy rules encode that permanently. They reduce confirmation fatigue for repetitive workflows while maintaining security for dangerous operations.

**Walkthrough:**

**View rules:** `/policy` opens a panel showing all active rules with their source, tool, pattern, decision, and priority.

**Add a rule:**
```
/policy add allow execute_command 'npm *'
/policy add allow execute_command 'git status'
/policy add deny execute_command 'rm -rf *'
/policy add allow edit_file 'src/**'
```

**Rule format:** `/policy add <allow|deny> <tool_name> <pattern>`

**Pattern matching:**
- `*` matches anything in that position
- File patterns: `src/utils/**` matches all files under src/utils/
- Command patterns: `npm *` matches any npm command

**Storage:** `.voidrift/policies.json` (workspace) — check into git to share with your team. Global rules go in `~/.config/voidrift/policies.json`.

**Priority:** Workspace rules override global rules. More specific patterns override broader ones.

---

#### `/history` — Audit Log

**Intent:** View a chronological record of every action taken during the session — tool calls, approvals, denials, errors, and system events.

**Why it matters:** Accountability and debugging. When something goes wrong, the audit log tells you exactly what happened and when. It's also useful for understanding the model's decision-making process — what tools it tried, what was approved, what failed.

**Walkthrough:**

1. Type `/history` to open the audit log
2. Events listed chronologically with timestamps
3. Each entry shows:
   - Timestamp
   - Event type (tool call, approval, denial, error, etc.)
   - Details (tool name, arguments, result)
4. Scroll with `↑` / `↓`
5. Press `esc` to close

---

#### `/plugins` — Plugin Manager

**Intent:** View installed plugins and their contributions to the system (commands, agents, prompts, panels).

**Why it matters:** As you add plugins, you need to know what they've registered and whether they're active. This panel gives visibility into the plugin ecosystem.

**Walkthrough:**

1. Type `/plugins` to open the plugin panel
2. Lists all discovered plugins with:
   - Name, version, author
   - License
   - Contributed commands, agents, modes
   - Active/inactive status

See [PLUGINS.md](./PLUGINS.md) for the full plugin development guide.

---

#### `/clear` — Reset Session

**Intent:** Wipe the conversation history and focused files. Starts fresh without exiting.

**Why it matters:** Sometimes a conversation goes off the rails and it's faster to start over than to fix the context. Clear gives you a blank slate within the same session.

**Walkthrough:** Type `/clear`. History is emptied, focused files are cleared. The model forgets everything from this session (but memories and plans persist since they're stored on disk).

---

#### `/exit` — Save and Quit

**Intent:** Save the current session state and exit VoidRift cleanly.

**Why it matters:** Sessions are auto-saved periodically, but `/exit` ensures a clean save point. You can resume this session later with `/resume`.

**Walkthrough:** Type `/exit`. Session is saved to `.voidrift/sessions/{id}/`. VoidRift exits.

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
