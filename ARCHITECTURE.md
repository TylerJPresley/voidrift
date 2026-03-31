# VoidRift Architecture

**Local-first Agentic Development Framework**

This document describes the bounded contexts, component responsibilities, and key design decisions for the VoidRift framework itself. For a quickstart, see [README.md](README.md).

---

## 1. System Context

VoidRift orchestrates AI models to produce a deployable project from requirements alone. The operator runs `voidrift` on a workstation. Models run either locally (GPU worker node via vLLM), through Kiro Gateway, or against cloud APIs. All three look identical to the CLI: an OpenAI-compatible endpoint at a URL.

```
Operator
  │
  ▼
voidrift CLI  ──reads──►  ~/.voidrift/
  │                       models.yml
  │                       resources/
  │
  ├── HTTP ──►  Local vLLM (GPU worker node)
  ├── HTTP ──►  Kiro Gateway
  └── HTTPS ►  Cloud APIs (Anthropic, Google)

worker CLI  ──SSH──►  Worker Node (Docker, GPU)
```

---

## 2. Components

### 2.1 CLI (`cli/`)

**Entry point:** `voidrift_cli.main:cli`

The CLI is the orchestration layer. It owns:
- Framework command execution (Gather → Plan → Develop → Automate → Verify)
- Agent loop (message routing, tool dispatch, stall detection, think-tag stripping, retry)
- Model alias resolution (`models.yml` + `worker-models.yml`)
- Local filesystem tools (`write_source_file`, `read_source_file`, etc.)
- Interactive UI (spinners, progress, streaming output, `/compact`)
- System log (`~/.voidrift/logs/voidrift.log`)

The CLI does **not** manage containers, SSH connections, or gateway processes. Every model is just a `(base_url, api_key, model_id)` tuple.

### 2.2 Worker CLI (`worker-cli/`)

**Entry point:** `voidrift_worker.main:cli`

Manages the GPU worker node over SSH. It owns:
- Container lifecycle (`worker start/stop/status`)
- Model weight management (`worker models list/add/remove`)
- Image source management (`worker images list/add/update`)
- Kiro Gateway lifecycle (`worker kiro start/stop/status`)
- Worker health checks (`worker check`)

The Worker CLI is installed independently from the VoidRift CLI and has no import dependency on it.

### 2.3 Framework Resources (`resources/`)

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

### 3.2 Non-streaming for automated commands

Gather synthesis, plan, and develop use `stream=False`. Chat uses streaming. **Why:** vLLM's streaming parser does not reliably separate text from tool calls when both appear in the same response. Non-streaming allows vLLM to parse the complete response at once (REQ-G-12).

### 3.3 Local filesystem tools in the CLI

`write_source_file`, `read_source_file`, `write_framework_file`, `read_framework_file` live in `cli/src/voidrift_cli/tools.py`. These are agent tools exposed via the OpenAI tools API — they run in-process in the CLI, not as a separate server. **Why:** The CLI always runs on the workstation where the project lives. Keeping tools in the CLI process eliminates the subprocess overhead and round-trip latency of a separate server.

### 3.4 `worker-models.yml` is the source of truth for local models

The CLI auto-discovers local models from `worker-models.yml` without requiring duplicate entries in `models.yml`. Explicit `models.yml` entries take precedence for overrides. **Why:** `worker models add` already maintains `worker-models.yml`. Requiring operators to also edit `models.yml` adds toil and introduces drift (REQ-MC-1).

### 3.6 `max_context` in config, not code

Cloud model context window sizes live in `models.yml` as `max_context:` fields. No lookup table in the CLI code. **Why:** Hardcoded tables go stale silently. Config files are visible, auditable, and operator-controlled (REQ-MC-3).

### 3.6 Tool choice modes

Automated commands: `tool_choice: "required"` + auto-injected `done` tool. Chat: `tool_choice: "auto"`, no `done` injection. **Why:** `required` ensures automated commands call tools rather than narrating. `auto` is necessary for chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text (REQ-ARCH-4).

### 3.7 Per-command agent tool visibility

Each command sees only the agent tools relevant to its role (REQ-ARCH-9). Gather cannot write source files. Plan cannot read source files. Develop cannot write `.voidrift/` artifacts. The boundary is structural — an agent tool absent from the list simply cannot be called, no runtime guard needed.

### 3.8 Separate framework and command logs

`~/.voidrift/logs/voidrift.log` records CLI invocations and command outcomes — always written to `~/.voidrift/` regardless of `VOIDRIFT_HOME`. `<project>/.voidrift/logs/<command>-<timestamp>.log` records the full per-run agent dialog. **Why:** Framework logs are user-global (one across all projects); command logs are project-scoped (one per run). Keeping them separate avoids mixing operational telemetry with agent conversation history (REQ-LOG-4, REQ-LOG-5).

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
CLI: validate skill tags in TASKS.md, strip invalid ones
```

### 4.3 Develop command

```
CLI: load TASKS.md → for each module (concurrent):
  create developer agent → get_next_task(module)
                         → read_framework_file(arch/<module>.md)
                         → read_framework_file(spec/<module>.md)
                         → write_source_file(path, content)
  CLI: verify write occurred → complete_task(module)
  CLI: if no write → retry → if still no write → escalate
```

### 4.4 Agent system prompt construction

```
system_prompt =
  get_prompt("system", "CONTEXT")    # command lifecycle table, artifact boundaries
  + get_skill("<command-skill>")      # methodology — how to think
  + get_prompt("<command>", "<stage>")  # stage instructions — what to do
  + injected_context                  # task details, analyses, specs — what to work with
```

### 4.5 Agent loop

```
send(user_message)
  → _run_loop():
    while tools present:
      _sync_response() or _stream_response()  [with retry, REQ-ARCH-10]
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
| Project artifacts | `<project>/.voidrift/` | REQUIREMENTS.md, ANALYSIS.md, analysis/, ARCHITECTURE.md, TASKS.md, spec/, arch/ | Project |
| Command logs | `<project>/.voidrift/logs/` | `<command>-<timestamp>.log` — full agent dialog | Until `voidrift prune` |
| System log | `~/.voidrift/logs/voidrift.log` | CLI invocations, command outcomes | Rotating (1MB × 5) |

| Session store | `~/.voidrift/sessions.db` | Ephemeral run data (analyses, escalation) | Until `voidrift prune --global` |
| Model config | `~/.voidrift/models.yml` | Cloud and gateway model aliases | Operator-managed |
| Worker models | `~/.voidrift/worker-models.yml` | Local model configs | `worker models add/remove` |
| Active container | `~/.voidrift/.active-container` | Running model alias (line 2) | `worker start/stop` |
| State history | `<project>/.voidrift/STATE.md` | Command run history, file manifests | Append-only |
