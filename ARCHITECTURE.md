# VoidRift Architecture

**Agentic Software Engineering Framework**

This document describes the bounded contexts, component responsibilities, and key design decisions for the VoidRift framework itself. For a quickstart, see [README.md](README.md).

---

## 1. System Context

VoidRift orchestrates AI models to produce a deployable project from requirements alone. The operator runs `voidrift` on a workstation. Models run either locally (GPU worker node via vLLM), through Kiro Gateway, or against cloud APIs. All three look identical to the CLI: an OpenAI-compatible endpoint at a URL.

```
Operator
  │
  ▼
voidrift CLI  ──reads──►  ~/.voidrift/ (config, resources)
  │                       ~/.worker-cli/models.yml (model registry)
  │
  ├── HTTP ──►  Local vLLM (GPU worker node)
  ├── HTTP ──►  Kiro Gateway
  └── HTTPS ►  Cloud APIs (Anthropic, Google)
```

---

## 2. Components

### 2.1 CLI (`src/`)

**Entry point:** `src/index.ts` → Commander CLI

The CLI is the orchestration layer. It owns:
- Framework command execution (Gather → Plan → Develop → Deploy → Verify → Chat)
- Command classes in `commands/`: `base.ts` (BaseCommand, SlashCommand), `gather.ts`, `plan.ts`, `develop.ts`, `deploy.ts`, `verify.ts`, `chat.ts`
- Slash command classes: `help.ts`, `clear.ts`, `ask.ts`, `compact.ts`, `settings.ts`, `model.ts`, `idea.ts`
- Agent loop (`agent/loop.ts`) — message routing, tool dispatch, hooks, stall detection, think-tag stripping, retry with jitter, model fallback, streaming
- Protocol adapters (`agent/protocol.ts`) — OpenAI + Anthropic wire format translation
- Token budget tracking (`agent/budget.ts`) — shared across agents per command run
- Model alias resolution (`models.ts`) — `ModelInterface` bundles `ModelConfig` + `ProtocolAdapter`
- Local agent tools (`tools/` sub-package): filesystem, shell, process management, HTTP client, browser automation, security, SSRF guard, permissions
- Interactive TUI (`tui/`) — region-based architecture with Ink (React for terminals)
- System log (`~/.voidrift/logs/voidrift.log`) via `utils.ts`
- Config management (`config.ts`) — `ConfigManager` with `CONFIG_SCHEMA` validation

**Command class hierarchy:**
```
BaseCommand (preflight → boot → execute → finish)
├── GatherCommand, PlanCommand, DevelopCommand, DeployCommand, VerifyCommand

SlashCommand (lightweight execute-only)
├── HelpCommand, ClearCommand, AskCommand, CompactCommand
├── SettingsCommand, ModelCommand, IdeaStartCommand, IdeaDoneCommand
```

**TUI region architecture:**
```
src/tui/
├── regions/           — state classes with subscribe/emit pattern
│   ├── Region.ts      — base class
│   ├── HeaderRegion   — model name, welcome state
│   ├── ContentRegion  — messages, thinking indicator
│   ├── FooterRegion   — status bar, panel overlay
│   └── InputRegion    — busy, mode, pending, history
├── panels/            — pluggable footer overlays (Panel interface)
│   ├── Panel.ts       — interface: items, onSelect, onCancel
│   └── ModelPanel.ts  — model selection
├── components/        — React views (subscribe to one region via useRegion hook)
│   ├── App.tsx        — layout wiring
│   ├── HeaderView     — ASCII art, tagline, welcome box
│   ├── ContentView    — message list, thinking spinner
│   ├── FooterView     — status bar OR active panel
│   └── InputView      — text input, history, panel key handling
├── Message.tsx        — pure render (markdown via marked-terminal)
├── ToolCall.tsx       — pure render (purple dot)
├── Thinking.tsx       — braille spinner
└── useRegion.ts       — React hook: subscribe to Region, forceUpdate on emit
```

**Slash command → framework command integration (REQ-U-2f):**
Framework commands (`runGather`, `runPlan`, `runDevelop`, `runVerify`, `runDeploy`) accept an optional `onProgress?: (msg: string) => void` callback as their last parameter. When provided (chat mode), `printCommandHeader` is suppressed and all progress messages route through the callback to `content.addSystem()`. When absent (headless mode), messages go to `process.stderr.write` with the original format (ANSI dim codes, per-file triage lines, `▸` stage markers). The `wrapCommand` harness in `base.ts` manages `footer.setMode()` and `input.setBusy()` around execution. Chat handlers in `chat.ts` also call `content.setThinking(true, label)` for spinner display during command execution.

Agent tools live in `src/tools/`:
- `registry.ts` — All 10 domain tool schemas + DOMAIN_DONE in OpenAI format. `DOMAIN_TOOLS` exports all schemas.
- `builder.ts` — `buildLocalTools()` resolves command tool sets via OCP dynamic import from command modules. `buildDomainHandlers()` wires handlers at build time. `narrowSchemaActions()` restricts action enums per command.
- `filesystem.ts` — `WriteContext` with path sandboxing (realpathSync for symlinks), protected paths, snapshots, diff stats, line pagination, byte guard, mtime guard
- `shell.ts` — `createRunCommand` factory for per-command shell handlers with two-layer security
- `process.ts` — subprocess lifecycle (startProcess, stopProcess, waitForReady with http/port/log_pattern strategies, readProcessOutput, stopAll)
- `security.ts` — `classifyCommand()` for shell command risk assessment (safe/warn/block)
- `ssrf.ts` — DNS-based SSRF guard with IPv4 + IPv6 blocked ranges, allow list
- `http.ts` — HTTP client with per-session cookie/auth persistence
- `browser.ts` — Playwright-based browser automation
- `permissions.ts` — Session-scoped permission gate for chat (writes/runs/reads-outside)

The CLI does **not** manage containers, SSH connections, or gateway processes. Every model is just a `ModelInterface` with `(baseUrl, apiKey, modelId)` + `ProtocolAdapter`.

### 2.2 Framework Resources (`resources/`)

Static guidance loaded at command init:
- `skills/` — methodology guidance (16 files, determined dynamically from directory contents; includes ANALYSIS-REQS, ARCH-DESIGN, BACKEND-ENG, CLOUD-OPS, QUALITY-QA, RELIABILITY-ENG, SECURITY-TRUST, SYSTEMS-ENG, WEB-RESEARCH, WORKFLOW, and others)
- `templates/` — output structure templates (REQUIREMENTS-TEMPLATE, ARCHITECTURE-TEMPLATE, etc.)
- `prompts/system.md` — shared framework context (command lifecycle table, artifact ownership); prepended to every agent's system prompt across all commands
- `prompts/<command>.md` — command-specific stage instructions (gather.md, plan.md, develop.md, chat.md, deploy.md, verify.md, skills.md)

Synced to `~/.voidrift/resources/` via `make sync`.

> **Note:** Command prompts in `resources/prompts/<command>.md` shape each agent invocation. A single command can have multiple distinct agent invocations, each shaped by its specific stage prompt — `system.md` provides the shared framework context.

---

## 3. Key Design Decisions

### 3.1 One agent per unit of work

Each agent (gather source analysis, plan, develop task) starts with a clean message history. Shared state flows through in-memory dicts (`source_requirements`, `context_summaries`) that the CLI owns; only the final pass output is written to disk. **Why:** A single agent accumulating 50 file analyses would hit the context window before the last file. Per-unit agents keep each context small and focused; CLI-owned persistence eliminates tool call JSON overhead (REQ-ARCH-7, REQ-G-8).

### 3.2 Streaming vs non-streaming

Gather and chat use `stream=True` for live token telemetry and responsive UX. Plan, develop, deploy, and verify use `stream=False` for reliable tool call parsing — vLLM's streaming parser does not reliably separate text from tool calls. Token usage (prompt tokens, completion tokens, context %) is captured from both paths and forwarded to the `on_progress` callback. **Why:** Streaming in gather surfaces per-call telemetry across all four stages. Streaming in chat provides token-by-token display. Non-streaming in automated commands ensures tool call JSON is parsed correctly (REQ-ARCH-4, REQ-UI-10).

`stream_options: {include_usage: true}` is only included for providers known to support it (`openai`, `anthropic`, `gemini`). Generic OpenAI-compatible endpoints (local vLLM, third-party APIs) silently ignore this option and return no usage data. The decision is made in `OpenAIAdapter.build_request()` based on the `provider` field, not hardcoded in the transport layer. When a provider returns no usage data, token accumulators receive 0 — `[LOOP_EXIT]` still logs correct (zero) totals (REQ-ARCH-20).

### 3.3 Local agent tools in the CLI

Agent tools live in `cli/src/voidrift_cli/tools/` (a Python package). These run in-process in the CLI via the OpenAI tools API — no subprocess, no server. **Why:** The CLI always runs on the workstation where the project lives. Keeping tools in the CLI process eliminates round-trip latency and simplifies cleanup (process registry, HTTP sessions, browser sessions all released in the same process).

The `tools/` package was split out from `tools.py` to support multiple tool modules (filesystem, process, HTTP, browser) without naming conflicts.

### 3.4 External interfaces (worker-cli)

VoidRift reads two files maintained by an external tool (worker-cli). Both paths are configurable in `config.yml`:

**Models file** (`models_file`, default `~/.worker-cli/models.yml`): All model definitions — local, cloud, and gateway. Each entry is self-contained with its own connection details. VoidRift reads the file and connects to endpoints. It does not manage containers, refresh tokens, or configure model servers — that is worker-cli's responsibility. One file, one source of truth, no merging (REQ-MC-1).

**Active container marker** (`active_container_file`, default `~/.worker-cli/.active-container`): Written by `worker start`, contains the container ID (line 1) and model alias (line 2). VoidRift reads this to default the model prompt in interactive mode (REQ-ARCH-3). If the file doesn't exist, the first configured model alias is used.

**Model entry fields:**

| Field | Required | Default | Description |
|---|---|---|---|
| `base_url` | Yes | — | API endpoint URL |
| `api_key` | Yes | — | API key (supports `${VAR}` expansion) |
| `model_id` | Yes | — | Model identifier sent to the API |
| `provider` | No | — | `anthropic` or `gemini` for native APIs; omit for OpenAI-compatible |
| `type` | No | — | Metadata only (e.g. `local`, `cloud`) — no behavioral effect |
| `max_context` | No | query API | Context window size in tokens |
| `max_tokens` | No | 16384 | Max output tokens per API call |
| `max_read_lines` | No | 2000 | Max lines returned by `file(action="read")` |
| `max_input_chars` | No | 0 (unlimited) | Max input chars for gather chunking |
| `concurrency` | No | 1 | Max concurrent task agents in develop |
| `fallback` | No | — | Alias of fallback model on 429/5xx retry exhaustion (REQ-MC-4) |
| `max_input_tokens` | No | — | Token budget: max input tokens per command run (REQ-ARCH-13) |
| `max_output_tokens` | No | — | Token budget: max output tokens per command run (REQ-ARCH-13) |
| `protocol` | No | `openai` | Wire protocol: `openai` (default, all OpenAI-compatible endpoints) or `anthropic` (native Anthropic Messages API via `AnthropicAdapter`) |

The `defaults:` section provides fallback values for all optional fields. Each model entry inherits defaults and can override any field.

### 3.5 `max_context` in config, not code

Context window sizes live in the models file as `max_context:` fields. No lookup table in the CLI code. **Why:** Hardcoded tables go stale silently. Config files are visible, auditable, and operator-controlled (REQ-MC-3).

### 3.6 Tool choice modes

Automated commands: `tool_choice: "required"` + auto-injected `done` tool. Chat: `tool_choice: "auto"`, no `done` injection. **Why:** `required` ensures automated commands call tools rather than narrating. `auto` is necessary for chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text (REQ-ARCH-4).

### 3.7 Per-command agent tool visibility

Each command sees only the agent tools relevant to its role (REQ-ARCH-9). Write permissions are controlled per-command via `AGENT_TOOL_ACTIONS` (REQ-TOOL-8) — a gather agent sees `file` with only `read` and `list` actions. The boundary is structural — a tool absent from the list cannot be called, and an action absent from the schema enum cannot be requested. Skills can further restrict tools via `allowed_tools` frontmatter (REQ-SKL-9) — enforced by `before_tool_call` hook. Restrictions are additive (can only reduce, never expand).

**Tool inventory (10 domain tools):**

| Tool | Actions | Description |
|---|---|---|
| `file` | read, write, edit, delete, list | Read, write, edit, delete, or list files. Path-based routing: `.voidrift/` paths are framework artifacts, all others are project source. Auto-detects PDF/DOCX/XLSX for binary document extraction. |
| `http` | get, post, put, delete | HTTP requests. `get` in chat fetches+summarizes URLs (SSRF-checked, operator-confirmed, cached). All actions in verify-execute for API testing with session persistence. |
| `shell` | *(single)* | Run shell commands. Per-command allowlists (REQ-SEC-4), global security classification (REQ-SEC-2). |
| `browser` | navigate, screenshot, click, get_text | Playwright browser automation for verify sub-agents. |
| `process` | read_output | Read buffered output from managed subprocesses (verify). |
| `skill` | get, list | Load or list available skills (chat only — other commands pre-inject skills). |
| `memory` | read, write, list, delete | Persist project knowledge across chat sessions. Two-layer: project + global. |
| `session` | search | Search raw chat session JSONL by keyword, including compacted history. |
| `analyze` | code, document | Tree-sitter code analysis (imports, symbols, complexity) or binary document extraction. Soft dependencies. |
| `ask` | *(single)* | Ask the operator a clarifying question with optional numbered choices. |

**Per-command visibility:**

| Command | file | http | shell | browser | process | skill | memory | session | analyze | ask |
|---|---|---|---|---|---|---|---|---|---|---|
| **gather** | read, list | — | — | — | — | — | — | — | code, doc | — |
| **plan** | read, write, edit, list | — | — | — | — | — | — | — | — | — |
| **develop** | all | — | ✓ | — | — | — | — | — | — | — |
| **chat** | all | get | ✓ | — | — | get, list | all | search | code, doc | ✓ |
| **verify-plan** | read, list | — | — | — | — | — | — | — | — | — |
| **verify-exec** | read, write, list | all | ✓ | all | read_output | — | — | — | — | — |

### 3.8 Separate framework and command logs

`~/.voidrift/logs/voidrift.log` records CLI invocations and command outcomes — always written to `~/.voidrift/` regardless of `VOIDRIFT_HOME`. `<project>/.voidrift/logs/<command>-<timestamp>.log` records the full per-run agent dialog. `<command>-<timestamp>.errors.jsonl` records structured error events alongside the command log. `ErrorTracker` accumulates errors during a run and displays a Rich summary table at completion (REQ-LOG-6). **Why:** Framework logs are user-global (one across all projects); command logs are project-scoped (one per run). Structured error JSONL enables post-mortem analysis without grepping verbose logs.

### 3.9 Module-level registries for transient tool state

`process_manager.py`, `http_client.py`, and `browser.py` each hold their transient state (process handles, HTTP sessions, browser sessions) in module-level dicts (`_registry`, `_sessions`). The orchestrator calls `stop_all()`, `clear_sessions()`, and `close_all_sessions()` in a `try/finally` block to release all state after each run.

**Why:** The CLI is single-process and single-run: one `run_verify()` or `run_develop()` call per process. A module-level dict is simpler than an injected dependency, carries zero overhead, and is trivially testable by patching. Lifecycle is controlled by the orchestrator, not by individual sub-agents, which ensures cleanup happens exactly once regardless of how many sub-agents ran. This would be revisited if the CLI ever supports concurrent top-level commands.

### 3.10 Hook-based agent loop extensibility

The agent loop accepts optional callback hooks (`transform_context`, `before_tool_call`, `after_tool_call`, `stop_check`, `get_steering_messages`, `get_follow_up_messages`, `on_payload`) as fields on `AgentLoop`. Thread-safe message queues (`steer()`, `follow_up()`) allow external injection. A `LoopState` dataclass carries `messages`, `turn_count`, `input_tokens_total`, `output_tokens_total`, `tools_called_this_turn` to state-aware hooks.

**Why:** Command orchestrators need to customize loop behavior (context snipping, tool interception, phase chaining, budget stops) without modifying loop internals. Hooks as optional fields on the existing Pydantic model keep the interface flat — no separate config dataclass, no structural rewrite. All hooks default to None; the loop behaves identically when no hooks are set.

### 3.11 Defense-in-depth for tool execution

File tools validate paths via `Path.resolve().relative_to()` (REQ-SEC-1). Write tools check a `protected_paths` set and detect external file modifications via mtime comparison (REQ-D-19). `shell` classifies shell commands via regex patterns (REQ-SEC-2) — block/warn/safe. HTTP tools (`http(action="get")`, `http`) resolve hostnames and check against blocked IP ranges (REQ-SEC-3) — private, link-local, CGNAT blocked; loopback allowed for local dev; `ssrf_allow_list` in config overrides. Tool arguments are normalized before execution (REQ-ARCH-17). All blocks are logged.

**Why:** Models produce incorrect paths and dangerous commands. These are not comprehensive security boundaries — they are defense-in-depth measures that catch the most common failure modes without adding complexity. The operator should not run VoidRift as root or against untrusted inputs.

### 3.12 Pre-write snapshots for task atomicity

Before a develop task's first write to any file, the original content is snapshotted in thread-local storage. On task failure, all written files are rolled back. On success, diff stats are computed before clearing.

**Why:** A task that writes 3 of 5 files before failing leaves the project in an inconsistent state. Rollback ensures each task is atomic. Thread-local storage isolates concurrent tasks.

### 3.13 Git context injection

Develop and chat capture a git status snapshot once per command run (`git_context.py`): branch name, last 5 commits, uncommitted changed files (capped at 20). The snapshot is rendered as a `## Git Context` prompt block (~180 tokens) and appended to each agent's system prompt. All git subprocess calls use a 5-second timeout; non-git directories and missing git silently skip injection.

**Why:** Agents writing source files have no awareness of branch state, recent changes, or uncommitted work. A 180-token snapshot prevents agents from overwriting uncommitted work or duplicating recent changes at negligible context cost. Captured once and shared as a string — not re-captured per task (REQ-D-18).

### 3.14 Git diff safety limits

`get_bounded_diff()` in `git_utils.py` reads `git diff HEAD` with configurable caps: max total lines (2000), max files (50), max lines per file (400). Binary files are detected by extension and excluded. Truncation markers identify what was omitted. Config overrides via `git:` section in `config.yml`.

**Why:** Unbounded git diff on large projects can exhaust memory before a model is called. Explicit truncation markers ensure consumers know the diff is incomplete (REQ-GIT-4).

### 3.15 Git checkpoints for develop rollback

Before each develop task, `GitCheckpointManager` creates a `git stash create` snapshot (if the tree is dirty). Checkpoints are stored in memory during the run and persisted to `.voidrift/checkpoints.jsonl` on completion. `voidrift rollback <turn>` restores the working tree to any checkpoint via `git checkout <stash_ref> -- .`.

**Why:** A task that produces bad output requires manual `git diff` and `git checkout` to undo. Turn-level checkpoints let the operator restore to any prior point with a single command (REQ-D-20).

### 3.16 Bare mode for chat

`--bare` on chat strips all automatic context injection: no skill pre-injection, no project state, no git snapshot. System prompt = `system.md` CONTEXT section only. Session persistence, tools, `--doc`, and `--style` still work. `--bare --system-prompt <path>` replaces the system prompt entirely with the file content.

**Why:** Operators need a way to talk to the model without framework context — an extended `/quick` with full session mechanics. CI invocations and isolated tasks benefit from a clean context slate (REQ-U-17).

### 3.17 Two-layer project memory

`memory.py` provides `MemoryManager` with two layers: project (`.voidrift/memory/`) and global (`~/.voidrift/memory/`). Each entry is a markdown file with YAML frontmatter. A `MEMORY.md` index in each layer lists entries by name and description. At chat init (non-bare), the combined index is injected into the system prompt — names and descriptions only, not full content. `memory(action="read")`, `memory(action="write")`, and `memory(action="list")` tools are available in chat only. Project entries override global entries with the same name, matching the skill resolution pattern.

**Why:** Chat sessions accumulate project knowledge lost on terminal close. Memory persists conventions and decisions across sessions without polluting context — only the index is injected, full content loaded on demand (REQ-MEM-1).

### 3.18 Conversation history search

`ChatSession.search_entries(query, limit)` in `session.py` searches all JSONL entries (including those before compaction boundaries) by case-insensitive substring match on message content. Returns up to `limit` (default 5, max 10) entries newest-first, each with timestamp, role, and content truncated to 2000 characters. The `session(action="search")` agent tool is registered in `build_local_tools` for the chat command only.

**Why:** After compaction, specific details from earlier turns are lost. Memory covers cross-session facts, but intra-session search of raw history fills the gap when the agent needs exact wording from a compacted exchange (REQ-U-18).

### 3.19 Document format extraction

`tools/document.py` provides `analyze(action="document")(path, project_root)` that extracts text from PDF (via `pymupdf`), DOCX (via `python-docx`), and XLSX (via `openpyxl`). Format detected by file extension. All three are soft dependencies — missing libraries return an error with the pip install command. DOCX preserves heading hierarchy as markdown headings. XLSX returns one markdown table per sheet. Path validation uses the same project-root sandboxing as source file tools. The `analyze(action="document")` agent tool is registered for chat and gather commands.

**Why:** Enterprise requirements arrive as Word/PDF. Extracting text into markdown lets gather and chat process them without manual conversion. Soft dependencies keep the core CLI lightweight (REQ-U-19).

### 3.20 Structured code analysis

`tools/analyze(action="code").py` provides `analyze(action="code")(path, project_root)` that parses source files via tree-sitter and returns compact JSON: language, line count, imports, exported symbols (name, type, line), and complexity (branch point count). Language detected by file extension mapped to tree-sitter grammar names. Covers Python, JavaScript, TypeScript, Rust, Go, Java, C, C++, Ruby. Tree-sitter and per-language grammars are soft dependencies. Available in chat and gather.

**Why:** Prompt-based analysis requires the model to spend tokens parsing file structure. Tree-sitter provides machine-parsed facts (imports, symbols, complexity) directly, improving accuracy for large files and reducing context consumption (REQ-U-20).

### 3.21 ProtocolAdapter pattern (REQ-ARCH-22)

`agent_protocol.py` defines `ProtocolAdapter` — an ABC with two concrete implementations:

| Class | Protocol | Client | Notes |
|---|---|---|---|
| `OpenAIAdapter` | `openai` (default) | `openai.OpenAI` | All OpenAI-compatible endpoints — local vLLM, Kiro Gateway, Anthropic OpenAI-compat, Gemini |
| `AnthropicAdapter` | `anthropic` | `anthropic.Anthropic` | Native Anthropic Messages API — system extraction, `input_schema` tools, tool_result batching |

`ModelInterface` wraps `ModelConfig + ProtocolAdapter`. `resolve_model(alias)` returns a `ModelInterface`; nothing in the framework holds a naked `ModelConfig` after resolution.

**Agent loop contract:** The loop stores history in OpenAI format. On every API call:
1. `adapter.build_request(openai_kwargs, provider)` → wire format dict
2. `_create_with_retry(client, wire_request, streaming)` → raw response
3. `adapter.parse_response(raw)` or `adapter.iter_stream(stream, ...)` → `(text, tool_calls, finish_reason, usage)`

All protocol differences are in the adapter — no `if protocol == "anthropic"` branches in `agent.py`.

**AnthropicAdapter specifics:**
- Extracts `role: system` messages as top-level `system=` parameter
- Converts tool `parameters` → `input_schema`; maps `tool_choice: "required"` → `{"type": "any"}`
- Batches consecutive `role: tool` messages into a single `role: user` message with `tool_result` blocks
- Maps `stop_reason: end_turn/tool_use/max_tokens` → canonical `stop/tool_calls/length`
- Thinking content blocks logged as `[THINKING]`, excluded from returned text

**Why:** Scattering `if protocol == "anthropic"` throughout `agent.py` ties format concerns to loop logic. The adapter pattern keeps each protocol's translation in one class. Adding a third protocol requires a new adapter and a `get_adapter()` entry — zero changes to `agent.py` (REQ-ARCH-22).

### 3.22 Session-scoped permission gate for chat (REQ-U-22)

Chat agents can read, write, and run — all necessary for legitimate operator-directed work. But smaller models infer intent from context and take unsolicited write actions (e.g. creating REQUIREMENTS.md after an operator says "let's gather"). The permission gate adds a mandatory human-in-the-loop confirmation layer that no model can bypass.

**Three independently grantable categories:**

| Category | Triggers on | Default |
|---|---|---|
| `writes` | `file(action="write")`, `file(action="edit")`, `file(action="write")` | deny |
| `runs` | `shell` | deny |
| `reads_outside` | `file(action="read")` / `file(action="read")` targeting a path outside `project_dir` | deny |

Reads within the project root are free — no prompt needed.

**Prompt:** "Allow once / Always allow this session / Deny". Allow-once grants for that one call. Always-allow sets a session flag (`PermissionGate.writes/runs/reads_outside = True`) so subsequent calls in the same session are free. Deny returns an error string to the agent as the tool result.

**Implementation pattern:**

```
_chat_display.py
  PermissionGate          # dataclass — three bool flags (writes, runs, reads_outside)
  _handle_permission_prompt(category, description, gate, console, input_fn) → bool
    # zero I/O, independently testable — all deps injected

tool_builder.py
  _make_write_guard(name, handler, gate, confirm_holder) → guarded_handler
  _make_run_guard(handler, gate, confirm_holder) → guarded_handler
  _make_read_outside_guard(name, handler, project_dir, gate, confirm_holder, ctx) → guarded_handler
  build_domain_handlers(... permission_gate=None, permission_confirm_holder=None)
    # wraps handlers at build time; gate=None → guards not applied (automated commands)

chat.py / _interactive_loop
  _perm_gate = PermissionGate()         # created in run_chat
  _perm_holder: list = [None]           # mutable holder — same pattern as http(action="get") confirm
  _live_perm_confirm(category, desc)    # Live-aware closure: stops Live, prompts, restarts Live
    # set as _perm_holder[0] inside _interactive_loop (after Live is created)
```

**Automated commands unaffected:** `build_domain_handlers` and `build_local_tools` default `permission_gate=None`. Only `run_chat` passes the gate — gather/plan/develop/verify/deploy never do. Non-TTY sessions set `_perm_holder[0] = None`, causing guards to auto-deny.

**Why two mechanisms (prompt + gate):** The `## CHAT-ROLE` section in `system.md` instructs the model not to infer write intent. This catches well-behaved models. The gate at the handler level is a hard stop that cannot be overridden by model behavior — defense in depth for smaller or less instruction-following models.

### 3.23 Chat command module decomposition (REQ-U-21)

`commands/chat.py` (593 lines) is the orchestrator — it wires together four extracted modules and drives the interactive loop. Each extracted module has direct unit tests that don't require `_interactive_loop` to run:

| File | Contents | Independently testable |
|------|----------|----------------------|
| `_chat_idea.py` | `IdeaState` enum, `IdeaSession` dataclass, `_handle_idea_command()` | Yes — no I/O |
| `_chat_compact.py` | `ContextCompactor` class — failures, nudged, disabled state; `compact()`, `should_auto_compact()`, `should_nudge()` | Yes — all deps injected |
| `_chat_display.py` | `_query_max_context`, terminal helpers, `_build_key_bindings`, confirm/ask handlers, `_make_display_callbacks`, `ChatDisplay` class | Yes — console injected |
| `_chat_tui.py` | `TUIState`, `Message`, `_ScrollableControl`, `_render_to_lines`, `build_tui_app` | Yes — `TUIState` is a plain dataclass; `_render_to_lines` is a pure function |
| `chat.py` | `_query_max_context` call, `_interactive_loop`, `chat` Click command | Integration only |

**Dependency injection pattern:** `ContextCompactor` receives `agent`, `log`, `max_ctx`, `ui`, `session`, `original_skill`, `fs_ctx`, `estimate_tokens`, `setup_terminal`, `restore_terminal` as constructor arguments. `ChatDisplay` receives `console`. This makes every compaction and display unit independently testable with mocks.

**Why:** The original 1060-line `_interactive_loop` mixed 15+ nested closures — idea state, compaction, key bindings, confirm dialogs, Live display — none testable without a TTY. The decomposition separates each concern into its own testable unit (REQ-U-21).

### 3.23 FauxProvider for test fixtures

`FauxProvider` in `testing/faux_provider.py` is a drop-in replacement for the OpenAI client that replays recorded API responses from JSONL cassette files. Implements `client.chat.completions.create(**kwargs)`. Three modes: `replay` (default — return recorded, fail on miss), `record` (call real API, save, return), `passthrough` (forward without recording). Request matching uses SHA-256 of the canonical request excluding `api_key`, `timestamp`, `x-request-id`. Cassettes live in `cli/tests/cassettes/`. `VCR_MODE=record` enables recording.

**Why:** Integration tests against real APIs are slow, expensive, and non-deterministic. Record/replay enables fast, deterministic CI. Missing cassettes fail loudly (REQ-TEST-1).

### 3.24 Prompt authoring guidelines

When writing or editing prompts in `resources/prompts/`:
- Use positive instructions. Tell the model what to do. For example: "Write the full file content" not "never write placeholder stubs."
- Keep prompts compact. Every token in the system prompt competes with the model's working memory for the task.

### 3.25 Abort-aware interrupt handling (REQ-D-13)

`request_abort()` does two things: sets the `_abort_requested` flag and closes the HTTP client on every active `AgentLoop`. Active loops register themselves in a module-level dict on `send()` entry and unregister on exit. Closing the client causes any blocked `client.chat.completions.create()` call to raise a connection error, which unblocks worker threads in `ThreadPoolExecutor`. The retry loop (`_create_with_retry`) checks the abort flag before retrying — a connection error caused by abort is not retried. Retry sleeps use `_abort_aware_sleep()` which checks the flag every 0.25s.

**Why:** `KeyboardInterrupt` is only delivered to the main thread. Worker threads blocked on HTTP calls with a 600-second read timeout are unreachable by signals. Closing the client is the only way to unblock them without `SIGKILL`. The abort flag check in the retry loop prevents the closed-client error from being retried as a transient connection failure.

### 3.26 Done guard and write nudge for develop tasks (REQ-D-5)

The `before_tool_call` hook fires for all tool calls including `done`. In develop, a `_done_guard` hook rejects `done` when zero writes have occurred — the agent receives an error message and the loop continues. A `get_follow_up_messages` hook (`_write_follow_up`) catches the other exit path: when the model produces a text-only response with no tool calls and zero writes, a user message is injected telling it to call `file(action="write")`. Limited to 2 nudges per task to prevent infinite loops. Both hooks are composed with the existing skill guard via `_composed_hook`.

**Why:** Small models (35B) fail to write files in two ways: calling `done` prematurely, and producing text-only responses that narrate code instead of calling write tools. The done guard blocks the first path; the follow-up nudge blocks the second. Together they cover all exit paths from the agent loop. The 2-nudge limit ensures the task eventually falls through to the existing retry/escalation mechanism if the model truly cannot produce tool calls.

### 3.27 Session gap marker for chat (REQ-U-23)

When resuming a chat session after 30+ minutes (`_SESSION_GAP_THRESHOLD = 1800`), `_inject_session_gap_marker()` appends two messages: a user message stating the session was resumed with a "do not continue previous actions" instruction, and an assistant acknowledgment. The elapsed time label (e.g. "2h ago") is reused from the resume summary calculation.

**Why:** Models resume stale sessions by continuing the last action in context. After 20 hours, a model seeing "let's look at the verify result" in a session that ended with file writes will attempt more file writes instead of reading VERIFY.md. The gap marker breaks the intent chain at minimal cost (2 messages, ~50 tokens).

### 3.28 Chat thinking indicator and empty response feedback (REQ-UI-14)

The thinking spinner shows "(thinking)" immediately at normal text weight (not dim). `_last_token_time` tracks when the last streaming token arrived. `on_progress` checks: if tokens were received but none in the last 1.5 seconds, the thinking spinner resumes — the user sees the model is still working during mid-stream pauses (tool call JSON generation, think-tag reasoning). When `agent.send()` returns empty text, the display checks `_tool_calls_this_turn`: if tools were called, a summary is shown; otherwise "(No response from model)" appears.

**Why:** Users see blank screens during three states: initial processing, mid-stream pauses, and empty responses after tool calls. Small models frequently pause mid-stream while building tool call JSON. Empty responses after tool calls (common with qwen35) leave users with no confirmation. Continuous visible feedback eliminates ambiguity about system state.

### 3.29 Develop post-task file list verification (REQ-D-21)

After a task succeeds (files written, before marking implemented), `_run_task` parses the `files:` list from the task frontmatter, strips `(create)`/`(modify)` annotations, and compares against `ctx.get_session_files()`. Missing files emit a `ui.warn`. The check is a warning only — it does not block the task.

**Why:** The develop agent can write different files than specified in the task, or skip files entirely, and the task still gets marked implemented. The env.list problem (agent wrote 4 vars instead of 8) would have been caught here — the task listed `env.list (create)` but the agent's output didn't match the spec. Catching this at task completion is cheaper than catching it at verify.

### 3.30 Develop agent self-review with confidence scoring (REQ-D-22)

After the agent writes at least one file, `_self_review_steering` injects a one-time user message via `get_steering_messages`: "Re-read the acceptance criteria. For each AC, confirm the code satisfies it. Score confidence 0–100%. Below 90%, fix the gaps. 90% or above, call done()." A `_self_review_injected` flag ensures it fires exactly once per task.

**Why:** The agent reads ACs at the start of the task, then writes code from memory. Details get lost — especially with small models. A self-review pass after writing forces the agent to re-read the ACs with the written code fresh in context. The confidence score creates a decision point: fix or finish. This mirrors START.md step 10.

### 3.31 Chat TUI implementation (`_chat_tui.py`) (REQ-UI-1, REQ-UI-7, REQ-UI-8, REQ-UI-15)

`_chat_tui.py` owns the full-screen `prompt_toolkit` Application for the chat command. `chat.py` drives the agent loop; `_chat_tui.py` owns terminal state and all rendering.

**Layout (HSplit, top to bottom):**

| Window | Height | Purpose |
|--------|--------|---------|
| `scrollable` | `Dimension(weight=1)` | Conversation area — fills all remaining space |
| `sep` | 1 | Dim `─` rule |
| `footer` | 1 | Persistent status bar (REQ-UI-6) |
| `spacer` | 1 | Blank line above input |
| `input_area` | 1 | `TextArea` with dynamic placeholder |

Footer is always pinned at the bottom. There is no bottom spacer — the scrollable absorbs all surplus rows.

**`_ScrollableControl`:** Subclass of `FormattedTextControl`. Intercepts `SCROLL_UP` and `SCROLL_DOWN` mouse events and returns `None` (handled) instead of `NotImplemented`. `Window._mouse_handler` calls `_scroll_up()` / `_scroll_down()` only when the control returns `NotImplemented` — returning `None` prevents `Window.vertical_scroll` from being mutated. The control then invokes `on_scroll_up` / `on_scroll_down` callbacks that adjust `_scroll_top`, the manual line-slicing offset. **Why:** `prompt_toolkit` routes mouse wheel events through `Keys.Vt100MouseEvent` → `Window._mouse_handler`, bypassing key bindings entirely. The only interception point before `Window.vertical_scroll` is modified is the control's `mouse_handler` return value.

**`_render_to_lines`:** Returns `list[list[tuple[str, str]]]` — one inner list per display line, each a list of `(style_class, text)` fragments. `_get_conv()` in `build_tui_app` slices this list to the viewport height and converts the slice to `FormattedText`. Full re-render occurs on every `app.invalidate()` call; only the slice-to-FormattedText step varies with scroll position.

**Streaming markdown cache:** `Message._rendered_cache` stores the last Rich-rendered line list; `Message._rendered_len` stores the text length at render time. `_render_to_lines` skips re-rendering when `len(text) == _rendered_len`. On stream completion (`streaming=False`), both fields reset to force a clean final render. **Why:** Rich markdown rendering at 10 Hz over a long streaming response is expensive. The length key ensures at most one render per new character, not one per tick.

**Welcome callout:** Rendered unconditionally at the top of the conversation area. Box width: `min(66, usable - 2)`. Border color: `#5a6aa8`. Background: `#13132a`. Fresh session (no messages): model name, capabilities, command reference. Resumed session: same content plus "Resuming previous conversation. /clear to start fresh." appended inside the box before the closing border.

**Message queue (`chat.py`):** `_pending_queue: list[str]` holds messages submitted while `state.busy`. `_dispatch_turn(text, app)` encapsulates the per-turn setup (`state.thinking`, `state.busy`, thread launch). The `_bg()` finally block pops and dispatches the first queued message when the turn ends. Escape calls `_pending_queue.clear()`. **Why:** `prompt_toolkit` buffers keystrokes during model processing — the operator can type freely. Without a queue, the submitted message is silently discarded.

---

## 4. Data Flows

### 4.1 Gather command

Two modes: `--path <path>` (reverse-engineer from codebase) and `--idea <id>` (generate from idea).

**Module layout:**

| File | Contents |
|------|----------|
| `commands/gather.py` | `run_gather`, `_gather_from`, `_gather_from_idea`, `_build_file_tree`, public helpers |
| `commands/_gather_pipeline.py` | Stage functions + shared constants and cache helpers |

Each of the four stage functions is independently callable and unit-testable without running the full pipeline (REQ-G-8 stage isolation):

| Function | Stage | Returns |
|----------|-------|---------|
| `_run_triage()` | 1 — categorise files | `dict[str, list[str]]` (category → file list) |
| `_run_context_build()` | 2 — summarise non-source categories | `dict[str, str]` (category → summary) |
| `_run_source_analysis()` | 3 — parallel source analysis | `dict[str, str]` (filepath → analysis) |
| `_run_consolidation()` | 4 — consolidate into REQUIREMENTS.md | `str` (final markdown) |

`_gather_from()` is a pure orchestrator: it calls these four functions in sequence and handles all persistence (ANALYSIS.md index, analysis cache, STATE.md entry). No stage logic lives in `_gather_from()`.

**--path mode** (four-stage pipeline):
```
CLI: build file tree → _run_triage (categorize) → validation pass (prune bad entries)

Stage 2 — _run_context_build (non-source categories: tests, config, infrastructure, docs, assets):
  for each non-source category with files:
    CLI: concatenate all files in category → context agent → direct response text (≤10 bullets)
    CLI: store in context_summaries[cat]
  CLI: build "Project Context" block from context_summaries

Stage 3 — _run_source_analysis (concurrent):
  for each source file:
    if file > input_limit → split into overlapping chunks → analyze each chunk separately (direct response)
                         → consolidate chunk analyses (if >1 chunk)
    else → file content injected directly into user message (zero tools) → returns requirements as direct response text
  CLI: store in source_requirements[filepath]

CLI: write .voidrift/ANALYSIS.md (index) + .voidrift/analysis/<file>.md (per-file) ← operator review

Stage 4 — _run_consolidation:
  CLI: pre-fetch REQUIREMENTS-TEMPLATE (Python call, no model tool)
  CLI: send source_requirements + context_summaries in user message to final agent (no tools)
  model: returns complete REQUIREMENTS.md content as direct response text
  CLI: strip preamble, write .voidrift/REQUIREMENTS.md
```

**--idea mode:**
```
CLI: read IDEA-{id}.md → use ANALYSIS-REQS skill + REQUIREMENTS-TEMPLATE
  → agent updates REQUIREMENTS.md with new/modified requirements
CLI: record affected REQ IDs (reqs: field) and diff in idea file
```

### 4.2 Plan command

Six-stage pipeline. Each stage uses scoped agent instances with clean message history.

Optional `--idea <id>` flag scopes planning to a single idea (REQ-IDEA-5): the idea file content is appended to REQUIREMENTS.md as context for Stage 1, all produced tasks get `idea: <id>` in frontmatter, and the manifest records the idea reference. When all tasks for an idea reach `verified`, the idea is archived automatically.

```
Preflight:
  CLI: validate REQUIREMENTS.md exists
  CLI: if --idea <id>, load idea file, gate on reqs: field present

Delta analysis (REQ-P-11, update mode only):
  Triggered when ARCHITECTURE.md + manifest.yml exist and --overwrite is not set.
  CLI: build source file listing (filenames only, respects .gitignore)
  Agent: receives REQUIREMENTS.md + ARCHITECTURE.md + file listing
  Agent: returns structured delta (implemented / unimplemented / uncertain)
  CLI: injects delta summary into Stage 1 and Stage 3 prompts

Stage 1 — Architecture (PLAN-ARCH, one agent):
  CLI: skill(action="get")(ARCH-DESIGN) + get_prompt(plan, PLAN-ARCH)
  Agent: writes ARCHITECTURE.md (system-level: modules, contracts, constraints)
  CLI: extract module list from YAML frontmatter
  CLI: recover ARCHITECTURE.md if model writes to arch/ path
  CLI: remove any arch/*.md written prematurely by Stage 1

Stage 2 — Module arch (PLAN-MODULE, one agent per module):
  CLI: _arch_summary(ARCHITECTURE.md, max_chars=4000) + module name
  Agent: writes arch/<module>.md (component internals, data models, interfaces)

Stage 3 — Task outline (PLAN-OUTLINE, one agent per module):
  CLI: ARCHITECTURE.md + arch/<module>.md + id_offset
  Agent: writes tasks/outline/<module>.md (YAML frontmatter with task list)
  CLI: parse outline, advance id_offset for next module

Stage 4 — Dependency resolution (PLAN-DEPS, one agent, multi-module only):
  CLI: concatenate all outline files
  Agent: writes tasks/outline/deps.yml (cross-module depends)
  Skipped for single-module projects

Stage 5 — Task files (PLAN-TASK, one agent per task):
  CLI: task outline entry + arch/<module>.md + valid skill list (names + descriptions)
  Prompt order: task outline first, module arch second, skill list last
  Agent: writes tasks/active/TASK-{id}.md

Post-processing:
  CLI: read task files → build tasks/manifest.yml (status, modules, dependencies)
  CLI: if --idea, inject idea: <id> into task frontmatter and manifest entries
  CLI: validate skill tags (word-overlap resolution or strip)
  CLI: remove tasks/outline/ intermediates

Stage 6 — README (PLAN-README, one agent):
  CLI: REQUIREMENTS.md + ARCHITECTURE.md + README-TEMPLATE
  Agent: writes README.md (user manual: install, configure, use)
```

### 4.3 Develop command

```
CLI: load tasks/manifest.yml → find dispatchable tasks (planned + deps met)
  capture git snapshot once (branch, commits, changed files) → shared string
  dispatch sub-agents concurrently (up to model.concurrency):
    each agent receives task file content + git context as prompt
    → file(action="write")(path, content)
    → done()
  CLI: verify write occurred → set status=implemented in manifest
  CLI: if no write → retry → if still no write → escalate to architect
  CLI: loop until no dispatchable tasks remain
  Display: DevelopDashboard (table) when concurrent, spinner when sequential
```

### 4.4 Chat session persistence

```
voidrift chat → load .voidrift/chat-session.jsonl if exists → restore messages → resume
  each turn: append user + assistant messages to JSONL (append-only)
  /compact → append compaction entry; subsequent loads reconstruct from boundary
  /clear   → delete session file, reset agent to fresh state
```

Session file is project-scoped append-only JSONL with `id`/`parentId` tree structure. Compaction entries act as reconstruction boundaries. Message sanitization on restore strips empty content and orphaned tool calls.

### 4.5 Idea refinement (chat)

```
/idea       → create new IDEA-{id}.md, inject IDEA prompt overlay
/idea <id>  → load existing IDEA-{id}.md, resume refinement
  Agent drives: intake → exploration → shaping → summary
  All chat tools remain available during idea flow
/done       → operator picks now/next/later, agent writes final idea file
```

Ideas are operator-owned backlog items. They do not feed into plan automatically.
The operator acts on them through chat — writing requirements and task tickets manually.

### 4.5 Verify command

```
Stage 1 — Plan agent:
  Preflight: .voidrift/REQUIREMENTS.md must exist
  CLI: load REQUIREMENTS.md, ARCHITECTURE.md, tasks/manifest.yml, arch/* → inject into system prompt
  Plan agent:
    tools: cmd="verify-plan" {file(action="read"), file(action="read"), file(action="write")}
    writes: .voidrift/VERIFY-PLAN.md (self-contained test cases per testable requirement)
    each ITEM: requirement text, user story, system context, credentials, numbered steps, expected result
    non-testable criteria: ITEM-N [SKIP] with reason

  CLI: run test_bootstrap if ARCHITECTURE.md has test_bootstrap: field (subprocess.run)
  CLI: process(action="start")(startup_command) → process handle
  CLI: wait_for_ready(handle, strategy=http|port|log_pattern, target, timeout)

Stage 2 — Concurrent sub-agents (ThreadPoolExecutor, max_workers=get_concurrency()):
  For each ITEM in VERIFY-PLAN.md (non-SKIP):
    sub-agent:
      tools: cmd="verify-execute" {file(action="read"), file(action="write"),
              process(action="read_output"), http, shell,
              browser(action="navigate"), browser(action="screenshot"), browser(action="click"), browser(action="get_text")}
      context: ITEM content verbatim (self-contained, no further assembly)
      PASS → returns without writing bug file
      FAIL → writes .voidrift/bugs/<ITEM-ID>.md with full evidence
  Orchestrator: PASS if no bugs/<ITEM-ID>.md exists, FAIL otherwise

Stage 3 — Report:
  CLI: write .voidrift/VERIFY.md (summary table, per-item results, verdict)
  CLI: append_state(verify, run_id, verdict, counts)

try/finally: stop_all(), clear_sessions(), close_all_sessions()
```

### 4.6 Deploy command

```
Preflight: REQUIREMENTS.md and ARCHITECTURE.md must exist

CLI: determine last release tag (vX.Y.Z) from git
CLI: read history.log lines since last tag
  → if no lines, exit "nothing to deploy"

Version bump:
  Agent: receives task summary + requirements → returns "major", "minor", or "patch"
  CLI: compute new version, prompt operator to confirm or override

Changelog:
  CLI: build changelog entry from history.log (grouped by module)
  CLI: append to CHANGELOG.md (or create)

Git tag:
  CLI: git tag -a v{version} -m <changelog entry>

Conditional IaC (if ARCHITECTURE.md mentions infrastructure):
  Agent: generate or review IaC files via file(action="write")

Post-deploy hook (if ARCHITECTURE.md has post_deploy: field):
  CLI: run shell command with $VERSION in env
```

### 4.7 Agent system prompt construction

```
system_prompt =
  get_prompt("system", "CONTEXT")    # command lifecycle table, artifact boundaries
  + skill(action="get")("<command-skill>")      # methodology — how to think
  + get_prompt("<command>", "<stage>")  # stage instructions — what to do
  + injected_context                  # task details, analyses, specs — what to work with
```

### 4.8 Agent loop

```
send(user_message)
  → _run_loop():
    while tools present:
      [budget check — REQ-ARCH-13]
      [transform_context hook — REQ-ARCH-14]
      [apply_cache_control for Anthropic — REQ-ARCH-19]
      [on_payload hook — REQ-ARCH-14]
      _stream_response() / _sync_response()  [with retry + jitter, REQ-ARCH-10]
        ↓ context_length_error? → reactive_compact [REQ-ARCH-12]
        ↓ truncated text? → max_tokens_recovery [REQ-ARCH-11]
        ↓ truncated tool_calls? → discard + re-emit prompt [REQ-ARCH-11]
        ↓ no tool_calls? → follow_up hooks/queue → return text
      [stall detection — nudge or break]
      deduplicate identical tool calls [REQ-ARCH-16]
      partition tool calls into batches [REQ-ARCH-16]
        concurrent batch: ThreadPoolExecutor for read tools
        serial batch: one at a time for write tools
      for each tool call:
        [normalize args — REQ-ARCH-17]
        [before_tool_call hook — REQ-ARCH-14]
        execute handler
        [after_tool_call hook — REQ-ARCH-14]
      [steering hooks/queue — REQ-ARCH-14]
      [abort/budget/max_turns/stop_check — REQ-ARCH-14]
      [ITERATION log — REQ-ARCH-18]
    [LOOP_EXIT log — REQ-ARCH-18]
    force final text call (stall/stop recovery)
    return text
  finally: client.close() [REQ-ARCH-21]
```

Key agent loop features:
- **Hook callbacks** (REQ-ARCH-14): `transform_context`, `before_tool_call`, `after_tool_call`, `get_steering_messages`, `get_follow_up_messages`, `stop_check`, `on_payload`. All optional, default None.
- **Thread-safe queues**: `steer(messages)` and `follow_up(messages, drain)` for external injection.
- **LoopState**: `messages`, `turn_count`, `input_tokens_total`, `output_tokens_total`, `tools_called_this_turn` — passed to state-aware hooks.
- **Concurrent tool execution** (REQ-ARCH-16): Identical tool calls deduplicated before execution — same name and arguments executed once, result mapped to all IDs. Consecutive read-tool calls batched via ThreadPoolExecutor.
- **Argument normalization** (REQ-ARCH-17): Path stripping, content list→string, logged as `[TOOL_NORMALIZE]`.
- **Prompt caching** (REQ-ARCH-19): Anthropic system messages get `cache_control` markers. Cache hits logged.
- **Provider-aware streaming usage** (REQ-ARCH-20): `stream_options: {include_usage: true}` injected in `build_request()` only for `openai`, `anthropic`, `gemini`. Generic endpoints receive a clean wire request.
- **Transition logging** (REQ-ARCH-18): `[ITERATION]` at every continue, `[LOOP_EXIT]` with accurate cumulative `total_input`/`total_output` at every return.
- **Security**: Command classification (REQ-SEC-2) in `shell`. Path sandboxing (REQ-SEC-1) in all file tools.

---

## 5. State and Persistence

Two log roots, two intents:
- **`~/.voidrift/logs/`** — framework logs. What the framework itself did. Persist across projects.
- **`<project>/.voidrift/logs/`** — project logs. What the framework did to this project. Scoped, prunable.

| Store | Location | Contents | Lifetime |
|---|---|---|---|
| Project artifacts | `<project>/.voidrift/` | REQUIREMENTS.md, ANALYSIS.md, analysis/, ARCHITECTURE.md, tasks/manifest.yml, tasks/active/TASK-*.md, arch/, VERIFY-PLAN.md, VERIFY.md, bugs/ | Project |
| Command logs | `<project>/.voidrift/logs/` | `<command>-<timestamp>.log` — full agent dialog | Until `voidrift prune` |
| System log | `~/.voidrift/logs/voidrift.log` | CLI invocations, command outcomes | Rotating (1MB × 5) |

| Model config | `~/.worker-cli/models.yml` | All model aliases (local, cloud, gateway) | Maintained by worker-cli |
| Active container | `~/.worker-cli/.active-container` | Running model alias (line 2) | Maintained by worker-cli |
| State history | `<project>/.voidrift/STATE.md` | Command run history, file manifests | Append-only |
