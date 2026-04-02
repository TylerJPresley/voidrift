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
- Framework command execution (Gather → Plan → Develop → Deploy → Verify)
- Agent loop (message routing, tool dispatch, stall detection, think-tag stripping, retry)
- Model alias resolution (models file at configured path)
- Local agent tools (`tools/` sub-package): filesystem, process management, HTTP client, browser automation
- Interactive UI (spinners, progress, streaming output, `/compact`)
- System log (`~/.voidrift/logs/voidrift.log`)

Agent tools live in `cli/src/voidrift_cli/tools/`:
- `__init__.py` — filesystem tools (`write_source_file`, `read_source_file`, `write_framework_file`, `read_framework_file`, `web_fetch`, etc.)
- `process_manager.py` — subprocess lifecycle (`start_process`, `stop_process`, `wait_for_ready`, `read_process_output`, `run_command`, `stop_all`)
- `http_client.py` — stateful HTTP client (`http_request`, `clear_sessions`) with per-session cookie and auth header persistence
- `browser.py` — Playwright-based browser automation (`browser_navigate`, `browser_screenshot`, `browser_click`, `browser_get_text`, `close_all_sessions`)

The CLI does **not** manage containers, SSH connections, or gateway processes. Every model is just a `(base_url, api_key, model_id)` tuple.

### 2.2 Framework Resources (`resources/`)

Static guidance loaded at command init:
- `skills/` — methodology guidance (SYSTEMS-ENG, QUALITY-QA, ARCH-DESIGN, RELIABILITY-ENG, PROD-STRATEGY, CLOUD-OPS, ANALYSIS-REQS)
- `templates/` — output structure templates (REQUIREMENTS-TEMPLATE, ARCHITECTURE-TEMPLATE, etc.)
- `prompts/system.md` — shared framework context (command lifecycle table, artifact ownership); prepended to every agent's system prompt across all commands
- `prompts/<command>.md` — command-specific stage instructions (gather.md, plan.md, develop.md, chat.md, automate.md, verify.md)

Synced to `~/.voidrift/resources/` via `make sync`.

> **Note:** The former `resources/agents/` role files (ANALYST.md, ARCHITECT.md, DEVELOPER.md) have been removed. A single command can have multiple distinct agent invocations, each shaped by its specific command prompt — static role files were too coarse-grained and duplicated context already in `system.md`.

---

## 3. Key Design Decisions

### 3.1 One agent per unit of work

Each agent (gather source analysis, plan, develop task) starts with a clean message history. Shared state flows through in-memory dicts (`source_requirements`, `context_summaries`) that the CLI owns; only the final pass output is written to disk. **Why:** A single agent accumulating 50 file analyses would hit the context window before the last file. Per-unit agents keep each context small and focused; CLI-owned persistence eliminates tool call JSON overhead (REQ-ARCH-7, REQ-G-8).

### 3.2 Streaming with usage capture for all commands

All framework commands and chat use `stream=True` with `stream_options: {include_usage: True}`. Token usage (prompt tokens, completion tokens, context %) arrives in the final chunk and is forwarded to the `on_progress` callback. **Why:** Streaming surfaces per-call telemetry across every agent stage — tool-call loops included — not just for chat. This drives context pressure warnings (ctx ≥ 80%) and the live spinner stats for all commands (REQ-UI-10). The `_sync_response()` path is retained for callers that explicitly set `stream=False`.

### 3.3 Local agent tools in the CLI

Agent tools live in `cli/src/voidrift_cli/tools/` (a Python package). These run in-process in the CLI via the OpenAI tools API — no subprocess, no server. **Why:** The CLI always runs on the workstation where the project lives. Keeping tools in the CLI process eliminates round-trip latency and simplifies cleanup (process registry, HTTP sessions, browser sessions all released in the same process).

The `tools/` package was split out from `tools.py` to support multiple tool modules (filesystem, process, HTTP, browser) without naming conflicts.

### 3.4 Single external models file

The CLI reads all model definitions from a single file maintained by an external tool (worker-cli). The path is configurable via `models_file` in `config.yml` (default `~/.worker-cli/models.yml`). Each entry is self-contained with its own connection details. **Why:** Voidrift is model-agnostic — it doesn't care how models are provisioned. One file, one source of truth, no merging (REQ-MC-1).

### 3.6 `max_context` in config, not code

Context window sizes live in the models file as `max_context:` fields. No lookup table in the CLI code. **Why:** Hardcoded tables go stale silently. Config files are visible, auditable, and operator-controlled (REQ-MC-3).

### 3.6 Tool choice modes

Deployd commands: `tool_choice: "required"` + auto-injected `done` tool. Chat: `tool_choice: "auto"`, no `done` injection. **Why:** `required` ensures automated commands call tools rather than narrating. `auto` is necessary for chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text (REQ-ARCH-4).

### 3.7 Per-command agent tool visibility

Each command sees only the agent tools relevant to its role (REQ-ARCH-9). Gather cannot write source files. Plan cannot read source files. Develop cannot write `.voidrift/` artifacts. The boundary is structural — an agent tool absent from the list simply cannot be called, no runtime guard needed.

### 3.8 Separate framework and command logs

`~/.voidrift/logs/voidrift.log` records CLI invocations and command outcomes — always written to `~/.voidrift/` regardless of `VOIDRIFT_HOME`. `<project>/.voidrift/logs/<command>-<timestamp>.log` records the full per-run agent dialog. **Why:** Framework logs are user-global (one across all projects); command logs are project-scoped (one per run). Keeping them separate avoids mixing operational telemetry with agent conversation history (REQ-LOG-4, REQ-LOG-5).

### 3.9 Module-level registries for transient tool state

`process_manager.py`, `http_client.py`, and `browser.py` each hold their transient state (process handles, HTTP sessions, browser sessions) in module-level dicts (`_registry`, `_sessions`). The orchestrator calls `stop_all()`, `clear_sessions()`, and `close_all_sessions()` in a `try/finally` block to release all state after each run.

**Why:** The CLI is single-process and single-run: one `run_verify()` or `run_develop()` call per process. A module-level dict is simpler than an injected dependency, carries zero overhead, and is trivially testable by patching. Lifecycle is controlled by the orchestrator, not by individual sub-agents, which ensures cleanup happens exactly once regardless of how many sub-agents ran. This would be revisited if the CLI ever supports concurrent top-level commands.

---

## 4. Data Flows

### 4.1 Gather command

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

### 4.2 Plan command

```
CLI: create planner agent → get_skill(ARCH-DESIGN)
                          → get_prompt(plan, PLAN)
                          → write_framework_file(ARCHITECTURE.md)
                          → write_framework_file(TASKS.md)
                          → write_framework_file(arch/<module>.md) × N
CLI: parse TASKS.md → create task files in tasks/active/TASK-{id}.md
CLI: build tasks/manifest.yml (status, modules, dependencies)
CLI: validate skill tags in task files, strip invalid ones
```

### 4.3 Develop command

```
CLI: load tasks/manifest.yml → find dispatchable tasks (planned + deps met)
  dispatch sub-agents concurrently (up to model.concurrency):
    each agent receives task file content as prompt
    → write_source_file(path, content)
    → done()
  CLI: verify write occurred → set status=implemented in manifest
  CLI: if no write → retry → if still no write → escalate to architect
  CLI: loop until no dispatchable tasks remain
```

### 4.4 Idea refinement (chat)

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
  CLI: load REQUIREMENTS.md, ARCHITECTURE.md, TASKS.md, spec/*, arch/* → inject into system prompt
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

### 4.5 Agent system prompt construction

```
system_prompt =
  get_prompt("system", "CONTEXT")    # command lifecycle table, artifact boundaries
  + get_skill("<command-skill>")      # methodology — how to think
  + get_prompt("<command>", "<stage>")  # stage instructions — what to do
  + injected_context                  # task details, analyses, specs — what to work with
```

### 4.6 Agent loop

```
send(user_message)
  → _run_loop():
    while tools present:
      _stream_response()  [with retry, REQ-ARCH-10]
        ↓ tool_calls?
      dispatch each tool call
        ↓ done() called?
      final text call (no tools)
    return text
```

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
