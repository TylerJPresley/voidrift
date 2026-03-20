# Requirements: VoidRift — Local-first Agentic Development Framework

## 1. Introduction

- **Purpose:** A local-first AI development lifecycle tool that routes work between a worker model (primary execution) and an optional architect model (escalation and design), producing a deployable, tested project from requirements alone through five phases: Gather → Plan → Develop → Automate → Verify.
- **Project Scope:** VoidRift provides the CLI orchestration layer, MCP context server, framework reference files, and worker node management. AI models are external (local vLLM containers, cloud APIs, or gateway endpoints). Hosting, CI/CD infrastructure, and runtime environments for generated projects are the operator's responsibility.

## 2. User Stories

- **As an** Operator, **I want to** run `voidrift gather <model> <path>` to reverse-engineer requirements from an existing codebase, **so that** I can onboard projects into the framework without writing requirements manually.
- **As an** Operator, **I want to** run `voidrift chat <model>` to interactively refine requirements, architecture, and tasks with an AI analyst, **so that** I can iterate on project artifacts through conversation.
- **As an** Operator, **I want to** run `voidrift plan` to generate architecture and task breakdowns, **so that** implementation work is pre-planned with atomic, ordered tasks.
- **As an** Operator, **I want to** run `voidrift develop` to have an AI execute tasks automatically, **so that** code is written, tested, and committed without manual intervention.
- **As an** Operator, **I want to** run `voidrift develop --workers 0` to process multiple modules concurrently, **so that** large projects complete faster.
- **As an** Operator, **I want to** use local models for bulk implementation and cloud models for escalation, **so that** I minimize API costs while maintaining quality on hard problems.
- **As an** Operator, **I want to** run `voidrift automate` to generate infrastructure-as-code, **so that** my project is deployable without manual IaC authoring.
- **As an** Operator, **I want to** run `voidrift verify` to validate the implementation against requirements, **so that** I have confidence the project meets its acceptance criteria.
- **As a** Developer model, **I want to** receive one task at a time via MCP tools, **so that** my context window stays small and focused.
- **As an** Architect model, **I want to** receive only the problem description and architecture docs during escalation, **so that** I provide design guidance without implementation bias.

## 3. External Interfaces (IEEE 29148)

- **User Interfaces:** Terminal CLI (`voidrift` command). Interactive chat via `voidrift chat`. Progress indicators (spinners, elapsed time) for automated phases. Rich terminal output via the `rich` library.
- **Hardware Interfaces:** GPU worker node (NVIDIA GB10 or compatible) accessed via SSH for local model inference. Optional — cloud models require no hardware.
- **Software/API Interfaces:**
  - OpenAI-compatible chat completions API (local vLLM, Kiro Gateway)
  - Anthropic native API (Claude models)
  - Google Generative AI API (Gemini models)
  - MCP protocol via stdio (CLI ↔ MCP Context Server)
  - SSH (Worker CLI → worker node for container lifecycle)
  - Docker API (container start/stop/health on worker node, managed by Worker CLI)
- **Communication Protocols:** HTTPS (cloud APIs), HTTP (local vLLM API, Kiro Gateway), stdio (MCP), SSH (Worker CLI → worker node)

## 4. Functional Requirements (EARS Notation)

*Use: WHEN [trigger], THE SYSTEM SHALL [result]*

### 4.1 System Architecture

- **REQ-ARCH-1:** The system SHALL consist of four components: a Python CLI (`cli/`), a Python MCP Context Server (`mcp-context-server/`), a Worker CLI (`worker-cli/`), and framework reference files (`resources/`).
  - *Rationale:* Separating worker node management from phase orchestration makes the CLI model-agnostic. Every model — local, cloud, or gateway — is just a base URL to the CLI.
- **REQ-ARCH-2:** The CLI SHALL provide subcommands: `gather`, `plan`, `develop`, `automate`, `verify`, `chat`, `status`, `log`, `unlock`, `prune`, `completions`. WHEN an unknown command is given, THE SYSTEM SHALL display the error and full help text (no tracebacks). No CLI command SHALL ever display a Python traceback to the user.
- **REQ-ARCH-3:** WHEN `voidrift` is run with no arguments, THE SYSTEM SHALL launch an interactive guided flow presenting available actions, model selection, and phase-specific options.
- **REQ-ARCH-4:** The CLI SHALL implement an agent loop that sends messages to model APIs (OpenAI-compatible for local/kiro, native for cloud), handles MCP tool calls, and streams responses to the terminal. WHEN tools are provided in the API call, the agent SHALL set `tool_choice: "required"` on every call. A `done` tool SHALL be included automatically — WHEN the model calls `done()`, the agent SHALL make one final call with `tool_choice: "none"` (no tools) to get the text summary. The agent loop SHALL detect stalls: IF the model makes the same tool call (same name and arguments) on consecutive iterations, the agent SHALL force a final text-only call. WHILE waiting for any model response (initial or after tool calls), THE SYSTEM SHALL display a "Thinking..." spinner on stderr that clears when the response begins streaming. The agent loop SHALL log all interactions to the active phase log file: system prompts, user messages, model responses, tool calls (name + arguments), and tool results.
  - *Rationale:* `tool_choice: "required"` ensures the model uses tools when they're available rather than generating text about what it would do. The `done` tool gives the model an explicit signal to stop tool use — without it, models loop indefinitely or stop unpredictably. Stall detection prevents infinite loops when a model repeats the same failing call. Comprehensive logging enables post-run debugging without reproducing the full agent session.
- **REQ-ARCH-5:** The CLI SHALL be model-agnostic. It SHALL resolve model aliases to `(base_url, api_key, model_id)` tuples from a models config file and connect to the endpoint directly. It SHALL NOT manage containers, SSH connections, or gateway processes.
  - *Rationale:* The worker node already exposes an OpenAI-compatible endpoint. Cloud APIs expose endpoints. Kiro Gateway exposes an endpoint. The CLI treats all three identically — the only variable is the URL.
- **REQ-ARCH-6:** The CLI SHALL load all framework resource content (skills, templates, prompts) exclusively through MCP server tool calls.
  - *Rationale:* On-demand retrieval via MCP tools keeps context windows small. Models pull only the sections they need instead of loading full files upfront.
- **REQ-ARCH-7:** Multi-stage phases SHALL use separate agent instances per unit of work to prevent context accumulation. Each agent starts with a clean message history. Shared state between agents SHALL be passed through MCP tools (`store_file_analysis`, `get_all_analyses`, etc.), not message history.
  - *Rationale:* A single agent reading multiple files accumulates raw content in its message history until the context window fills. Separate agents per file keep each context small and focused — the same pattern used by the develop phase (one agent per task).

### 4.2 MCP Context Server

- **REQ-MCP-1:** The MCP server SHALL communicate via stdio using the MCP protocol, built with Python/FastMCP.
- **REQ-MCP-2:** WHEN the server starts, THE SYSTEM SHALL load all framework files from `resources/` (skills, templates, prompts), index them by markdown header, and serve targeted sections on demand.
- **REQ-MCP-3:** The server SHALL use write-through storage for persistent artifacts (requirements, specs): `store_*` tools write to both in-memory cache and disk simultaneously. Ephemeral artifacts (analyses, escalation context) SHALL be stored in the SessionStore SQLite database (`~/.voidrift/sessions.db`), keyed by run ID.
  - *Rationale:* Persistent artifacts are operator work products that belong on disk. Ephemeral data belongs in the MCP's data store — queryable, prunable by age, and correlated by run ID.
- **REQ-MCP-3a:** ALL phase executions SHALL be scoped to a run ID. The run ID SHALL be the log filename stem (e.g. `gather-20260318-101048`). The CLI SHALL pass the run ID to the MCP server after `_boot()` to start a session in the SessionStore. ALL ephemeral MCP data (analyses, escalation context) SHALL be stored in the SessionStore keyed by run ID. The log file serves as the run's PID file — its existence and filename are the canonical record of the run.
- **REQ-MCP-4:** The MCP server SHALL expose content management tools as defined by REQ-MCP-6 through REQ-MCP-16. The MCP server SHALL serve framework resources from memory and ephemeral data from SQLite — it SHALL NOT perform local filesystem write operations, as it MAY reside on a different host than the CLI.
- **REQ-MCP-4a:** The CLI SHALL provide local filesystem tools directly (not via MCP): `write_file(path, content)`, `read_source_file(path)`, `export_to_file(type, path)`, `list_project_artifacts()`. These tools execute on the workstation where the CLI runs.
  - *Rationale:* The MCP server may be remote. Only the CLI is guaranteed to have local filesystem access.
- **REQ-MCP-6:** WHEN `get_template(name)` is called, THE SYSTEM SHALL retrieve the template from the in-memory index. IF the name is not found, THE SYSTEM SHALL return an error listing available templates.
  - Given `resources/templates/REQUIREMENTS-TEMPLATE.md` is indexed, When `get_template("REQUIREMENTS-TEMPLATE")` is called, Then the template content is returned.
  - When `get_template("NONEXISTENT")` is called, Then an error string is returned containing "not found" and a list of available template names.
- **REQ-MCP-7:** WHEN `load_tasks(path)` is called, THE SYSTEM SHALL parse `## Module: <name>` headers to split tasks into per-module queues. Tasks without a module header SHALL be assigned to a default module. All state changes SHALL be persisted back to the single TASKS.md file on disk.
  - *Rationale:* A single file with module headers is simpler to manage than multiple files per module — no glob discovery, no file copying, and atomic write-through updates all module state at once.
- **REQ-MCP-8:** WHEN `get_next_task(module)` is called, THE SYSTEM SHALL return the first unchecked (`- [ ]`) task for the given module, including its skill tags. The agent SHALL only ever see one task at a time.
  - *Rationale:* One task at a time keeps the agent's context window focused and prevents it from skipping ahead or reordering work.
- **REQ-MCP-9:** WHEN `complete_task(module)` is called, THE SYSTEM SHALL mark the first unchecked task as `- [x]` and write through to disk.
- **REQ-MCP-10:** The server SHALL use in-memory index for content (parsed markdown sections) and SQLite (`~/.voidrift/sessions.db`) for session metadata and ephemeral run data (analyses, escalation context). The SQLite connection SHALL be thread-safe (`check_same_thread=False`) to support concurrent file analysis in the gather pipeline.
- **REQ-MCP-11:** `write_file()` SHALL track paths written during the current run. IF a path has already been written in the same run, the tool SHALL reject the call with an error message (e.g. "File already written this run: <path>") and return without overwriting.
  - Given a run where `write_file("foo.md", "content")` has succeeded, When `write_file("foo.md", "new content")` is called, Then the tool returns an error containing "already written" and the file content is unchanged.
- **REQ-MCP-12:** `list_skills()` SHALL return names and one-line descriptions of all available skill files loaded from the resources directory.
- **REQ-MCP-13:** `list_templates()` SHALL return names and one-line descriptions of all available template files loaded from the resources directory.
- **REQ-MCP-14:** `list_documents()` SHALL return a listing of all `.voidrift/` artifacts (REQUIREMENTS.md, ARCHITECTURE.md, TASKS.md, spec/*.md, etc.) with file sizes.
- **REQ-MCP-15:** WHEN `get_prompt(phase, section)` is called, THE SYSTEM SHALL retrieve the named section from `resources/prompts/<phase>.md` using the markdown index (H2 heading match). IF the section is not found, THE SYSTEM SHALL return an error listing available sections for that phase. IF the phase file is not found, THE SYSTEM SHALL return an error listing available phase prompt files.
  - Given `resources/prompts/gather.md` contains `## TRIAGE`, When `get_prompt("gather", "TRIAGE")` is called, Then the TRIAGE section content is returned.
  - Given `resources/prompts/gather.md` exists, When `get_prompt("gather", "NONEXISTENT")` is called, Then an error is returned listing available section names.
  - Given no `resources/prompts/missing.md` exists, When `get_prompt("missing", "TRIAGE")` is called, Then an error is returned listing available phase files.
- **REQ-MCP-16:** `list_prompts(phase)` SHALL return the available section names (H2 headings) for the given phase prompt file. IF phase is omitted, SHALL return all phase names with their section lists.

### 4.3 Framework Reference Files

- **REQ-RES-1:** Each phase prompt file (`resources/prompts/<phase>.md`) SHALL contain stage-specific instructions as H2 sections. The shared methodology for a phase SHALL be a skill file (e.g. ANALYSIS-REQS for gather) loaded once and prepended to every stage prompt.
- **REQ-RES-2:** Skill files SHALL live in `resources/skills/` with uppercase filenames. Available skills SHALL be determined dynamically from the directory contents.
- **REQ-RES-3:** WHILE the plan phase is active, skill files SHALL be loaded on demand via `get_skill()` MCP tool calls (per REQ-ARCH-6).
- **REQ-RES-4:** WHILE the develop phase is active, skill files SHALL be loaded per-task via `get_skill()` MCP tool calls based on `[tag, ...]` annotations (per REQ-ARCH-6).
- **REQ-RES-5:** IF a skill file referenced in a task tag does not exist, THE SYSTEM SHALL print a warning and continue without loading it.
- **REQ-RES-6:** Phase prompt files SHALL live in `resources/prompts/<phase>.md` with H2 sections for each stage/step. The CLI SHALL load prompts via `get_prompt(phase, section)` MCP tool calls (per REQ-ARCH-6). Prompts MAY contain Python format variables (e.g. `{spec_path}`, `{group_name}`) which the CLI resolves via `.format()` before passing to the agent. A missing variable SHALL raise a `KeyError` — no silent substitution.
  - Given a prompt containing `{group_name}`, When the CLI calls `.format(group_name="backend")`, Then `{group_name}` is replaced with `backend`.
  - Given a prompt containing `{missing_var}`, When the CLI calls `.format(group_name="backend")`, Then a `KeyError` is raised for `missing_var`.
- **REQ-RES-7:** The CLI SHALL construct each agent's system prompt by concatenating: (1) the phase's methodology skill (loaded once via `get_skill()`), (2) the stage prompt from `get_prompt()`, and (3) any injected context (analyses, specs). The skill is loaded once per pipeline and reused across stages.
  - *Rationale:* Three layers with distinct responsibilities: the **skill** defines *how to think* (methodology, philosophy, quality standards), the **prompt** defines *what to do* (stage-specific instructions, tool calls, output format), and the **context** provides *what to work with* (data the agent processes). New methodology guidance goes in the skill. New instructions go in the prompt. New data goes in the context. This separation prevents prompt bloat and keeps each layer independently editable.

### 4.4 Phase 1 — Gather

- **REQ-G-1:** `voidrift gather <model> <path>` SHALL reverse-engineer requirements from the codebase at `<path>` using the four-stage pipeline (REQ-G-8). `--force` overwrites existing requirements.
  - Given no `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src` completes, Then `.voidrift/REQUIREMENTS.md` exists with content.
  - Given `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src` is run without `--force`, Then the command exits with an error and the file is unchanged.
  - Given `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src --force` completes, Then the file is overwritten with new content.
- **REQ-G-8:** THE SYSTEM SHALL reverse-engineer requirements in four stages, each using a separate agent instance (per REQ-ARCH-7). Each agent's system prompt SHALL be constructed per REQ-RES-7: the ANALYSIS-REQS skill (loaded once via `get_skill("ANALYSIS-REQS")`) concatenated with the stage-specific prompt (loaded via `get_prompt("gather", "<stage>")`). All instructions SHALL live in `resources/prompts/gather.md`.
  - *Rationale:* Four stages decompose a problem too large for one context window: triage reduces the file set, per-file analysis keeps each context small, per-group synthesis produces focused specs, and the overview ties them together. Separate agents per stage prevent context accumulation (REQ-ARCH-7). Externalizing prompts to resource files allows methodology iteration without code changes.
  1. **Triage:** Agent receives the complete file tree (filtered only for directories starting with `.`) and returns a JSON object with `groups` — a dict mapping logical boundary names to lists of files worth analyzing. The triage agent SHALL select only source files, documentation, and configuration — skipping build output, compiled artifacts, dependency directories, generated code, binaries, images, lock files, and any other non-source content. The agent infers this from its knowledge of the project's language and toolchain; the CLI SHALL NOT hardcode language-specific exclusions. A second validation pass SHALL review the triage output and remove any files that were incorrectly included (e.g. hashed build bundles, lock files, binary assets). The agent SHALL auto-detect logical boundaries from directory structure (e.g. `frontend/`, `backend/`, `api/`, `shared/`). Single-application codebases SHALL use one group.
  2. **Analysis:** One agent per file — reads the file via `read_source_file()`, stores a summary via `store_file_analysis()`, then exits. Each agent SHALL be preloaded with the ANALYSIS-REQS skill in its system prompt and SHALL have access to `get_skill()` and `list_skills()` to pull additional context. Each agent has a clean context containing only the single file.
  3. **Synthesis:** One agent per logical group — receives that group's full analyses in the system prompt (no truncation), fetches formatting guidance via `get_template()` and `get_skill()` (per REQ-ARCH-6), and writes a spec file via `write_file()` to `.voidrift/spec/<group>.md`. Each spec SHALL be thorough: every endpoint, component, data flow, config parameter, and error behavior from the analyses must appear as a requirement with acceptance criteria.
  4. **Overview:** A final agent receives all spec files in full (no truncation), fetches formatting guidance via `get_template()` and `get_skill()`, and writes `.voidrift/REQUIREMENTS.md` — a project-level overview covering: system purpose, how the applications interact (API contracts, shared config), deployment topology, and cross-cutting concerns. This file references the specs for detail.
  WHEN only one group is detected, stages 3 and 4 SHALL be collapsed: a single synthesis agent writes directly to `.voidrift/REQUIREMENTS.md` with full detail (no separate spec file).
  The reference directory SHALL be strictly read-only.
- **REQ-G-10:** Gather SHALL never auto-commit. `auto-commits: false` and `dirty-commits: false` SHALL be set.
- **REQ-G-11:** WHEN an API call fails due to context length exceeded, THE SYSTEM SHALL display a clear error identifying the stage, the group name, and a suggestion to use a model with a larger context window. The pipeline SHALL NOT silently truncate content to fit.
  - Given a model API returns an error containing "context length", When the agent loop catches the exception, Then a `RuntimeError` is raised with a message containing the model alias and "larger context window".
  - Given a source tree with 600 files, When `_build_file_tree` is called with the default 500 limit, Then a `RuntimeError` is raised with the actual file count and the limit.

### 4.5 Phase 2 — Plan

- **REQ-P-1:** Plan SHALL always produce `.voidrift/ARCHITECTURE.md` and `.voidrift/TASKS.md`. IF either is missing after the first run, one retry SHALL be issued. IF the retry also fails, THE SYSTEM SHALL exit with code 1. The agent's system prompt SHALL be constructed per REQ-RES-7: the ARCH-DESIGN skill (loaded once via `get_skill("ARCH-DESIGN")`) concatenated with the stage-specific prompt (loaded via `get_prompt("plan", "<stage>")`). All instructions SHALL live in `resources/prompts/plan.md`.
  - Given REQUIREMENTS.md exists, When `voidrift plan <model>` completes successfully, Then both ARCHITECTURE.md and TASKS.md exist in `.voidrift/`.
  - Given the model fails to produce ARCHITECTURE.md on the first run, When the retry also fails, Then the command exits with code 1 and names the missing artifact.
- **REQ-P-2:** Planner output SHALL be fully hidden from the terminal. Only a spinner and status line SHALL be shown.
- **REQ-P-3:** WHEN `--fresh-start` is specified, THE SYSTEM SHALL delete ARCHITECTURE.md, TASKS.md, and spec/*.md before planning.
  - Given ARCHITECTURE.md and TASKS.md exist, When `voidrift plan <model> --fresh-start` is run, Then both files are deleted before the planning agent starts.
- **REQ-P-4:** `auto-commits: false` SHALL be set for the plan phase.
- **REQ-P-5:** For single-module projects, tasks SHALL be written under a `## Tasks` header. For multi-module projects, tasks SHALL be grouped under `## Module: <name>` headers in a single TASKS.md.
- **REQ-P-6:** In multi-module projects, each file path SHALL appear in exactly one module's task group. No file SHALL be created or modified by tasks in more than one module.
- **REQ-P-7:** Each task line SHALL be a single atomic file operation: `- [ ] <Action verb> <file path>: <exact behavior> [skill1, skill2]`.
- **REQ-P-8:** Tasks SHALL NOT contain shell commands. Tasks describe file content only.
- **REQ-P-9:** WHEN the architect writes TASKS.md, THE SYSTEM SHALL parse all skill tags (`[skill1, skill2]`) and validate them against available skill files. IF invalid tags are found, THE SYSTEM SHALL send the error back to the model listing the invalid tags and valid skills, allowing the model to fix TASKS.md. IF the model fails to fix all invalid tags after one retry, THE SYSTEM SHALL exit with code 1.
  - Given TASKS.md contains `[backend, nonexistent]` and only `backend` exists as a skill, When validation runs, Then the model receives an error listing `nonexistent` as invalid and the available skills.
  - Given the model fixes all invalid tags on retry, When validation runs again, Then the plan completes successfully.
- **REQ-P-10:** `.voidrift/ARCHITECTURE.md` SHALL follow the structure defined in `ARCHITECTURE-TEMPLATE` (loaded via `get_template("ARCHITECTURE-TEMPLATE")`). The template follows the arc42 documentation standard with C4 model diagrams (Mermaid). The model SHALL populate each section with project-specific content.
  - *Rationale:* arc42 is an industry-standard architecture documentation framework providing a proven section structure. C4 (Context, Container, Component, Code) provides consistent diagram levels. Together they ensure architecture documents are complete, navigable, and familiar to engineers.
- **REQ-P-11:** `voidrift plan <model> --update` SHALL read the current REQUIREMENTS.md, spec files, and existing ARCHITECTURE.md and TASKS.md, then plan from the current requirements. The existing artifacts are context to preserve completed work — requirements are the source of truth. The model SHALL preserve completed tasks (`- [x]`), update or remove tasks that no longer apply, and add new tasks for any unaddressed requirements. The existing architecture SHALL be treated as a starting point, not regenerated from scratch.
  - Given ARCHITECTURE.md and TASKS.md exist, When `voidrift plan <model> --update` completes, Then requirements are the source of truth and completed tasks are preserved.
  - Given no ARCHITECTURE.md exists, When `voidrift plan <model> --update` is run, Then the command exits with an error.

### 4.6 Phase 3 — Develop

- **REQ-D-1:** WHEN `.voidrift/TASKS.md` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift plan`.
  - Given no `.voidrift/TASKS.md` exists, When `voidrift develop <model>` is run, Then the command exits with an error containing "Run 'voidrift plan'".
- **REQ-D-2:** WHEN all tasks are marked `[x]`, THE SYSTEM SHALL exit with "all tasks complete" and return 0.
  - Given all tasks in TASKS.md are `[x]`, When `voidrift develop <model>` is run, Then the command exits with code 0 and prints "All tasks complete."
- **REQ-D-3:** WHEN a develop session starts, THE SYSTEM SHALL create `.voidrift/.develop.lock` with PID and timestamp. IF the lock exists with a live PID, THE SYSTEM SHALL exit with error.
  - Given no lock file exists, When a develop session starts, Then `.develop.lock` is created with the current PID.
  - Given a lock file exists with a live PID, When `voidrift develop <model>` is run, Then the command exits with an error containing the PID.
  - Given a lock file exists with a dead PID, When `voidrift develop <model>` is run, Then the stale lock is removed and the session starts.
- **REQ-D-4:** WHILE the develop loop is active, THE SYSTEM SHALL process the first unchecked task from TASKS.md via `get_next_task()`. WHEN no unchecked tasks remain, the loop SHALL exit. Each agent's system prompt SHALL be constructed per REQ-RES-7: the stage-specific prompt (loaded via `get_prompt("develop", "TASK")`) with the task text and any architect guidance injected via format variables. All instructions SHALL live in `resources/prompts/develop.md`.
- **REQ-D-5:** AFTER a task completes, THE SYSTEM SHALL verify that `write_file()` was called at least once during the task. IF no writes occurred, THE SYSTEM SHALL retry the task once. IF the retry also produces no writes AND an architect is configured, THE SYSTEM SHALL escalate. Additionally, IF git is initialized and HEAD exists, THE SYSTEM SHALL check `git diff HEAD` — if no changes are detected despite writes, THE SYSTEM SHALL log a warning.
  - Given a task completes without any `write_file()` calls, When the system checks, Then the task is retried.
  - Given a retry also produces no writes and an architect is configured, When the system checks, Then the task is escalated.
- **REQ-D-6:** WHEN the worker escalates, THE SYSTEM SHALL consult the architect with the escalation context and inject the architect's response into the agent's message history, then retry the task. Escalations and responses are ephemeral — they exist only in the agent's message history during the run. The architect's system prompt SHALL be constructed per REQ-RES-7: the escalation prompt (loaded via `get_prompt("develop", "ESCALATION")`) with the question, task text, requirements, and architecture injected via format variables.
- **REQ-D-7:** WHEN `max_escalations` (5) is exceeded for a session, THE SYSTEM SHALL mark the task `[!]` (blocked), increment `blocked_tasks`, and continue to the next task.
  - Given 5 escalations have occurred, When the developer escalates again, Then the task is marked `[!]` and the next task begins.
- **REQ-D-8:** WHEN architect is consulted, THE SYSTEM SHALL provide: problem description, REQUIREMENTS.md, ARCHITECTURE.md, and task text. Source code files SHALL NOT be loaded.
- **REQ-D-9:** Task completion SHALL be managed by the MCP server's `complete_task()` tool, which marks `- [ ]` as `- [x]` and writes through to disk.
- **REQ-D-10:** WHEN `.voidrift/TASKS.md` contains `## Module:` headers, THE SYSTEM SHALL spawn up to `--workers N` concurrent agent loops, each assigned a module. With `--workers 1` (default), modules SHALL be processed sequentially. With `--workers 0`, one worker SHALL be spawned per module.
  - *Rationale:* Single-branch execution avoids merge complexity. File ownership constraints (REQ-P-6) prevent cross-module conflicts. A commit lock (REQ-D-11) serializes git operations.
- **REQ-D-11:** WHEN multiple workers are active, git commits SHALL be serialized through a lock to prevent index conflicts.
- **REQ-D-12:** WHEN `--workers` is greater than 1 AND no module headers exist, THE SYSTEM SHALL print a warning and fall back to single-worker mode.
  - Given TASKS.md has no `## Module:` headers, When `voidrift develop <model> --workers 4` is run, Then a warning is printed and the system falls back to single-worker mode.
- **REQ-D-13:** WHEN Ctrl+C or SIGTERM is received, THE SYSTEM SHALL set an interrupted flag and stop after the current task completes. The lock file SHALL be cleaned up in all cases. WHEN multiple workers are active (REQ-D-10), THE SYSTEM SHALL send SIGTERM to active workers, allow a 2-second grace period, then SIGKILL.
  - Given a develop session is running a task, When Ctrl+C is pressed, Then the current task finishes and the session exits with the lock file removed.

### 4.7 Phase 4 — Automate

- **REQ-A-1:** WHEN no IaC files are detected, THE SYSTEM SHALL generate infrastructure-as-code based on REQUIREMENTS.md and ARCHITECTURE.md.
- **REQ-A-2:** WHEN IaC files exist, THE SYSTEM SHALL review them for consistency and reconcile gaps without deleting existing files.
- **REQ-A-3:** Generated IaC SHALL NOT contain hardcoded secrets. All sensitive values SHALL be parameterized.
- **REQ-A-4:** Every generated cloud resource SHALL be tagged with project name and environment.

### 4.8 Phase 5 — Verify

- **REQ-V-1:** The system SHALL run quality checks based on the technology stack in ARCHITECTURE.md and detected project files.
- **REQ-V-2:** The worker SHALL produce `.voidrift/VERIFY.md` with sections: Test Results, Lint & Static Analysis, Infrastructure, Requirements Coverage, Issues, Verdict.
- **REQ-V-3:** The verdict SHALL be PASS only if the verdict line starts with `PASS` AND `failed_checks` is 0.
- **REQ-V-4:** WHEN verification fails AND an architect is configured, THE SYSTEM SHALL consult the architect for a remediation plan and produce `.voidrift/TASKS-fixes.md`.

### 4.9 Utility Commands

- **REQ-U-1:** `voidrift status` SHALL print phase completion status with emoji indicators (✅, ⬜, 🔄) and task counts.
- **REQ-U-2:** `voidrift chat <model>` SHALL start an interactive session with full MCP tool access (per REQ-ARCH-6) — the central command for iterating on any `.voidrift/` artifact. The agent's system prompt SHALL be constructed per REQ-RES-7: the ANALYSIS-REQS skill as baseline methodology, the `chat/SYSTEM` prompt for behavioral rules, and optional context. The agent MAY load additional domain skills on demand via `get_skill()`. `--doc <path>` SHALL scope the conversation to a specific `.voidrift/` artifact, loading its content into the system prompt context. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt (not exit).
  - Given a valid model alias, When `voidrift chat <model>` is run, Then an interactive session starts with the ANALYSIS-REQS skill and `chat/SYSTEM` prompt loaded.
  - Given `--doc REQUIREMENTS.md` and the file exists, When the session starts, Then the system prompt includes the file's content.
  - Given `--doc new-spec.md` and the file does not exist, When the session starts, Then a warning is printed and the system prompt includes the DOC-NEW section.
  - Given a model API error during a chat turn, When the agent raises a RuntimeError, Then the error is printed and the prompt reappears.
- **REQ-U-3:** `voidrift log <phase>` SHALL show the last 200 lines of the most recent log. `--follow` / `-f` SHALL tail the latest log file, streaming new lines as they are written. `--prune` SHALL delete log files.
- **REQ-U-4:** `voidrift unlock` SHALL remove the develop lock file and kill any running develop process.
- **REQ-U-5:** `voidrift completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. All model, worker, and architect arguments SHALL complete from configured aliases in `models.yml`.
- **REQ-U-6:** `voidrift prune` SHALL remove project-level ephemeral data (`.voidrift/` logs, stale `.develop.lock`) beyond the configured retention limit (`retention.project`, default 5). `--all` SHALL remove the entire `.voidrift/` directory — a clean slate. `--global` SHALL prune the framework-level SessionStore (`~/.voidrift/`) beyond the configured retention limit (`retention.global`, default 30 days). `--global --all` SHALL remove ALL framework SessionStore data. WHEN `--global` is NOT set AND no `.voidrift/` directory exists in the current project, THE SYSTEM SHALL exit with a friendly error (e.g. "No .voidrift directory found — nothing to prune").

### 4.10 Model Configuration

- **REQ-MC-1:** WHEN a model alias is used, THE SYSTEM SHALL resolve it to `(base_url, api_key, model_id)` from a models config file (`models.yml`). IF the alias is not found, THE SYSTEM SHALL exit with an error listing available aliases.
- **REQ-MC-2:** Cloud models SHALL require no initialization and be accessed directly via API endpoints.
- **REQ-MC-3:** The models config file SHALL support three endpoint types: `local` (worker node vLLM), `cloud` (provider APIs), and `gateway` (Kiro Gateway). Each entry specifies `base_url`, `api_key` (or env var reference), and `model_id`.

### 4.11 Worker CLI

- **REQ-WK-1:** The Worker CLI (`worker-cli/`) SHALL be a separate Python package providing the `worker` command, installed independently from the VoidRift CLI.
- **REQ-WK-2:** `worker start <alias>` SHALL SSH to the worker node, stop any running model container, start the requested model container, and poll until the API health check responds. During polling, the system SHALL check `docker ps` to detect container exit — IF the container is no longer running, THE SYSTEM SHALL exit immediately with the container's logs as error context.
  - Given alias `qwen3-coder` is configured in `worker-models.yml`, When `worker start qwen3-coder` is run, Then the previous container is stopped, the new container starts, and the command exits after the health check passes.
  - Given the container exits during polling, When `docker ps` shows no running container, Then the command exits with code 1 and prints the container logs.
- **REQ-WK-3:** `worker stop` SHALL SSH to the worker node and stop the active model container.
  - Given a model container is running, When `worker stop` is run, Then the container is stopped and the command exits with code 0.
- **REQ-WK-4:** `worker status` SHALL report the active model (if any), container health, and API endpoint URL.
  - Given a model container is running, When `worker status` is run, Then the output includes the model alias, health status, and endpoint URL.
  - Given no container is running, When `worker status` is run, Then the output indicates no active model.
- **REQ-WK-5:** `worker bench [<num_prompts>] [<req_rate>]` SHALL benchmark the active model using vLLM's benchmark tool via SSH.
- **REQ-WK-6:** `worker models list` SHALL display configured models (from `worker-models.yml`) and cached models (from HF cache) with clear section headers.
  - Given two models are configured and one is cached, When `worker models list` is run, Then both configured models appear under a "Configured" header and the cached model appears under a "Cached" header.
- **REQ-WK-6a:** `worker models add <alias> <repo>` SHALL add a new model to `worker-models.yml` AND download the weights. IF the alias already exists, THE SYSTEM SHALL exit with an error.
  - Given alias `new-model` does not exist, When `worker models add new-model org/repo` is run, Then the alias is added to `worker-models.yml` and weights are downloaded.
  - Given alias `qwen3-coder` already exists, When `worker models add qwen3-coder org/repo` is run, Then the command exits with an error and `worker-models.yml` is unchanged.
- **REQ-WK-6b:** `worker models remove <alias>` SHALL delete the cached weights AND move the model config to a `retired` section in `worker-models.yml`.
- **REQ-WK-6c:** `worker models check` SHALL audit all configured models, verify cache integrity, and attempt to download missing weights for configured models. It SHALL report unconfigured models in the cache. With `--prune`, it SHALL remove unconfigured cached models.
- **REQ-WK-7:** Only one local model container SHALL run at a time on the worker node.
  - Given container A is running, When `worker start` launches container B, Then container A is stopped before container B starts.
- **REQ-WK-8:** Model configurations SHALL be defined in `worker-models.yml` specifying: repository, docker image, GPU memory utilization, max model length, vLLM args, served model name, and cache mounts.
- **REQ-WK-9:** `worker kiro start` SHALL start the Kiro Gateway container. `worker kiro stop` SHALL stop it. `worker kiro status` SHALL report health and available models.
- **REQ-WK-10:** WHEN Kiro Gateway credentials are invalid (expired token, database permissions), THE SYSTEM SHALL stop immediately with a clear error message identifying the failure mode.
  - *Rationale:* Prevents the CLI from entering an infinite retry loop against invalid credentials. The error message directs the operator to the specific fix (re-login, chmod).
  - Given the Kiro Gateway returns a 401 during health check, When the CLI detects the auth failure, Then the command exits with an error message identifying expired credentials.
- **REQ-WK-11:** `worker logs [-f]` SHALL list all worker containers (running and stopped) with status, mark the active one, and prompt the user to select one. It SHALL then show that container's logs. IF no containers exist, it SHALL exit with an error.
  - Given no containers exist on the worker node, When `worker logs` is run, Then the command exits with an error message.
- **REQ-WK-12:** `worker info` SHALL report worker node GPU status (`nvidia-smi`), disk usage (`df -h`), and memory (`free -h`) over SSH.
- **REQ-WK-13:** `worker images pull [<image>]` SHALL pull a vLLM docker image on the worker node. IF no image is specified, THE SYSTEM SHALL pull the default image from `worker-models.yml`. `worker images list` SHALL list docker images on the worker node.
- **REQ-WK-14:** `worker cache clear` SHALL remove compiled kernel caches (flashinfer, vllm) on the worker node over SSH.
- **REQ-WK-15:** `worker check` SHALL verify worker node prerequisites over SSH: Docker available, NVIDIA GPU accessible (`nvidia-smi`), `uvx` on PATH, and SSH connectivity. Each check SHALL report pass/fail. IF any check fails, THE SYSTEM SHALL exit with code 1.
  - Given Docker is available and GPU is accessible, When `worker check` is run, Then all checks report pass and the command exits with code 0.
  - Given SSH connectivity fails, When `worker check` is run, Then the SSH check reports fail and the command exits with code 1.
- **REQ-WK-16:** All `worker` CLI help output SHALL follow the CLI Help Convention defined in SYSTEMS-ENG skill. WHEN an unknown command or invalid arguments are given, THE SYSTEM SHALL display the error and help text (no tracebacks).
  - Given an unknown subcommand `worker foo`, When the command is run, Then the output contains the error and help text with no Python traceback.
- **REQ-WK-17:** `worker completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. Alias arguments SHALL complete from configured models in `worker-models.yml`.

### 4.12 Git

- **REQ-GIT-1:** Planning artifacts SHALL be committed in a single commit with message `"docs: add planning artifacts"`.
- **REQ-GIT-2:** WHILE the develop phase is active, source code SHALL be committed per task with task-specific messages. WHEN multiple workers are active, commits SHALL be serialized through a lock.
- **REQ-GIT-3:** `auto-commits: false` SHALL be set for the gather and plan phases.

### 4.13 Project Structure

- **REQ-PS-1:** All framework-generated files SHALL be stored in `.voidrift/` within the target project directory.
- **REQ-PS-2:** The `.voidrift/` directory SHALL be created automatically on first phase run if it does not exist.
- **REQ-PS-3:** `.voidrift/STATE.md` SHALL be created automatically on first develop run.
- **REQ-PS-4:** IF `.voidrift/` exists but is missing required files for a phase, THE SYSTEM SHALL exit with an error suggesting corrective action.

### 4.14 Logging

- **REQ-LOG-1:** All phase logs SHALL use timestamped filenames: `<phase>-YYYYMMDD-HHMMSS.log`.
- **REQ-LOG-2:** Log files SHALL accumulate indefinitely. The operator is responsible for cleanup.
- **REQ-LOG-3:** WHEN a phase displays its log path, it SHALL appear immediately after the phase title line.

### 4.15 Interactive Terminal UI

- **REQ-UI-1:** ALL console output SHALL use three distinct visual roles, consistent across every phase (interactive and automated):
  - **System** (`▸`): dim white. Phase titles, stage labels, progress counters, log paths, spinners, stats, errors, warnings. Prefix: `▸` for informational, `✓` green for success, `⚠` yellow for warnings, `✗` red for errors.
  - **Model** (`◆`): light blue (ANSI 256-color 117), indented 2 spaces. All model-generated text — streamed responses, summaries, analysis output. Prefix: `◆ alias` dim italic label on first line.
  - **Operator** (`▶`): bold white. Reprinted user input in interactive sessions. Preceded by a horizontal rule (`console.rule`, `bright_black` style).
  All phases SHALL use these roles identically. A shared output module SHALL enforce the convention — phases SHALL NOT use raw `console.print` with ad-hoc styling.
- **REQ-UI-2:** ALL phases (gather, plan, develop, automate, verify) SHALL display progress through their stages. Each phase SHALL show: a phase title line, stage transitions (e.g. `▸ Stage 1/3: Triaging files...`), per-item progress with elapsed time (e.g. `▸ 3/28 backend/main.py... ✓ 4.8s`), and a final summary line. Automated phases (plan, develop, automate, verify) SHALL show the same level of progress detail as interactive phases.
- **REQ-UI-3:** The `voidrift chat` command SHALL use a plain-terminal interface with: a dim header block (phase name, log path, model label), a `prompt_toolkit` multi-line input (blank line to submit, backspace/arrows work across lines), streamed model responses via `on_token` callback, and a dim stats line after each response showing token count, tokens/sec, and elapsed time.
- **REQ-UI-4:** Chat SHALL always have its full tool set available. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt.
  - Given a chat session is active, When the operator sends a message, Then all MCP and local tools are available to the agent.
- **REQ-UI-5:** Interactive sessions SHALL handle Ctrl+C gracefully (print dim "Session ended." and exit), handle EOF on input (exit cleanly), and log all operator input and model responses to the session log file.
  - Given a chat session is active, When the operator presses Ctrl+C, Then "Session ended." is printed and the process exits cleanly.
  - Given a chat session with two exchanges, When the session ends, Then the log file contains both operator inputs and both model responses.

### 4.16 Framework Configuration

- **REQ-CFG-1:** All framework configuration SHALL be read from `~/.voidrift/config.yml`. Config files SHALL support `${VAR}` and `${VAR:-default}` for environment variable expansion, and `${section.key}` for cross-referencing values from config.yml.
- **REQ-CFG-2:** `config.yml` SHALL contain sections for: `worker` (user, ip, api_key, hf_token), `kiro` (port, api_key), and `api_keys` (anthropic, gemini). Connection settings are literal values; secrets use env var references.
- **REQ-CFG-3:** Framework resources (skills, templates, prompts), `models.yml`, and `worker-models.yml` SHALL be read from `~/.voidrift/`. The repo is the source of truth; `make sync` copies to `~/.voidrift/`.
- **REQ-CFG-4:** `VOIDRIFT_HOME` env var MAY override `~/.voidrift/` for testing and CI. IF not set, `~/.voidrift/` is used.
- **REQ-CFG-5:** `config.yml` SHALL contain a `retention:` section with `project` (integer, default 5 — number of recent runs to keep) and `global` (integer, default 30 — days of session data to keep). `voidrift prune` uses these limits.

## 5. Non-Functional Requirements

- **Reliability:** The MCP server SHALL use write-through storage so no data is lost on unexpected exit. The develop phase SHALL use a lock file to prevent concurrent sessions. SIGTERM SHALL trigger graceful shutdown with cleanup.
- **Performance:** Local models SHALL be served via vLLM with FlashInfer backend. The MCP server SHALL use in-memory indexing for sub-millisecond section retrieval. Agents SHALL receive one task at a time to minimize context window usage.
- **Security:** The CLI SHALL NOT hardcode secrets. A PATH shim SHALL prevent the worker model from executing package managers on the host. File operations SHALL be sandboxed to the project directory (path traversal denied). The Worker CLI SHALL validate Kiro Gateway credentials before reporting the endpoint as ready.
- **Portability:** The framework SHALL run on Linux, macOS, and WSL2. Local model support requires an NVIDIA GPU worker node accessible via SSH and the Worker CLI. Cloud-only mode requires no special hardware or Worker CLI.
- **Maintainability:** All packages SHALL use `pyproject.toml` with hatchling, a shared `VERSION` file, and editable installs. Google-style docstrings and type hints SHALL be used throughout. Tests SHALL use pytest.

## 6. Verification Plan

| ID | Requirement | Method | Evidence Required |
|----|-------------|--------|-------------------|
| V-MCP-1 | REQ-MCP-2 | Test | `test_server_tools.py` — framework resources loaded at boot |
| V-MCP-2 | REQ-MCP-3 | Test | `test_artifact_store.py` — write-through and disk fallback |
| V-MCP-3 | REQ-MCP-6 | Test | `test_server_tools.py::TestGetTemplate` — template retrieval |
| V-MCP-4 | REQ-MCP-7 | Test | `test_task_store.py` — module parsing, single and multi |
| V-MCP-5 | REQ-MCP-8 | Test | `test_task_store.py::test_get_next` — returns first unchecked |
| V-MCP-6 | REQ-MCP-9 | Test | `test_task_store.py::test_complete_writes_through` |
| V-MCP-7 | REQ-MCP-15 | Test | `test_server_tools.py` — prompt retrieval by phase and section |
| V-MCP-8 | REQ-MCP-11 | Test | `test_server_tools.py` — duplicate `write_file` returns error, file unchanged |
| V-MCP-9 | REQ-MCP-16 | Test | `test_server_tools.py` — `list_prompts` returns sections per phase |
| V-RES-1 | REQ-RES-6 | Test | `test_phases.py` — format variable substitution in prompt templates |
| V-ARCH-1 | REQ-ARCH-2 | Test | `test_phases.py::TestCLICommands` — subcommands exist |
| V-ARCH-2 | REQ-ARCH-4 | Test | `test_agent.py` — agent loop sends/receives messages |
| V-ARCH-3 | REQ-ARCH-6 | Test | `test_agent.py::TestBuildMcpTools` — tools present, no direct reads |
| V-G-1 | REQ-G-1 | Test | `test_phases.py::TestGatherPreflightChecks` |
| V-G-2 | REQ-G-11 | Test | `test_agent.py` — context length error detection |
| V-P-1 | REQ-P-1 | Test | `test_phases.py::TestPlanPreflightChecks` — artifact production and retry |
| V-P-2 | REQ-P-3 | Test | `test_phases.py` — fresh-start deletes existing artifacts |
| V-P-3 | REQ-P-6 | Analysis | Code review of generated TASKS.md for file ownership |
| V-P-4 | REQ-P-9 | Test | `test_phases.py` — invalid skill tags rejected, model gets retry |
| V-P-5 | REQ-P-11 | Test | `test_phases.py` — update mode requires existing artifacts |
| V-D-1 | REQ-D-1 | Test | `test_phases.py::TestDevelopPreflightChecks::test_missing_tasks` |
| V-D-2 | REQ-D-2 | Test | `test_phases.py::TestDevelopPreflightChecks::test_all_tasks_complete` |
| V-D-3 | REQ-D-3 | Test | `test_phases.py::TestDevelopPreflightChecks::test_lock_file_stale` |
| V-D-4 | REQ-D-5 | Test | `test_phases.py` — no writes triggers retry, then escalation |
| V-D-5 | REQ-D-7 | Test | `test_phases.py` — max escalations blocks task and continues |
| V-D-5 | REQ-D-10 | Test | `test_phases.py::TestDevelopPreflightChecks::test_workers_without_modules` |
| V-D-6 | REQ-D-12 | Test | `test_phases.py` — workers without module headers falls back to single |
| V-U-1 | REQ-U-1 | Test | `test_phases.py::TestCLICommands::test_status_command` |
| V-U-2 | REQ-U-2 | Test | `test_phases.py` — chat session loads skill, prompt, and --doc context |
| V-U-3 | REQ-U-3 | Test | `test_phases.py::TestCLICommands::test_log_view` |
| V-U-4 | REQ-U-4 | Test | `test_phases.py::TestCLICommands::test_unlock_no_lock` |
| V-UI-1 | REQ-UI-4 | Test | `test_phases.py` — chat tools available on every turn |
| V-UI-2 | REQ-UI-5 | Test | `test_phases.py` — session log contains operator input and model responses |
| V-MC-1 | REQ-MC-1 | Test | `test_models.py::TestResolveModel` — alias resolution from config |
| V-MC-2 | REQ-MC-2 | Test | `test_models.py::TestResolveModel::test_cloud_models` |
| V-WK-1 | REQ-WK-2 | Test | `test_worker.py` — container start/stop via SSH |
| V-WK-2 | REQ-WK-10 | Test | `test_worker.py::TestKiroGateway::test_validate_credentials_expired` |
| V-WK-3 | REQ-WK-3 | Test | `test_worker.py` — stop command halts active container |
| V-WK-4 | REQ-WK-4 | Test | `test_worker.py` — status reports model, health, and endpoint |
| V-WK-5 | REQ-WK-6 | Test | `test_worker.py` — models list shows configured and cached sections |
| V-WK-6 | REQ-WK-6a | Test | `test_worker.py` — models add succeeds for new alias, errors on duplicate |
| V-WK-7 | REQ-WK-7 | Test | `test_worker.py` — start stops previous container before launching new one |
| V-WK-8 | REQ-WK-11 | Test | `test_worker.py` — logs errors when no containers exist |
| V-WK-9 | REQ-WK-15 | Test | `test_worker.py::TestWorkerCheck` — pass/fail per prerequisite |
| V-WK-10 | REQ-WK-16 | Test | `test_worker.py` — unknown command shows error and help, no traceback |

---

## Appendix A: Project Artifact Structure

```
.voidrift/
├── REQUIREMENTS.md           # Project requirements
├── ARCHITECTURE.md           # Architecture reference
├── STATE.md                  # Project state summary
├── TASKS.md                  # Task list (single file, module headers for multi-module)
├── spec/                     # Feature specifications
│   └── <feature>.md
├── <phase>-*.log             # Phase logs
└── .develop.lock             # Concurrent execution lock
```

## Appendix B: Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VOIDRIFT_HOME` | No | `~/.voidrift` | Override config directory for testing/CI |
| `ANTHROPIC_API_KEY` | Claude models | — | Referenced via `${ANTHROPIC_API_KEY}` in config.yml |
| `GEMINI_API_KEY` | Gemini models | — | Referenced via `${GEMINI_API_KEY}` in config.yml |
| `OPENAI_API_KEY` | Local models | `no-key` | Referenced via `${OPENAI_API_KEY:-no-key}` in config.yml |
| `KIRO_API_KEY` | Kiro models | — | Referenced via `${KIRO_API_KEY}` in config.yml |
| `HF_TOKEN` | Model downloads | — | Hugging Face token for gated models |

## Appendix C: Model Registry

| Alias | Model ID | Type |
|---|---|---|
| `qwen3-8b` | `Qwen/Qwen3-8B-FP8` | Local |
| `qwen3-instruct` | `Qwen/Qwen3-30B-A3B-Instruct-2507-FP8` | Local |
| `qwen3-coder` | `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | Local |
| `qwen3-coder-next` | `RedHatAI/Qwen3-Coder-Next-FP8-dynamic` | Local |
| `claude` | `anthropic/claude-opus-4-6` | Cloud |
| `haiku` | `anthropic/claude-haiku-4-5` | Cloud |
| `gemini` | `gemini/gemini-2.5-pro` | Cloud |
| `gemini-flash` | `gemini/gemini-2.5-flash` | Cloud |
| `kiro-sonnet` | `claude-sonnet-4-5` | Kiro Gateway |
| `kiro-haiku` | `claude-haiku-4-5` | Kiro Gateway |
| `kiro-deepseek` | `deepseek-v3-2` | Kiro Gateway |
| `kiro-minimax` | `minimax-m2-1` | Kiro Gateway |
| `kiro-qwen` | `qwen3-coder-next` | Kiro Gateway |
