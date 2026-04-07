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

### 2.1 CLI (`cli/`)

**Entry point:** `voidrift_cli.main:cli`

The CLI is the orchestration layer. It owns:
- Framework command execution (Gather → Plan → Develop → Deploy → Verify → Chat)
- Command implementations in `commands/` sub-package: `gather.py`, `plan.py`, `develop.py`, `deploy.py`, `verify.py`, `chat.py`, `skills.py`
- Agent loop (message routing, tool dispatch, hooks, stall detection, think-tag stripping, retry with jitter, model fallback)
- Token budget tracking (`token_budget.py`) — shared across agents per command run
- Model alias resolution (models file at configured path)
- Local agent tools (`tools/` sub-package): filesystem, bash, process management, HTTP client, browser automation, security
- Interactive UI (spinners, progress, dashboard, streaming output, `/compact`)
- System log (`~/.voidrift/logs/voidrift.log`)

Agent tools live in `cli/src/voidrift_cli/tools/`:
- `filesystem.py` — file tools (`write_source_file`, `read_source_file`, `edit_source_file`, `write_framework_file`, `read_framework_file`, `web_fetch`, `ask_user_question`), `WriteContext` with path sandboxing, protected paths, snapshots, diff stats, line pagination (REQ-FSZ-1), byte guard (REQ-FSZ-5)
- `bash.py` — `BashConfig` dataclass and `create_run_command` factory for per-command `run_command` handlers (REQ-SEC-4). Develop agents get a narrow allowlist (build, test, lint); chat agents get broader access; verify agents get full scope. Two-layer security: per-command `allowed_patterns` checked first, then global `classify_command`
- `process_manager.py` — subprocess lifecycle (`start_process`, `stop_process`, `wait_for_ready`, `read_process_output`, `stop_all`) for verify sub-agents
- `security.py` — `classify_command()` for shell command risk assessment (safe/warn/block)
- `http_client.py` — stateful HTTP client (`http_request`, `clear_sessions`) with per-session cookie and auth header persistence
- `browser.py` — Playwright-based browser automation (`browser_navigate`, `browser_screenshot`, `browser_click`, `browser_get_text`, `close_all_sessions`)

The CLI does **not** manage containers, SSH connections, or gateway processes. Every model is just a `(base_url, api_key, model_id)` tuple.

### 2.2 Framework Resources (`resources/`)

Static guidance loaded at command init:
- `skills/` — methodology guidance (16 files, determined dynamically from directory contents; includes ANALYSIS-REQS, ARCH-DESIGN, BACKEND-ENG, CLOUD-OPS, QUALITY-QA, RELIABILITY-ENG, SECURITY-TRUST, SYSTEMS-ENG, WEB-RESEARCH, WORKFLOW, and others)
- `templates/` — output structure templates (REQUIREMENTS-TEMPLATE, ARCHITECTURE-TEMPLATE, etc.)
- `prompts/system.md` — shared framework context (command lifecycle table, artifact ownership); prepended to every agent's system prompt across all commands
- `prompts/<command>.md` — command-specific stage instructions (gather.md, plan.md, develop.md, chat.md, deploy.md, verify.md, skills.md)

Synced to `~/.voidrift/resources/` via `make sync`.

> **Note:** The former `resources/agents/` role files (ANALYST.md, ARCHITECT.md, DEVELOPER.md) have been removed. A single command can have multiple distinct agent invocations, each shaped by its specific command prompt — static role files were too coarse-grained and duplicated context already in `system.md`.

---

## 3. Key Design Decisions

### 3.1 One agent per unit of work

Each agent (gather source analysis, plan, develop task) starts with a clean message history. Shared state flows through in-memory dicts (`source_requirements`, `context_summaries`) that the CLI owns; only the final pass output is written to disk. **Why:** A single agent accumulating 50 file analyses would hit the context window before the last file. Per-unit agents keep each context small and focused; CLI-owned persistence eliminates tool call JSON overhead (REQ-ARCH-7, REQ-G-8).

### 3.2 Streaming vs non-streaming

Gather and chat use `stream=True` with `stream_options: {include_usage: True}` for live token telemetry and responsive UX. Plan, develop, deploy, and verify use `stream=False` for reliable tool call parsing — vLLM's streaming parser does not reliably separate text from tool calls. Token usage (prompt tokens, completion tokens, context %) is captured from both paths and forwarded to the `on_progress` callback. **Why:** Streaming in gather surfaces per-call telemetry across all four stages. Streaming in chat provides token-by-token display. Non-streaming in automated commands ensures tool call JSON is parsed correctly (REQ-ARCH-4, REQ-UI-10).

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
| `max_read_lines` | No | 2000 | Max lines returned by `read_source_file` |
| `max_input_chars` | No | 0 (unlimited) | Max input chars for gather chunking |
| `concurrency` | No | 1 | Max concurrent task agents in develop |
| `fallback` | No | — | Alias of fallback model on 429/5xx retry exhaustion (REQ-MC-4) |
| `max_input_tokens` | No | — | Token budget: max input tokens per command run (REQ-ARCH-13) |
| `max_output_tokens` | No | — | Token budget: max output tokens per command run (REQ-ARCH-13) |

The `defaults:` section provides fallback values for all optional fields. Each model entry inherits defaults and can override any field.

### 3.5 `max_context` in config, not code

Context window sizes live in the models file as `max_context:` fields. No lookup table in the CLI code. **Why:** Hardcoded tables go stale silently. Config files are visible, auditable, and operator-controlled (REQ-MC-3).

### 3.6 Tool choice modes

Automated commands: `tool_choice: "required"` + auto-injected `done` tool. Chat: `tool_choice: "auto"`, no `done` injection. **Why:** `required` ensures automated commands call tools rather than narrating. `auto` is necessary for chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text (REQ-ARCH-4).

### 3.7 Per-command agent tool visibility

Each command sees only the agent tools relevant to its role (REQ-ARCH-9). Gather cannot write source files. Plan cannot read source files. Develop cannot write `.voidrift/` artifacts. The boundary is structural — an agent tool absent from the list simply cannot be called, no runtime guard needed. Skills can further restrict tools via `allowed_tools` frontmatter (REQ-SKL-9) — enforced by `before_tool_call` hook. Restrictions are additive (can only reduce, never expand).

### 3.8 Separate framework and command logs

`~/.voidrift/logs/voidrift.log` records CLI invocations and command outcomes — always written to `~/.voidrift/` regardless of `VOIDRIFT_HOME`. `<project>/.voidrift/logs/<command>-<timestamp>.log` records the full per-run agent dialog. `<command>-<timestamp>.errors.jsonl` records structured error events alongside the command log. `ErrorTracker` accumulates errors during a run and displays a Rich summary table at completion (REQ-LOG-6). **Why:** Framework logs are user-global (one across all projects); command logs are project-scoped (one per run). Structured error JSONL enables post-mortem analysis without grepping verbose logs.

### 3.9 Module-level registries for transient tool state

`process_manager.py`, `http_client.py`, and `browser.py` each hold their transient state (process handles, HTTP sessions, browser sessions) in module-level dicts (`_registry`, `_sessions`). The orchestrator calls `stop_all()`, `clear_sessions()`, and `close_all_sessions()` in a `try/finally` block to release all state after each run.

**Why:** The CLI is single-process and single-run: one `run_verify()` or `run_develop()` call per process. A module-level dict is simpler than an injected dependency, carries zero overhead, and is trivially testable by patching. Lifecycle is controlled by the orchestrator, not by individual sub-agents, which ensures cleanup happens exactly once regardless of how many sub-agents ran. This would be revisited if the CLI ever supports concurrent top-level commands.

### 3.10 Hook-based agent loop extensibility

The agent loop accepts optional callback hooks (`transform_context`, `before_tool_call`, `after_tool_call`, `stop_check`, `get_steering_messages`, `get_follow_up_messages`, `on_payload`) as fields on `AgentLoop`. Thread-safe message queues (`steer()`, `follow_up()`) allow external injection. A `LoopState` dataclass carries `messages`, `turn_count`, `input_tokens_total`, `output_tokens_total`, `tools_called_this_turn` to state-aware hooks.

**Why:** Command orchestrators need to customize loop behavior (context snipping, tool interception, phase chaining, budget stops) without modifying loop internals. Hooks as optional fields on the existing Pydantic model keep the interface flat — no separate config dataclass, no structural rewrite. All hooks default to None; the loop behaves identically when no hooks are set.

### 3.11 Defense-in-depth for tool execution

File tools validate paths via `Path.resolve().relative_to()` (REQ-SEC-1). Write tools check a `protected_paths` set and detect external file modifications via mtime comparison (REQ-D-19). `run_command` classifies shell commands via regex patterns (REQ-SEC-2) — block/warn/safe. HTTP tools (`web_fetch`, `http_request`) resolve hostnames and check against blocked IP ranges (REQ-SEC-3) — private, link-local, CGNAT blocked; loopback allowed for local dev; `ssrf_allow_list` in config overrides. Tool arguments are normalized before execution (REQ-ARCH-17). All blocks are logged.

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

`memory.py` provides `MemoryManager` with two layers: project (`.voidrift/memory/`) and global (`~/.voidrift/memory/`). Each entry is a markdown file with YAML frontmatter. A `MEMORY.md` index in each layer lists entries by name and description. At chat init (non-bare), the combined index is injected into the system prompt — names and descriptions only, not full content. `read_memory`, `write_memory`, and `list_memory` tools are available in chat only. Project entries override global entries with the same name, matching the skill resolution pattern.

**Why:** Chat sessions accumulate project knowledge lost on terminal close. Memory persists conventions and decisions across sessions without polluting context — only the index is injected, full content loaded on demand (REQ-MEM-1).

### 3.18 Conversation history search

`ChatSession.search_entries(query, limit)` in `session.py` searches all JSONL entries (including those before compaction boundaries) by case-insensitive substring match on message content. Returns up to `limit` (default 5, max 10) entries newest-first, each with timestamp, role, and content truncated to 2000 characters. The `search_history` agent tool is registered in `build_local_tools` for the chat command only.

**Why:** After compaction, specific details from earlier turns are lost. Memory covers cross-session facts, but intra-session search of raw history fills the gap when the agent needs exact wording from a compacted exchange (REQ-U-18).

### 3.19 Document format extraction

`tools/document.py` provides `read_document(path, project_root)` that extracts text from PDF (via `pymupdf`), DOCX (via `python-docx`), and XLSX (via `openpyxl`). Format detected by file extension. All three are soft dependencies — missing libraries return an error with the pip install command. DOCX preserves heading hierarchy as markdown headings. XLSX returns one markdown table per sheet. Path validation uses the same project-root sandboxing as source file tools. The `read_document` agent tool is registered for chat and gather commands.

**Why:** Enterprise requirements arrive as Word/PDF. Extracting text into markdown lets gather and chat process them without manual conversion. Soft dependencies keep the core CLI lightweight (REQ-U-19).

### 3.20 Structured code analysis

`tools/code_analysis.py` provides `code_analysis(path, project_root)` that parses source files via tree-sitter and returns compact JSON: language, line count, imports, exported symbols (name, type, line), and complexity (branch point count). Language detected by file extension mapped to tree-sitter grammar names. Covers Python, JavaScript, TypeScript, Rust, Go, Java, C, C++, Ruby. Tree-sitter and per-language grammars are soft dependencies. Available in chat and gather.

**Why:** Prompt-based analysis requires the model to spend tokens parsing file structure. Tree-sitter provides machine-parsed facts (imports, symbols, complexity) directly, improving accuracy for large files and reducing context consumption (REQ-U-20).

### 3.21 FauxProvider for test fixtures

`FauxProvider` in `testing/faux_provider.py` is a drop-in replacement for the OpenAI client that replays recorded API responses from JSONL cassette files. Implements `client.chat.completions.create(**kwargs)`. Three modes: `replay` (default — return recorded, fail on miss), `record` (call real API, save, return), `passthrough` (forward without recording). Request matching uses SHA-256 of the canonical request excluding `api_key`, `timestamp`, `x-request-id`. Cassettes live in `cli/tests/cassettes/`. `VCR_MODE=record` enables recording.

**Why:** Integration tests against real APIs are slow, expensive, and non-deterministic. Record/replay enables fast, deterministic CI. Missing cassettes fail loudly (REQ-TEST-1).

---

## 4. Data Flows

### 4.1 Gather command

Two modes: `--path <path>` (reverse-engineer from codebase) and `--idea <id>` (generate from idea).

**--path mode** (four-stage pipeline):
```
CLI: build file tree → triage agent (categorize) → validation pass (prune bad entries)

Stage 2 — Context Build (non-source categories: tests, config, infrastructure, docs, assets):
  for each non-source category with files:
    CLI: concatenate all files in category → context agent → direct response text (≤10 bullets)
    CLI: store in context_summaries[cat]
  CLI: build "Project Context" block from context_summaries

Stage 3 — Source Analysis (concurrent):
  for each source file:
    if file > input_limit → split into overlapping chunks → analyze each chunk separately (direct response)
                         → consolidate chunk analyses (if >1 chunk)
    else → agent reads via read_source_file() → returns requirements as direct response text
  CLI: store in source_requirements[filepath]

CLI: write .voidrift/ANALYSIS.md (index) + .voidrift/analysis/<file>.md (per-file) ← operator review

Stage 4 — Final Pass:
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
  CLI: get_skill(ARCH-DESIGN) + get_prompt(plan, PLAN-ARCH)
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
    → write_source_file(path, content)
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
    tools: cmd="verify-plan" {read_framework_file, read_source_file, write_framework_file}
    writes: .voidrift/VERIFY-PLAN.md (self-contained test cases per testable requirement)
    each ITEM: requirement text, user story, system context, credentials, numbered steps, expected result
    non-testable criteria: ITEM-N [SKIP] with reason

  CLI: run test_bootstrap if ARCHITECTURE.md has test_bootstrap: field (subprocess.run)
  CLI: start_process(startup_command) → process handle
  CLI: wait_for_ready(handle, strategy=http|port|log_pattern, target, timeout)

Stage 2 — Concurrent sub-agents (ThreadPoolExecutor, max_workers=get_concurrency()):
  For each ITEM in VERIFY-PLAN.md (non-SKIP):
    sub-agent:
      tools: cmd="verify-execute" {read_framework_file, write_framework_file,
              read_process_output, http_request, run_command,
              browser_navigate, browser_screenshot, browser_click, browser_get_text}
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
  Agent: generate or review IaC files via write_source_file()

Post-deploy hook (if ARCHITECTURE.md has post_deploy: field):
  CLI: run shell command with $VERSION in env
```

### 4.7 Agent system prompt construction

```
system_prompt =
  get_prompt("system", "CONTEXT")    # command lifecycle table, artifact boundaries
  + get_skill("<command-skill>")      # methodology — how to think
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
        ↓ truncated? → max_tokens_recovery [REQ-ARCH-11]
        ↓ no tool_calls? → follow_up hooks/queue → return text
      [stall detection — nudge or break]
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
```

Key agent loop features:
- **Hook callbacks** (REQ-ARCH-14): `transform_context`, `before_tool_call`, `after_tool_call`, `get_steering_messages`, `get_follow_up_messages`, `stop_check`, `on_payload`. All optional, default None.
- **Thread-safe queues**: `steer(messages)` and `follow_up(messages, drain)` for external injection.
- **LoopState**: `messages`, `turn_count`, `input_tokens_total`, `output_tokens_total`, `tools_called_this_turn` — passed to state-aware hooks.
- **Concurrent tool execution** (REQ-ARCH-16): Consecutive read-tool calls batched via ThreadPoolExecutor.
- **Argument normalization** (REQ-ARCH-17): Path stripping, content list→string, logged as `[TOOL_NORMALIZE]`.
- **Prompt caching** (REQ-ARCH-19): Anthropic system messages get `cache_control` markers. Cache hits logged.
- **Transition logging** (REQ-ARCH-18): `[ITERATION]` at every continue, `[LOOP_EXIT]` at every return.
- **Security**: Command classification (REQ-SEC-2) in `run_command`. Path sandboxing (REQ-SEC-1) in all file tools.

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
