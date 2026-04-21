# VoidRift Architecture

**Agentic Software Engineering Framework**

This document describes the component responsibilities, data flows, and key design decisions for the VoidRift framework. For requirements, see [REQUIREMENTS.md](REQUIREMENTS.md). For usage, see [README.md](README.md).

---

## 1. System Context

VoidRift orchestrates AI models to produce a deployable project from requirements. The operator runs `voidrift` on a workstation. Models run locally (vLLM), through Kiro Gateway, or against cloud APIs. All look identical to the CLI: an OpenAI-compatible or Anthropic-compatible endpoint at a URL.

```
Operator
  │
  ▼
voidrift CLI  ──reads──►  ~/.voidrift/ (config, resources, memory)
  │
  ├── HTTP ──►  Local vLLM (GPU worker node)
  ├── HTTP ──►  Kiro Gateway
  └── HTTPS ►  Cloud APIs (Anthropic, Google)
```

**External actors:** Operator (runs commands, reviews artifacts), model endpoints (receive prompts, return completions), filesystem (project directory + `~/.voidrift/`).

**System boundary:** The CLI owns orchestration, tool execution, and artifact management. It does not manage containers, SSH connections, model servers, or gateway processes. Every model is a `ModelInterface` with `(baseUrl, apiKey, modelId)` + `ProtocolAdapter`.

---

## 2. Components

### 2.1 Chat (REQ-CHAT-1 through CHAT-16)

**Responsibilities:** Interactive conversation with full tool access. Session persistence, context compaction, idea refinement, slash command dispatch, permission gating, model switching.

**Owned files:**
- `commands/chat.ts` — orchestrator: agent setup, input loop, streaming, slash command routing, prompt token tracking for auto-compact, skill usage tracking for post-compact restoration
- `commands/idea.ts` — `IdeaSession` state machine (`/idea`, `/done` flow)
- `commands/compact.ts` — `CompactCommand`: `/compact` slash command, orchestrates compaction via `ContextCompactor`, skill/file restoration post-compact
- `commands/ask.ts` — `/ask` one-shot side question
- `commands/clear.ts` — `/clear` session reset
- `commands/help.ts` — `/help` command reference
- `commands/settings.ts` — `/settings` config display/edit
- `commands/model.ts` — `/model` mid-session model switch
- `commands/base.ts` — `BaseCommand` (preflight → boot → execute → finish), `SlashCommand` (lightweight execute-only)

**State:** Chat session persisted to `.voidrift/chat-session.jsonl` (append-only JSONL with `id`/`parentId` tree). Compaction entries act as reconstruction boundaries. Permission gate is session-scoped (resets on exit). Idea state tracked in `IdeaSession` dataclass. Active mode tracked via `currentMode` string; `MODE_DEFS` maps mode names to personality prompt sections, skill sets, and steering messages. `rebuildGovernance()` rebuilds the system prompt on mode switch (REQ-CHAT-15). `frozenMessages` and `isBare` track bare mode state; `switchMode()` handles bare→mode transitions (REQ-CHAT-6). `ChatContext.restoreMode` callback restores the previous mode when `/done` exits idea flow (REQ-CHAT-11).

**Slash command → framework command integration (CHAT-2, CHAT-16):** Framework commands (`runGather`, `runPlan`, `runDevelop`, `runVerify`, `runDeploy`) accept an optional `onProgress?: (msg: string) => void` callback. When provided (chat mode), progress routes through the callback to `content.addSystem()`. When absent (headless mode), messages go to `process.stderr.write`. The `wrapCommand` harness in `base.ts` manages `footer.setMode()` and `input.setBusy()` around execution. All pipeline execution routes through `handleExec()` which dispatches via `EXEC_COMMANDS` map. `/gather`, `/plan`, `/develop`, `/verify`, `/deploy` delegate to `handleExec` for pipeline args; bare `/gather` and `/plan` are mode switches (CHAT-15).

### 2.2 Gather (REQ-G-1 through G-5)

**Responsibilities:** Reverse-engineer requirements from existing codebases or refined ideas. Four-stage pipeline: triage, context build, source analysis, consolidation.

**Owned files:**
- `commands/gather.ts` — `runGather`, `runTriage`, `runFileAnalysis`, `runGeneratedAnalysis`, `runConsolidation`, cache helpers

**State:** Analysis cache in `.voidrift/analysis/` (hash-based, per-file markdown with YAML frontmatter). Produces `REQUIREMENTS.md` and `ANALYSIS.md`.

### 2.3 Plan (REQ-P-1 through P-8)

**Responsibilities:** Generate architecture, module designs, and task breakdown from requirements. Six-stage pipeline with optional delta analysis for update mode.

**Owned files:**
- `commands/plan.ts` — six-stage pipeline: architecture, module arch, task outline, dependency resolution, task files, README

**State:** Produces `ARCHITECTURE.md`, `arch/<module>.md`, `tasks/manifest.yml`, `tasks/active/TASK-*.md`, `README.md`. Intermediate outlines in `tasks/outline/` are removed after processing. Post-processing runs `buildTaskFiles` (manifest), `checkReqCoverage` (uncovered REQ warnings), `validateTaskACs` (AC scope and specificity warnings), and `validateTaskSelfContainment` (required sections, no shell commands, no `.voidrift/` paths).

### 2.4 Develop (REQ-D-1 through D-13)

**Responsibilities:** Execute tasks from manifest. Each task gets a fresh agent. Concurrent dispatch up to model concurrency limit. Escalation to architect model on failure. Pre-write snapshots for atomicity.

**Owned files:**
- `commands/develop.ts` — dispatch loop, locking, escalation, git context injection, progress display
- `commands/progress.ts` — per-agent elapsed time tracking and stats formatting for all lifecycle commands
- `commands/status-line.ts` — single-task status line

**State:** `.develop.lock` prevents concurrent develop sessions. Checkpoints persisted to `.voidrift/checkpoints.jsonl`. Diff stats computed per task from pre-write snapshots. Git diff warning when writes produce no actual changes (REQ-D-4). Read-before-write enforcement via `beforeToolCall` hook — existing files must be read before write/edit (REQ-D-13).

### 2.5 Verify (REQ-VF-1 through VF-3)

**Responsibilities:** Three-stage requirements-driven acceptance testing. Stage 0: doc verification agent (verify-doc tools: file read/write/list) checks README/ARCHITECTURE against source, writes `bugs/DOC-N.md`. Stage 1: plan agent writes test cases. Stage 2: concurrent sub-agents execute them.

**Owned files:**
- `commands/verify.ts` — plan agent, concurrent sub-agent dispatch, report generation

**State:** Produces `VERIFY-PLAN.md`, `VERIFY.md`, `bugs/<ITEM-ID>.md`. Never modifies source files.

### 2.6 Deploy (REQ-DPL-1 through DPL-5)

**Responsibilities:** Version bump determination, changelog generation, git tagging, optional IaC generation, post-deploy hooks.

**Owned files:**
- `commands/deploy.ts` — version bump, changelog, git tag, conditional IaC, post-deploy hook

**State:** Reads `tasks/history.log` for changelog. Creates annotated git tag. Rotates `history.log` to `history-<version>.log` on success.

### 2.7 Utilities (REQ-UTIL-1 through UTIL-9)

**Responsibilities:** Status display, log viewing, pruning, unlock, rollback, diagnostics, skills management, memory management, shell completions.

**Owned files:**
- `commands/status.ts` — command completion (artifact checks), task counts by lifecycle status, idea count
- `commands/log.ts` — project/global log viewing, command section extraction, follow, prune
- `commands/unlock.ts` — remove develop lock, kill running process
- `commands/prune.ts` — project log/cache pruning, `--all` removes `.voidrift/`, `--global` prunes global logs
- `commands/skills-cli.ts` — skills CLI: list, search, install, approve, remove, review
- `commands/rollback.ts` — list/restore develop checkpoints via GitCheckpointManager
- `commands/doctor.ts` — config validation, model file check, skill parseability, disk space
- `src/index.ts` — Commander entry point, log/prune/unlock/rollback/skills/memory/completions subcommands

**State:** `voidrift unlock` removes `.develop.lock`. `voidrift prune` removes logs beyond retention. `voidrift rollback` restores working tree from checkpoints.

### 2.8 Agent Loop (REQ-ARCH-1 through ARCH-19)

**Responsibilities:** Core message loop: API calls, tool dispatch, streaming, retry with jitter, model fallback, hook callbacks, stall detection, context management, budget tracking, abort handling.

**Owned files:**
- `agent/loop.ts` — `AgentLoop`: message routing, tool dispatch, hooks, retry, streaming, stall recovery
- `agent/protocol.ts` — `ProtocolAdapter` ABC, `OpenAIAdapter`, `AnthropicAdapter`
- `agent/context.ts` — `snipOldToolResults` (context snipping), `ContextCompactor` (governance/work partition, auto-compact at 80% work utilization, nudge at 70%, 10% ceiling against work budget, circuit breaker after 3 failures)
- `agent/budget.ts` — token budget tracking (shared across agents per command run)
- `agent/stall.ts` — stall detection (repeated reads without writes)
- `agent/think.ts` — think-tag stripping from model output
- `agent/abort.ts` — abort mechanism (closes HTTP clients on active loops)
- `agent/types.ts` — shared types (`ProgressData`, `LoopState`)

**State:** Active loops registered in module-level map (for abort). Token accumulators (`_inputTotal`, `_outputTotal`) per loop instance. Hook callbacks as optional fields on `AgentLoop`.

**Hook callbacks (ARCH-14):** `transform_context`, `before_tool_call`, `after_tool_call`, `get_steering_messages`, `get_follow_up_messages`, `stop_check`, `on_payload`. Thread-safe queues via `steer()` and `follow_up()`. `LoopState` carries `messages`, `turn_count`, token totals, `tools_called_this_turn`.

**Protocol adapters (ARCH-3):** `OpenAIAdapter` handles all OpenAI-compatible endpoints. `AnthropicAdapter` handles native Anthropic Messages API (system extraction, `input_schema` tools, tool_result batching, thinking block handling). `ModelInterface` wraps `ModelConfig + ProtocolAdapter`. `resolve_model(alias)` returns a `ModelInterface`.

### 2.9 Tools (REQ-TOOL-1 through TOOL-10, REQ-SEC-1 through SEC-5)

**Responsibilities:** 10 domain tools providing filesystem, shell, HTTP, browser, process, skill, memory, session, analyze, and ask capabilities. Per-command visibility filtering. Security classification and SSRF guarding.

**Owned files:**
- `tools/registry.ts` — tool schema definitions (`DOMAIN_FILE`, `DOMAIN_HTTP`, etc.), `DOMAIN_TOOLS` list
- `tools/builder.ts` — `buildLocalTools()`, `buildDomainHandlers()`, schema-handler contract validation, `narrowSchemaActions()`, permission guard wiring
- `tools/filesystem.ts` — `WriteContext`: path sandboxing, protected paths, snapshots, diff stats, mtime guard, line pagination, byte guard
- `tools/shell.ts` — `createRunCommand` factory, per-command bash config, two-layer security
- `tools/process.ts` — subprocess lifecycle (`startProcess`, `stopProcess`, `waitForReady`, `readProcessOutput`, `stopAll`)
- `tools/security.ts` — `classifyCommand()`: block/warn/safe patterns, `allowed_commands` glob override
- `tools/ssrf.ts` — DNS-based SSRF guard, IPv4+IPv6 blocked ranges, allow list
- `tools/http.ts` — HTTP client with per-session cookie/auth persistence
- `tools/browser.ts` — Playwright-based browser automation
- `tools/permissions.ts` — session-scoped permission gate (writes/runs/reads-outside)

**State:** `process.ts` holds process handles in module-level map. `http.ts` holds HTTP sessions. `browser.ts` holds browser sessions. All cleaned up via `stopAll()`/`clearSessions()`/`closeAllSessions()` in `try/finally`.

**Per-command visibility (ARCH-9):**

| Command | file | http | shell | browser | process | skill | memory | session | analyze | ask |
|---|---|---|---|---|---|---|---|---|---|---|
| **gather** | read, list | — | — | — | — | — | — | — | code, doc | — |
| **plan** | read, write, edit, list | — | — | — | — | — | — | — | — | — |
| **develop** | all | — | ✓ | — | — | — | — | — | — | — |
| **chat** | all | get | ✓ | — | — | get, list | all | search | code, doc | ✓ |
| **verify-plan** | read, list | — | — | — | — | — | — | — | — | — |
| **verify-doc** | read, write, list | — | — | — | — | — | — | — | — | — |
| **verify-exec** | read, write, list | all | ✓ | all | read_output | — | — | — | — | — |

### 2.10 Config, Skills, Memory (REQ-CFG-1 through CFG-5, REQ-SKL-1 through SKL-3, REQ-MEM-1 through MEM-3)

**Responsibilities:** Configuration loading with variable expansion, model alias resolution, three-layer skill resolution, two-layer memory system, prompt/template loading.

**Owned files:**
- `config.ts` — `ConfigManager` with `get`/`set`/`list`/`validate`, `CONFIG_SCHEMA`, `getMaxTokens()`, `getBashConfig()`, variable expansion (`${VAR}`, `${VAR:-default}`, `${section.key}`)
- `governance.ts` — `buildGovernanceLayer()`, `loadSharedGovernance()`, `checkGovernanceBudget()`, `getGovernanceBudget()`, `estimateTokens()` — chat governance/work partition (REQ-CHAT-14)
- `models.ts` — model alias resolution, `ModelInterface` = `ModelConfig` + `ProtocolAdapter`, defaults inheritance, fallback chain
- `skills.ts` — three-layer resolution: project → domain → north star. `findSkill(name, projectDir)` returns first match. Skill synthesis pipeline for `skills install`.
- `memory.ts` — `MemoryManager`: two-layer (project `.voidrift/memory/` + global `~/.voidrift/memory/`). Index injection into system prompt. Project overrides global on name collision.
- `session.ts` — `ChatSession`: JSONL persistence, `search_entries()` for history search across compaction boundaries
- `prompts.ts` — prompt/template loading from `~/.voidrift/resources/`, `resolvePrompt()` for variable substitution with unresolved-variable error (ARCH-18)
- `manifest.ts` — `ManifestManager`: task status, module grouping, dependencies, bug references, history.log append, idea auto-archival on verified (REQ-P-8)
- `git.ts` — git snapshot, bounded diff, checkpoints
- `utils.ts` — `ensureVoidriftDir()`, STATE.md append, logging helpers
- `errors.ts` — `ErrorTracker`: accumulates errors by category, shared singleton via `getSharedTracker()`, category-grouped summary with recoverability. AgentLoop auto-records api/tool/context errors. Lifecycle commands reset at start, display at end.

**State:** Config cached after first load. Skills cached in process memory. Memory entries are markdown files with YAML frontmatter.

### 2.11 TUI (REQ-UI-1 through UI-13)

**Responsibilities:** Full-screen terminal interface using Ink (React for terminals). Region-based architecture with subscribe/emit pattern. Markdown rendering, role-colored messages, thinking indicator, footer status bar, panel overlays, input history.

**Owned files:**
- `tui/state.ts` — `TUIState`, `TUIMessage`, message mutation functions (`addModel`, `updateLastModel`, `addTool`, `addSystem`, `addDiff`, `addOperator`)
- `tui/App.tsx` — root layout wiring
- `tui/Header.tsx` — ASCII art header
- `tui/Footer.tsx` — status bar
- `tui/Message.tsx` — role-colored message rendering (markdown via `marked` + `marked-terminal`)
- `tui/ToolCall.tsx` — tool call display (purple dot)
- `tui/Thinking.tsx` — braille spinner with customizable labels from `~/.voidrift/spinner-labels.txt`
- `tui/Panel.tsx` — panel overlay rendering
- `tui/useRegion.ts` — React hook: subscribe to Region, forceUpdate on emit
- `tui/regions/Region.ts` — base class with subscribe/emit
- `tui/regions/HeaderRegion.ts` — model name, welcome state
- `tui/regions/ContentRegion.ts` — messages, thinking indicator (base label + live stats)
- `tui/regions/FooterRegion.ts` — status bar, context %, mode
- `tui/regions/InputRegion.ts` — busy state, pending message, input history
- `tui/panels/Panel.ts` — panel interface
- `tui/panels/ModelPanel.ts` — model selection panel
- `tui/components/HeaderView.tsx` — ASCII art, tagline, welcome box
- `tui/components/ContentView.tsx` — message list, scroll
- `tui/components/FooterView.tsx` — status bar or active panel
- `tui/components/InputView.tsx` — text input, history, panel key handling

**State:** `TUIState` is the single mutable state object. Regions subscribe to state changes via `_notify`. Panel state is session-scoped.

**Display conventions:** Role-colored left-margin bars: operator=teal `┃` (#4ec9b0), model=blue `┃` (#6a7ec8) with streaming cursor `█`, tool=purple `●` (#c678dd) + blue name (#61afef), system=gray `┃` (#555555), stats=dim gray. Agent stats format: `(elapsed · ↓ Nk · ↑ Nk · <icon> N% · status)` where context icon uses pie chart progression (`○◔◑◕●` at 0/25/50/75/100%) with green 0–50%, yellow 51–75%, red 76–100%. Chat thinking indicator (UI-11): `⠹ Label · Ns · ↑ N` — random label set on start, elapsed ticks every second, output tokens appended when API responds. Chat completion line (UI-13): `▸ elapsed · ↓ Nk · ↑ Nk · <icon> N% · ✓ complete` — full stats after each model response. Markdown rendered via `marked` + `marked-terminal` with `showSectionPrefix: false`. CLI entry point sets `FORCE_COLOR=1` before `marked-terminal` loads.

### 2.12 Framework Resources (`resources/`)

**Responsibilities:** Static guidance loaded at command init.

**Owned files:**
- `resources/skills/` — methodology guidance (ANALYSIS-REQS, ARCH-DESIGN, WORKFLOW, etc.). Three-layer resolution: project → domain → north star.
- `resources/templates/` — output structure templates (REQUIREMENTS-TEMPLATE, ARCHITECTURE-TEMPLATE, TASK-FORMAT, DOMAIN-SKILL-TEMPLATE, etc.)
- `resources/prompts/system.md` — shared framework context prepended to every agent's system prompt
- `resources/prompts/<command>.md` — command-specific stage instructions
- `resources/spinner-labels.txt` — default thinking spinner labels (customizable at `~/.voidrift/spinner-labels.txt`)

### 2.13 Testing (`src/testing/`, `tests/`)

**Responsibilities:** Test infrastructure and fixtures.

**Owned files:**
- `testing/mock.ts` — `MockAdapter` implementing `ProtocolAdapter` with scripted response sequences. `createMockSetup(responses, configOverrides?)` returns `{model, adapter}` for injection into `AgentLoop`.

**Conventions:** Vitest with `vi.mock()` and `vi.fn()`. Test files in `tests/` matching source module structure, `.test.ts` suffix, `describe`/`it` blocks. Run via `bun test`. Default timeout: 30 seconds per test.

---

## 3. Key Design Decisions

### 3.1 One agent per unit of work

Each agent (gather file analysis, plan stage, develop task) starts with a clean message history. Shared state flows through in-memory structures that the CLI owns; only the final output is written to disk.

**Why:** A single agent accumulating 50 file analyses would hit the context window before the last file. Per-unit agents keep each context small and focused.

**Consequence:** No cross-file reasoning within a single gather stage — the consolidation pass must synthesize from per-file summaries.

### 3.2 Streaming vs non-streaming

Gather and chat use `stream=True` for live token telemetry. Plan, develop, deploy, and verify use `stream=False` for reliable tool call parsing. `stream_options: {include_usage: true}` is only included for providers known to support it (`openai`, `anthropic`, `gemini`); generic endpoints receive a clean request.

**Why:** Streaming in chat provides token-by-token display. Non-streaming in automated commands ensures tool call JSON is parsed correctly — vLLM's streaming parser does not reliably separate text from tool calls (ARCH-4, ARCH-20).

**Consequence:** Automated commands show no incremental output during model processing — only progress callbacks between turns.

### 3.3 Local agent tools in the CLI process

Agent tools run in-process via the OpenAI tools API — no subprocess, no server.

**Why:** The CLI always runs on the workstation where the project lives. In-process execution eliminates round-trip latency and simplifies cleanup (ARCH-1).

**Consequence:** Tools share the CLI's process memory. A tool that leaks memory or hangs blocks the entire command run.

### 3.4 Model entry fields

All model definitions live in a single YAML file at the path configured in `models_file`. Each entry is self-contained with its own connection details.

**Why:** One file, one source of truth, no merging. The CLI reads the file and connects to endpoints — it does not manage model servers (CFG-2).

**Consequence:** Operators must maintain the models file manually. No auto-discovery of available models.

| Field | Required | Default | Description |
|---|---|---|---|
| `base_url` | Yes | — | API endpoint URL |
| `api_key` | Yes | — | API key (supports `${VAR}` expansion) |
| `model_id` | Yes | — | Model identifier sent to the API |
| `provider` | No | — | `anthropic` or `gemini` for native APIs; omit for OpenAI-compatible |
| `max_context` | No | query API | Context window size in tokens |
| `max_tokens` | No | 16384 | Max output tokens per API call |
| `max_read_lines` | No | 2000 | Max lines returned by `file(action="read")` |
| `max_input_chars` | No | 0 (unlimited) | Max input chars for gather chunking |
| `concurrency` | No | 1 | Max concurrent task agents in develop |
| `fallback` | No | — | Alias of fallback model on 429/5xx retry exhaustion (CFG-2) |
| `max_input_tokens` | No | — | Token budget: max input tokens per command run (ARCH-13) |
| `max_output_tokens` | No | — | Token budget: max output tokens per command run (ARCH-13) |
| `protocol` | No | `openai` | Wire protocol: `openai` or `anthropic` |

### 3.5 `max_context` in config, not code

Context window sizes live in the models file as `max_context:` fields. No lookup table in CLI code.

**Why:** Hardcoded tables go stale silently. Config files are visible, auditable, and operator-controlled (CFG-2).

**Consequence:** Operators must set `max_context` for local models that don't report it via API.

### 3.6 Tool choice modes

Automated commands: `tool_choice: "required"` + auto-injected `done` tool. Chat: `tool_choice: "auto"`, no `done` injection.

**Why:** `required` ensures automated commands call tools rather than narrating. `auto` is necessary for chat — forcing tool calls on every conversational turn causes models to loop (ARCH-4).

**Consequence:** Chat agents can produce text-only responses. Automated agents must always call at least one tool per turn.

### 3.7 Per-command agent tool visibility

Each command sees only the tools relevant to its role (ARCH-9). Write permissions controlled per-command via `AGENT_TOOL_ACTIONS` (TOOL-8). Skills can further restrict tools via `allowed_tools` frontmatter — enforced in `AgentLoop._executeSingleCall` before `beforeToolCall` (SKL-2).

**Why:** A gather agent should never write files. A develop agent should never browse. Structural enforcement is stronger than prompt instructions.

**Consequence:** Adding a tool to a command requires updating the visibility table in `builder.ts`.

### 3.8 Separate framework and command logs

`~/.voidrift/logs/voidrift.log` records CLI invocations with cwd, model, args, exit code, and elapsed time (framework-global). `<project>/.voidrift/voidrift.log` records all command runs with `--- command-timestamp ---` delimiters (project-scoped). `<command>-<timestamp>.errors.jsonl` records structured error events.

**Why:** Framework logs are user-global; command logs are project-scoped. Structured error JSONL enables post-mortem analysis without grepping verbose logs (LOG-1, LOG-2, LOG-4).

**Consequence:** Two log roots to manage. `voidrift prune` handles project logs; `voidrift prune --global` handles framework logs. `voidrift log <command>` extracts the most recent section for a command from the project log.

### 3.9 Module-level registries for transient tool state

`process.ts`, `http.ts`, and `browser.ts` each hold transient state (process handles, HTTP sessions, browser sessions) in module-level maps. The orchestrator calls cleanup functions in a `try/finally` block.

**Why:** The CLI is single-process and single-run. A module-level map is simpler than injected dependency, carries zero overhead, and is trivially testable.

**Consequence:** Would need refactoring if the CLI ever supports concurrent top-level commands. Test isolation requires clearing registries between tests.

### 3.10 Hook-based agent loop extensibility

The agent loop accepts optional callback hooks (`transform_context`, `before_tool_call`, `after_tool_call`, `stop_check`, `get_steering_messages`, `get_follow_up_messages`, `on_payload`) as fields on `AgentLoop`. Thread-safe queues (`steer()`, `follow_up()`) allow external injection.

**Why:** Command orchestrators need to customize loop behavior (context snipping, tool interception, budget stops) without modifying loop internals (ARCH-14).

**Consequence:** Hook composition is manual — callers must compose multiple hooks themselves (e.g. skill guard + done guard).

### 3.11 Defense-in-depth for tool execution

File tools validate paths via `path.resolve().startsWith(root)`. Write tools check `protected_paths` and detect external modifications via mtime comparison. `shell` classifies commands via regex patterns. HTTP tools resolve hostnames and check against blocked IP ranges.

**Why:** Models produce incorrect paths and dangerous commands. These are defense-in-depth measures that catch common failure modes (SEC-1, SEC-2, SEC-5).

**Consequence:** Not comprehensive security boundaries. The operator should not run VoidRift as root or against untrusted inputs.

### 3.12 Pre-write snapshots for task atomicity

Before a develop task's first write, the original content is snapshotted. On task failure, all written files are rolled back. On success, diff stats are computed.

**Why:** A task that writes 3 of 5 files before failing leaves the project inconsistent. Rollback ensures each task is atomic (D-6).

**Consequence:** Memory usage scales with the number of files written per task. Very large file writes consume proportional snapshot memory.

### 3.13 Git context injection

Develop and chat capture a git status snapshot once per command run (`git.ts`): branch name, last 5 commits, uncommitted changed files (capped at 20). Appended to each agent's system prompt (~180 tokens).

**Why:** Agents writing source files need awareness of branch state and uncommitted work to avoid overwriting or duplicating recent changes (GIT-2).

**Consequence:** Snapshot is captured once and shared — not refreshed between tasks. Long develop runs may have stale git context.

### 3.14 Git diff safety limits

`getBoundedDiff()` in `git.ts` reads `git diff HEAD` with configurable caps: max total lines (2000), max files (50), max lines per file (400). Binary files excluded. Truncation markers identify omissions.

**Why:** Unbounded git diff on large projects can exhaust memory before a model is called (GIT-1).

**Consequence:** Large diffs are incomplete. Consumers must check for truncation markers.

### 3.15 Git checkpoints for develop rollback

Before each develop task, `git stash create` captures a snapshot (if tree is dirty). Checkpoints persisted to `.voidrift/checkpoints.jsonl`. `voidrift rollback <turn>` restores via `git checkout <stash_ref> -- .`.

**Why:** Turn-level checkpoints let the operator restore to any prior point with a single command (D-10, UTIL-8).

**Consequence:** Requires a git repository. Non-git projects have no rollback capability.

### 3.16 Bare mode for chat

`/bare` strips all automatic context injection: no skills, git snapshot, project state, or memory. `/bare` with `--system-prompt <path>` replaces the system prompt entirely. Mid-session `/bare` (REQ-CHAT-6) freezes the current agent's messages to `frozenMessages`, replaces with a bare system prompt (framework context only), and sets `isBare = true`. Any mode command (`/chat`, `/plan`, `/gather`, `/idea`) calls `switchMode(targetMode)` which detects `isBare` and calls `exitBare(targetMode)` — restoring frozen messages then rebuilding governance for the target mode.

**Why:** Operators need a way to talk to the model without framework context. CI invocations and isolated tasks benefit from a clean context slate (CHAT-9).

**Consequence:** No skill guidance, no memory, no git awareness. The operator must provide all context manually.

### 3.17 Two-layer project memory

`memory.ts` provides `MemoryManager` with project (`.voidrift/memory/`) and global (`~/.voidrift/memory/`) layers. At chat init (non-bare), the combined index is injected into the system prompt — names and descriptions only.

**Why:** Chat sessions accumulate project knowledge lost on terminal close. Memory persists conventions and decisions across sessions without polluting context (MEM-1, MEM-2).

**Consequence:** Memory is only writable from chat. Automated commands cannot persist knowledge (see IDEA-004 for harness-driven capture).

### 3.18 Conversation history search

`ChatSession.search_entries(query, limit)` in `session.ts` searches all JSONL entries (including before compaction boundaries) by case-insensitive substring match.

**Why:** After compaction, specific details from earlier turns are lost. History search fills the gap when the agent needs exact wording from a compacted exchange (CHAT-7).

**Consequence:** Substring matching only — no semantic search. Large session files may have slow search.

### 3.19 ProtocolAdapter pattern

`protocol.ts` defines `ProtocolAdapter` with `OpenAIAdapter` and `AnthropicAdapter`. The agent loop stores history in OpenAI format. On every API call: `adapter.build_request()` → wire format, `adapter.parse_response()` → canonical format.

**Why:** Scattering `if protocol === "anthropic"` throughout `loop.ts` ties format concerns to loop logic. The adapter pattern keeps each protocol's translation in one class. Adding a third protocol requires a new adapter — zero changes to `loop.ts` (ARCH-3).

**Consequence:** All history is stored in OpenAI format. Anthropic-specific features (cache_control, thinking blocks) require adapter-level translation. Both adapters add `cache_control: { type: "ephemeral" }` to system messages for providers that support it — Anthropic always, OpenAI for known caching providers (`openai`, `deepseek`, `gemini`). Non-caching providers receive unmodified messages (ARCH-16).

### 3.20 Session-scoped permission gate for chat

Three independently grantable categories: writes, runs, reads-outside. Prompt: allow once / always this session / deny. Automated commands unaffected — only `chat.ts` passes the gate.

**Why:** Smaller models infer intent from context and take unsolicited write actions. The permission gate is a hard stop that no model can bypass (CHAT-8).

**Consequence:** Every first write/run/external-read in a chat session requires operator confirmation. Can be friction-heavy for write-intensive sessions.

### 3.21 Done guard and write nudge for develop tasks

`before_tool_call` hook rejects `done` when zero writes have occurred. `get_follow_up_messages` hook injects a write nudge when the model produces text-only responses. Limited to 2 nudges per task.

**Why:** Small models fail to write files in two ways: calling `done` prematurely, and narrating code instead of calling write tools. The guard and nudge cover both exit paths (D-4, D-5).

**Consequence:** Tasks that legitimately require no writes (e.g. delete-only) must still call a write tool or will be nudged.

### 3.22 Develop agent self-review with confidence scoring

After the agent writes at least one file, a one-time steering message instructs it to re-read ACs, confirm satisfaction, and score confidence 0–100%. Below 90%, fix gaps.

**Why:** Agents read ACs at task start then write from memory. Details get lost. Self-review forces re-reading ACs with written code fresh in context (D-12).

**Consequence:** Adds one extra turn per task. Small models may produce unreliable confidence scores.

### 3.23 Prompt authoring guidelines

When writing or editing prompts in `resources/prompts/`: use positive instructions (tell the model what to do), keep prompts compact (every token competes with working memory).

**Why:** Negative instructions ("don't do X") are less reliable than positive ones. Verbose prompts reduce the model's effective context for the actual task.

**Consequence:** Prompt authors must think in terms of desired behavior, not prohibited behavior.

### 3.24 Concurrent tool call batching

`partitionToolCalls(calls)` splits a turn's tool calls into concurrent-safe and serialized groups. Read-only tools dispatched with `Promise.all`; write/mutating tools run sequentially. Identical tool calls deduplicated before execution.

**Why:** Read tools are safe to parallelize. Write tools must be serialized to prevent race conditions on shared files (ARCH-16).

**Consequence:** Tool call order within a concurrent batch is non-deterministic. Tests must not depend on execution order of read tools.

### 3.25 Context compaction with 10% ceiling

`ContextCompactor` in `context.ts` partitions the context window into a governance layer (system prompt, never compacted) and a work layer (message history, compactable). The work budget is `maxContext - governanceTokens`. Auto-compact triggers at 80% work utilization; nudge at 70%. After compaction, a ceiling check estimates the token count of non-system messages (~4 chars per token) and drops recent messages if the result exceeds 10% of the work budget. `CompactCommand` in `compact.ts` orchestrates the flow: compact → ceiling check → restore recently loaded skills and accessed files → append compaction entry to session. The governance layer is built by `governance.ts` from START.md, CONTRIBUTING.md, framework context, mode personality, skills, memory index, and git snapshot. A configurable `governance_max_tokens` (default 6144) warns when governance exceeds the cap.

Auto-compact triggers at 80% utilization using `prompt_tokens` from the most recent API response (tracked in `chat.ts` via `lastPromptTokens`). A one-time nudge fires at 70%. A circuit breaker disables auto-compact after 3 consecutive failures and warns the operator.

**Why:** The 10% ceiling ensures 90% of context is available for the next exchange. Token estimation avoids requiring a tokenizer dependency — the ~4 chars/token heuristic is conservative, erring toward dropping recent messages rather than exceeding the ceiling. Skills are restored because compaction destroys the tool results that originally delivered them (CHAT-4).

**Consequence:** The token estimate is approximate. Very long skill content or files with high token density (code) may slightly exceed the 10% target. Recent messages are sacrificed first — the summary always survives.

---

## 4. Data Flows

### 4.1 Gather

Three modes: `--import <path>` (reverse-engineer from codebase), `--idea <id>` (generate from idea), and `--ref <path>` (load codebase as chat context).

**--import mode** (three-stage pipeline):
```
Stage 1 — runTriage:
  CLI: build file tree → triage agent → JSON categories
  (source, tests, config, infrastructure, docs, assets, generated)

Stage 2 — runFileAnalysis + runGeneratedAnalysis:
  for each non-generated file:
    CLI: check analysis cache (hash-based) → hit: skip, miss: fresh agent
    agent: category-aware prompt + file content → analysis bullets
    CLI: write analysis/<file>.md with hash frontmatter
  for generated files (single call):
    agent: filename list → infers toolchain context

Stage 3 — runConsolidation:
  CLI: all analyses + generated context + existing REQUIREMENTS.md → agent → REQUIREMENTS.md
```

**--idea mode:**
```
CLI: read IDEA-{id}.md → ANALYSIS-REQS skill + REQUIREMENTS-TEMPLATE
  → agent updates REQUIREMENTS.md
CLI: record affected REQ IDs and diff in idea file
```

**--ref mode:**
```
CLI: validate path → buildFileTree → inject file tree into chat system prompt
  (no pipeline — operator drives the conversation with codebase as context)
```

### 4.2 Plan

Six-stage pipeline. Each stage uses scoped agent instances with clean message history.

```
Preflight: validate REQUIREMENTS.md exists

Delta analysis (update mode only — ARCHITECTURE.md + manifest exist, no --overwrite):
  Agent: REQUIREMENTS.md + ARCHITECTURE.md + source file listing → structured delta

Stage 1 — Architecture (one agent):
  ARCH-DESIGN skill + PLAN-ARCH prompt → writes ARCHITECTURE.md
  CLI: extract module list from YAML frontmatter

Stage 2 — Module arch (one agent per module):
  ARCHITECTURE.md summary + module name → writes arch/<module>.md

Stage 3 — Task outline (one agent per module):
  ARCHITECTURE.md + arch/<module>.md → writes tasks/outline/<module>.md

Stage 4 — Dependency resolution (one agent, multi-module only):
  All outline files → writes tasks/outline/deps.yml

Stage 5 — Task files (one agent per task):
  Task outline + arch/<module>.md + skill list → writes tasks/active/TASK-{id}.md

Stage 6 — README (one agent):
  REQUIREMENTS.md + ARCHITECTURE.md + README-TEMPLATE → writes README.md

Post-processing: build manifest.yml, validate skills, remove outline intermediates
```

### 4.3 Develop

```
CLI: load manifest → find dispatchable tasks (planned + deps met)
  capture git snapshot once → shared string
  dispatch agents concurrently (up to model.concurrency):
    each agent: task file + git context → file(action="write") → done()
  CLI: verify write occurred → mark implemented
  CLI: no write → retry → still no write → escalate to architect
  CLI: loop until no dispatchable tasks remain
  Display: Ink progress table when concurrent, spinner when sequential
```

### 4.4 Chat session persistence

```
voidrift → load .voidrift/chat-session.jsonl → restore messages → resume
  each turn: append user + assistant to JSONL (append-only)
  /compact → summarize history via one-shot agent → enforce 10% ceiling
           → restore recently loaded skills + accessed files → append compaction entry
  auto-compact: triggers at 80% utilization (tracked via prompt_tokens from API response)
  nudge: one-time warning at 70% utilization
  circuit breaker: 3 consecutive compact failures → auto-compact disabled, operator warned
  /clear → delete session file, reset to fresh state
```

### 4.5 Idea refinement (chat)

```
/idea       → create new IDEA-{id}.md, inject idea prompt overlay
/idea <id>  → load existing, resume refinement
  Agent drives: intake → exploration → shaping → summary
/done       → operator picks now/next/later, agent writes final idea file
```

### 4.6 Verify

```
Stage 0 — Doc verification:
  Agent (verify-doc tools): README.md + ARCHITECTURE.md + source → bugs/DOC-N.md
  CLI: count new DOC-* bug files

Stage 1 — Plan agent:
  REQUIREMENTS.md + ARCHITECTURE.md + arch/* + manifest → VERIFY-PLAN.md
  (one self-contained test case per testable requirement)

Stage 2 — Concurrent sub-agents:
  For each ITEM in VERIFY-PLAN.md:
    tools: file, http, shell, browser, process
    PASS → no output
    FAIL → writes bugs/<ITEM-ID>.md with full evidence

Stage 3 — Report:
  CLI: writes VERIFY.md (summary table, per-item results, doc bug count, verdict)
  CLI: append_state(verify, verdict, counts)

try/finally: stopAll(), clearSessions(), closeAllSessions()
```

### 4.7 Deploy

```
Preflight: REQUIREMENTS.md and ARCHITECTURE.md must exist

CLI: determine last release tag → read history.log since tag
Version bump: agent → "major"/"minor"/"patch" → operator confirms
Changelog: build from history.log → append to CHANGELOG.md
Git tag: git tag -a v{version}
Conditional IaC: if ARCHITECTURE.md mentions infrastructure → agent generates
Post-deploy hook: if configured → run shell command with $VERSION
```

### 4.8 Agent system prompt construction

All agents use `buildSystemPrompt()` from `prompts.ts` to enforce 4-layer ordering (ARCH-19). Framework context is loaded once per command run via `loadPrompt("system", "CONTEXT")` and shared across all agents in that run.

```
system_prompt = buildSystemPrompt(
  frameworkContext,                      # L1: loaded once per command run
  skill,                                # L2: methodology guidance (optional)
  stagePrompt,                          # L3: stage-specific instructions
  ...injectedContext                    # L4: task details, analyses, specs
)
```

### 4.9 Agent loop

```
send(user_message)
  → _runLoop():
    while tools present:
      [budget check — ARCH-13]
      [transform_context hook — ARCH-14]
      [on_payload hook — ARCH-14]
      _streamResponse() / _syncResponse()  [with retry + jitter, ARCH-10]
        ↓ context_length_error? → reactive compact [ARCH-12]
        ↓ truncated text? → max_tokens recovery [ARCH-11]
        ↓ truncated tool_calls? → discard + re-emit [ARCH-11]
        ↓ no tool_calls? → follow_up hooks → return text
      [stall detection — nudge or break]
      deduplicate identical tool calls [ARCH-16]
      partition into concurrent/serial batches [ARCH-16]
      for each tool call:
        [normalize args — ARCH-15]
        [before_tool_call hook — ARCH-14]
        execute handler
        [after_tool_call hook — ARCH-14]
      [steering hooks/queue — ARCH-14]
      [abort/budget/max_turns/stop_check]
      [ITERATION log — ARCH-18]
    [LOOP_EXIT log — ARCH-18]
    force final text call (stall/stop recovery)
    return text
  finally: client.close() [ARCH-17]
```

---

## 5. State and Persistence

| Store | Location | Contents | Lifetime |
|---|---|---|---|
| Project artifacts | `<project>/.voidrift/` | REQUIREMENTS.md, ANALYSIS.md, analysis/, ARCHITECTURE.md, tasks/, arch/, VERIFY.md, bugs/, ideas/, memory/ | Project |
| Command logs | `<project>/.voidrift/voidrift.log` | All command runs with `--- command-ts ---` delimiters | Until `voidrift prune` |
| Chat session | `<project>/.voidrift/chat-session.jsonl` | Append-only JSONL with id/parentId tree | Until `/clear` |
| State history | `<project>/.voidrift/STATE.md` | Command run history, file manifests | Append-only |
| Task history | `<project>/.voidrift/tasks/history.log` | Lifecycle events (append-only). Rotated to `history-<version>.log` on deploy | Until deploy rotation |
| Checkpoints | `<project>/.voidrift/checkpoints.jsonl` | Git stash refs per develop turn | Until manual cleanup |
| System log | `~/.voidrift/logs/voidrift.log` | CLI invocations (cwd, model, args), command outcomes (exit code, elapsed) | Rotating (configurable) |
| Config | `~/.voidrift/config.yml` | All framework settings | Permanent |
| Models | Path from `models_file` config | All model aliases (local, cloud, gateway) | Operator-maintained |
| Global memory | `~/.voidrift/memory/` | Operator preferences shared across projects | Permanent |
| Project memory | `<project>/.voidrift/memory/` | Project-specific facts and conventions | Project |
| Resources | `~/.voidrift/resources/` | Skills, prompts, templates, spinner labels | Framework-managed |

**Write-through file I/O:** All framework file writes are synchronous — no buffered writes. Artifacts are on disk before the next stage reads them.

**Resource caching:** Skills, prompts, and templates are cached in process memory after first load for sub-millisecond repeated access within a command run.