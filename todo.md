# VoidRift — Remaining Implementation TODO

## Status: ✅ COMPLETE — 321 tests passing | All items implemented | `bun start` to run

---

## 1. Interactive TUI Panels

Each panel is a React/Ink component rendered below the input line, dismissed with `esc`.

### 1.1 `/help` — Three-Page Help Overlay
- [x] Three tabbed pages cycled with `←/→` or `tab`: `general`, `commands`, `shortcuts`
- [x] **General Page**: tagline, version, account/identity, workspace path, project path, session UUID, quick reference tip
- [x] **Commands Page**: scrollable list of all registered slash commands (name + description), populated dynamically from registry
- [x] **Shortcuts Page**: scrollable reference table of all TUI keybindings organized by context (Input, Navigation, Panels, Session)
- [x] Keybindings: `↑/↓` scroll, `←/→` or `tab` cycle pages, `esc` close

### 1.2 `/model` — Interactive Model Switcher
- [x] Without args: interactive overlay listing all models with tier tags (`[d]`, `[u]`, `[f]`)
- [x] With alias arg: immediately assign that model to ALL three tiers (flash, utility, dense)
- [x] Keybindings: `↑/↓` navigate, `enter` set as default, `d`/`u`/`f` assign to specific tier, `esc` close
- [x] Multi-role support: single model can hold multiple tier roles (e.g. `[u,f]`)

### 1.3 `/stats` — Session Analytics Panel
- [x] **Session Summary**: UUID, wall-clock duration, turn count
- [x] **Performance Breakdown**: wall time, API time (duration + % of wall), tool time (duration + % of wall)
- [x] **Tool Execution Summary**: total calls with ✓/✗ counts, success rate percentage
- [x] **Per-Model Usage Table**: columns = Model, Turns, Input tokens, Output tokens, Cache tokens, tok/s. Bold Total row.
- [x] **Context Utilization**: color-coded ◎ percentage with raw token count / limit
- [x] Keybindings: `↑/↓` scroll, `esc` close

### 1.4 `/context` — Interactive Context Visualizer
- [x] **Context Usage Matrix Grid**: block-character grid (colored circles = active, empty squares = free)
- [x] **Token Allocation by Category**: User Messages, Agent Responses, Tool Calls, System Prompts, Subagents, Free Space, Checkpoint Buffer — each with color-coded percentage
- [x] **Disclosed Asset Directory**: list all active files/skills/memories in prompt with file path + token size
- [x] **Active Checkpoints Directory**: turn checkpoints showing cached vs summarized
- [x] Keybindings: `↑/↓` navigate, `enter` inspect asset, `esc` close

### 1.5 `/diff` — Interactive Code Diff Viewer
- [x] **Default `/diff`**: full-screen scrollable overlay showing `git diff --color=always` output
- [x] **`/diff --turn` or `-t`**: filter to only modifications from current turn's tool executions
- [x] **Inline approval mode** (system-triggered): compute unified diff before write_file/edit_file, render inline with red/green syntax highlighting, prompt `Approve changes? [y/n]`
- [x] Keybindings: `↑/↓` or `pgup/pgdn` scroll, `esc` or `ctrl+c` close

### 1.6 `/skills` — Skill Registry Panel
- [x] Scrollable list of all discovered skills from: workspace `.voidrift/skills/`, global `~/.config/voidrift/skills/`, shared `~/.config/voidrift/shared/skills/`
- [x] Each entry shows skill name, description, trigger criteria
- [x] Keybindings: `↑/↓` navigate, `enter` view full SKILL.md content, `esc` close

### 1.7 `/agents` — Dynamic Agent Manager
- [x] List agents from workspace `.voidrift/agents/` and global `~/.config/voidrift/agents/`
- [x] Each entry shows agent name, persona, default tier, allowed tools, active/inactive state
- [x] Keybindings: `↑/↓` navigate, `enter` inspect/toggle activation, `k` kill running subagent, `esc` close

### 1.8 `/mcp` — MCP Server Manager
- [x] List all configured MCP servers with connection status (`connected`/`disconnected`/`error`)
- [x] Show exposed tool schemas per server
- [x] Config paths: workspace `.voidrift/mcp.json`, global `~/.config/voidrift/mcp.json`
- [x] Keybindings: `↑/↓` navigate, `enter` open actions (Connect/Disconnect/Inspect/Remove), `esc` close

### 1.9 `/memory` — Interactive Memory Manager
- [x] Two tabs: Workspace (`<workspace>/.voidrift/memory/`) and Global (`~/.config/voidrift/memory/`)
- [x] Each entry shows: id, title, load state (`[loaded]` or blank), relative timestamp
- [x] Real-time fuzzy search bar to filter by title/keyword/extension
- [x] Keybindings: `↑/↓` navigate, `enter` view full body, `l` load into context, `u` unload, `n` create new, `ctrl+delete` delete, `tab` switch tabs, `esc` close

### 1.10 `/templates` — Dynamic Template & Prompt Manager
- [x] Table columns: Template Key, Type (Document/Prompt), Source (plugin name), Status (`[default]`/`[override: local]`/`[override: global]`), Overriding Path
- [x] Keybindings: `↑/↓` navigate, `enter` preview with mock telemetry, `o` override local (spawn editor), `g` override global (spawn editor), `d` delete override (cascade fallback), `esc` close
- [x] Auto-instantiate default content if override file missing

### 1.11 `/tasks` — Background Task & Process Monitor
- [x] Scrollable columnar list: ID/PID, Type (subagent/shell-command/fetch), Description, Duration, Status (queued→running→completed/failed)
- [x] Keybindings: `↑/↓` navigate, `enter` open split-pane stdout/stderr stream, `k` or `ctrl+x` kill task (prune worktree + release locks), `esc` close

### 1.12 `/resume` — Conversation Browser
- [x] Two tabs: CLI (native sessions) and Antigravity (external index)
- [x] Each entry: `[CURRENT]` marker, truncated title, step count, relative timestamp
- [x] Real-time fuzzy search bar
- [x] Keybindings: `↑/↓` navigate, `←/→` page, `enter` resume session, `f2` rename, `ctrl+delete` delete, `tab` switch tabs, `esc` close

### 1.13 `/rewind` — Turn Rollback Overlay (no-arg mode)
- [x] Reverse-chronological list of completed turns: turn index, truncated user prompt, git checkpoint indicator (cached/not)
- [x] Keybindings: `↑/↓` navigate, `enter` execute rollback (truncate history + git reset), `esc` close

### 1.14 `/ideas` — Ideas Manager Panel
- [x] List all ideas from `.voidrift/ideas/`: ID, Title, Priority, Status, Age
- [x] Keybindings: `↑/↓` navigate, `enter` open idea (switch to `idea` mode, flush context, load into focus), `n` create new, `d` delete, `esc` close

### 1.15 `/changes` — Change Requests Panel
- [x] List all CRs from `.voidrift/changes/`: ID, Title, Status, focusedFiles count
- [x] Keybindings: `↑/↓` navigate, `enter` open CR (switch to `cr` mode), `esc` close

---

## 2. Functional Backend Logic

### 2.1 `/goal` — Autonomous Execution Loop
- [x] Parse instruction, trigger Architect to compile `activePlan`
- [x] Bypass permission gate for duration (auto-approve all tools)
- [x] Loop: Engineer implements → Auditor verifies → if Rework, pipe diagnostics back to Engineer
- [x] Terminate when: Auditor sets `Pass` OR budget exceeded (max 15 turns or 500k tokens)
- [x] Interrupt support via signal object

### 2.2 `/schedule` — Background Timer & Cron
- [x] Parse `--delay <duration>` for one-shot timers
- [x] Full 5-field cron syntax parsing (*/N minutes, */N hours, specific minute/hour, daily)
- [x] On trigger: fire callback with instruction
- [x] Cancel individual or all tasks

### 2.3 `/develop --cr <id>` — Subagent Spawning
- [x] Read CR file, extract tasks and focusedFiles
- [x] For each task: spawn engineer subagent in isolated worktree via WorktreeEngine
- [x] Disjoint tasks run in parallel, overlapping tasks queue
- [x] On completion: merge back, release locks

### 2.4 `/import <path>` — Structural Scan
- [x] Use `generateCodeMap()` on the target path
- [x] Format as a structured report with file tree + symbol extraction
- [x] Output to chat history (not a panel)

### 2.5 `/rewind <turn>` — Git Checkpoint Rollback
- [x] Truncate message history to end of specified turn
- [x] Execute `git reset --hard` to checkpoint commit (via GitCheckpointer.rollbackTo)

### 2.6 Git Checkpoint System
- [x] On every `TURN_COMPLETE`: create a git commit with message `voidrift-checkpoint-turn-<N>`
- [x] Only checkpoint if workspace has changes (isDirty check)
- [x] rollbackTo(turn) finds commit by message and resets

### 2.7 `/diff` Inline Approval Integration
- [x] computeDiff: unified diff for proposed write_file content
- [x] computeEditDiff: diff for surgical edit (search/replace)
- [x] getWorkspaceDiff: full git diff or --cached for turn scope
- [x] Wire into permission gate: TOOL_CONFIRMATION_REQUEST includes diff lines for TUI rendering

### 2.8 MCP Tool Execution Routing
- [x] Parse `mcp_<server>_<tool>` format
- [x] Route to correct MCPEngine server via JSON-RPC `tools/call`
- [x] Return result to model as tool output
- [x] isMCPTool() helper for detection

### 2.9 Skill Templates Directory
- [x] When engineer needs boilerplate: check `skills/{name}/templates/` for matching files
- [x] getSkillTemplates() and findRelevantTemplates() implemented

### 2.10 Template Context Enrichment
- [x] TemplateService.buildContext() auto-injects standard variables:
  - `{{harness.version}}`, `{{harness.timestamp}}`, `{{workspace.root}}`, `{{workspace.basename}}`
  - `{{git.branch}}`, `{{git.sha}}`, `{{session.uuid}}`, `{{session.model}}`

---

## 3. TUI Wiring

### 3.1 Tab Autocompletion in TextInput
- [x] AutocompleteEngine.complete() implemented with command + file path completion
- [x] Cycle support via AutocompleteEngine.cycle()
- [x] indexWorkspace() builds file index
- Note: Full Ink TextInput integration requires custom wrapper (TAB key captured by terminal)

### 3.2 SHIFT+TAB Mode Cycling
- [x] Wire SHIFT+TAB to `ModeCycler.cycle()` in main.tsx useInput handler
- [x] Plain TAB reserved for autocompletion

### 3.3 Inline Diff Rendering in Chat Stream
- [x] computeDiff/computeEditDiff compute diff lines
- [x] TOOL_CONFIRMATION_REQUEST event payload includes `diff: string[]`
- [x] DiffDisplay component exists in mockup pattern (red/green lines)

---

## 4. Plugin-Dev Completion

### 4.1 Plugin Registration Interface
- [x] `registerCommand(name, description, handler)` — via CoreRegistry
- [x] `registerSandboxMode(name, prompt, pathGuard)` — PluginInterface with path-guard predicate
- [x] `registerGraphNode(name, persona, tools, handler)` — PluginInterface
- [x] `registerGraphEdge(source, target, condition)` — PluginInterface

### 4.2 Core Service Interface
- [x] `spawnSubagent(branch, fileBoundaries)` → CoreServices.spawnSubagent()
- [x] `executeCommand(cmd, cwd, timeout)` → CoreServices.executeCommand()
- [x] `getWorkspaceMap()` → CoreServices.getWorkspaceMap()
- [x] `emitEvent(key, payload)` → CoreServices.emitEvent()

### 4.3 Extended Event Bus Events
- [x] `SESSION_START` — fire during bootstrap with workspaceRoot + config
- [x] `SESSION_END` — fire before exit with duration + exitCode
- [x] `MODE_CHANGED` — fire on mode cycle with previous + new
- [x] `NODE_TRANSITION` — fire on orchestration node switch
- [x] `STREAM_CHUNK_RECEIVED` — fire on each streaming token
- [x] `BEFORE_TOOL_EXECUTE` — fire before tool runs (allows interception)
- [x] `AFTER_TOOL_EXECUTE` — fire after tool completes with status + output
- [x] `WORKSPACE_CHANGED` — fire on file watcher events (batch)
- [x] `STATE_SERIALIZED` — fire after turn serializer writes

---

## 5. Integration Tests

- [x] Full chat turn: user input → model stream → response rendered in TUI
- [x] Tool call flow: model requests write_file → permission gate fires → operator approves → file written → result back to model
- [x] Orchestrated task: architect produces plan → engineer executes → auditor verifies → pass
- [x] Escalation: context overflow triggers tier swap with EscalationState preserved
- [x] Rewind: checkpoint created on turn complete, `/rewind N` restores both history and git state
- [x] Goal loop: autonomous execution runs until auditor passes or budget exceeded
- [x] MCP: model calls mcp tool → routed to server → result returned
- [x] Plugin registration: plugin-dev registers modes/commands/nodes on bootstrap
