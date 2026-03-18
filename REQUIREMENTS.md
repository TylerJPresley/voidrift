# Requirements: VoidRift — Local-first Agentic Development Framework

## 1. Introduction

- **Purpose:** A local-first AI development lifecycle tool that routes work between a worker model (primary execution) and an optional architect model (escalation and design), producing a deployable, tested project from requirements alone through five phases: Gather → Plan → Develop → Automate → Verify.
- **Project Scope:** VoidRift provides the CLI orchestration layer, MCP context server, and framework reference files. It does NOT provide the AI models themselves (those are external: local vLLM containers or cloud APIs), nor does it provide hosting, CI/CD infrastructure, or runtime environments for generated projects.

## 2. User Stories

- **As an** Operator, **I want to** run `voidrift gather` to interactively define requirements with an AI analyst, **so that** I get a complete, testable requirements document without writing it manually.
- **As an** Operator, **I want to** run `voidrift plan` to generate architecture and task breakdowns, **so that** implementation work is pre-planned with atomic, ordered tasks.
- **As an** Operator, **I want to** run `voidrift develop` to have an AI execute tasks automatically, **so that** code is written, tested, and committed without manual intervention.
- **As an** Operator, **I want to** run `voidrift develop --workers 0` to process multiple modules concurrently, **so that** large projects complete faster.
- **As an** Operator, **I want to** use local models for bulk implementation and cloud models for escalation, **so that** I minimize API costs while maintaining quality on hard problems.
- **As an** Operator, **I want to** run `voidrift automate` to generate infrastructure-as-code, **so that** my project is deployable without manual IaC authoring.
- **As an** Operator, **I want to** run `voidrift verify` to validate the implementation against requirements, **so that** I have confidence the project meets its acceptance criteria.
- **As an** Operator, **I want to** reverse-engineer requirements from an existing codebase via `voidrift gather --from`, **so that** I can onboard legacy projects into the framework.
- **As a** Developer model, **I want to** receive one task at a time via MCP tools, **so that** my context window stays small and focused.
- **As an** Architect model, **I want to** receive only the problem description and architecture docs during escalation (not source code), **so that** I provide design guidance without implementation bias.

## 3. External Interfaces (IEEE 29148)

- **User Interfaces:** Terminal CLI (`voidrift` command). Interactive chat for gather phase. Progress indicators (spinners, elapsed time) for background phases. Rich terminal output via the `rich` library.
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
- **REQ-ARCH-2:** The CLI SHALL provide subcommands: `gather`, `plan`, `develop`, `automate`, `verify`, `chat`, `status`, `log`, `unlock`, `completions`. WHEN an unknown command is given, THE SYSTEM SHALL display the error and full help text (no tracebacks). No CLI command SHALL ever display a Python traceback to the user.
- **REQ-ARCH-3:** WHEN `voidrift` is run with no arguments, THE SYSTEM SHALL launch an interactive guided flow presenting available actions, model selection, and phase-specific options.
- **REQ-ARCH-4:** The CLI SHALL implement an agent loop that sends messages to model APIs (OpenAI-compatible for local/kiro, native for cloud), handles MCP tool calls, and streams responses to the terminal. WHEN tools are provided in the API call, the agent SHALL set `tool_choice: "required"` on every call. A `done` tool SHALL be included automatically — WHEN the model calls `done()`, the agent SHALL make one final call with `tool_choice: "none"` (no tools) to get the text summary. WHILE waiting for any model response (initial or after tool calls), THE SYSTEM SHALL display a "Thinking..." spinner on stderr that clears when the response begins streaming.
- **REQ-ARCH-5:** The CLI SHALL be model-agnostic. It SHALL resolve model aliases to `(base_url, api_key, model_id)` tuples from a models config file and connect to the endpoint directly. It SHALL NOT manage containers, SSH connections, or gateway processes.
  - *Rationale:* The worker node already exposes an OpenAI-compatible endpoint. Cloud APIs expose endpoints. Kiro Gateway exposes an endpoint. The CLI treats all three identically — the only variable is the URL.
- **REQ-ARCH-6:** The CLI SHALL never read framework resource files (agents, skills, templates) directly. All framework context SHALL be served exclusively through MCP server tool calls.
  - *Rationale:* On-demand retrieval via MCP tools keeps context windows small. Models pull only the sections they need instead of loading full files upfront.
- **REQ-ARCH-7:** Multi-stage phases SHALL use separate agent instances per unit of work to prevent context accumulation. Each agent starts with a clean message history. Shared state between agents SHALL be passed through MCP tools (`store_file_analysis`, `get_all_analyses`, etc.), not message history.
  - *Rationale:* A single agent reading multiple files accumulates raw content in its message history until the context window fills. Separate agents per file keep each context small and focused — the same pattern used by the develop phase (one agent per task).

### 4.2 MCP Context Server

- **REQ-MCP-1:** The MCP server SHALL communicate via stdio using the MCP protocol, built with Python/FastMCP.
- **REQ-MCP-2:** WHEN the server starts, THE SYSTEM SHALL load all framework files from `resources/` (agents, skills, templates), index them by markdown header, and serve targeted sections on demand.
- **REQ-MCP-3:** The server SHALL use write-through storage: `store_*` tools write to both in-memory cache and disk simultaneously. Memory serves as read cache; disk is the source of truth.
  - *Rationale:* Write-through ensures no data loss on unexpected exit while keeping reads fast via memory cache.
- **REQ-MCP-3a:** File analyses SHALL be scoped to a run ID. The run ID SHALL be the log filename stem (e.g. `gather-20260318-101048`). Analyses SHALL be stored under `.voidrift/analyses/<run_id>/`. `get_all_analyses()` SHALL return only analyses for the current run. The CLI SHALL pass the run ID to the artifact store at the start of each phase.
- **REQ-MCP-4:** The server SHALL expose content management tools: `store_file_analysis()`, `get_file_analysis()`, `get_all_analyses()`, `store_requirements()`, `get_requirements()`, `get_agent(role, topic)`, `get_skill(name, topic)`, `get_template(name)`, `load_tasks(path)`, `get_next_task(module)`, `complete_task(module)`, `get_task_status(module)`. The MCP server SHALL NOT perform local filesystem operations — it MAY reside on a different host than the CLI.
- **REQ-MCP-4a:** The CLI SHALL provide local filesystem tools directly (not via MCP): `write_file(path, content)`, `read_source_file(path)`, `export_to_file(type, path)`, `list_project_artifacts()`. These tools execute on the workstation where the CLI runs.
  - *Rationale:* The MCP server may be remote. Only the CLI is guaranteed to have local filesystem access.
- **REQ-MCP-5:** WHEN `get_agent(role, topic)` is called, THE SYSTEM SHALL retrieve the role-specific agent file from `resources/agents/`, filtered by topic if provided. IF the role is not found, THE SYSTEM SHALL return an error listing available roles.
- **REQ-MCP-6:** WHEN `get_template(name)` is called, THE SYSTEM SHALL retrieve the template from the in-memory index. IF the name is not found, THE SYSTEM SHALL return an error listing available templates.
- **REQ-MCP-7:** WHEN `load_tasks(path)` is called, THE SYSTEM SHALL parse `## Module: <name>` headers to split tasks into per-module queues. Tasks without a module header SHALL be assigned to a default module. All state changes SHALL be persisted back to the single TASKS.md file on disk.
  - *Rationale:* A single file with module headers is simpler to manage than multiple files per module — no glob discovery, no file copying, and atomic write-through updates all module state at once.
- **REQ-MCP-8:** WHEN `get_next_task(module)` is called, THE SYSTEM SHALL return the first unchecked (`- [ ]`) task for the given module, including its skill tags. The agent SHALL only ever see one task at a time.
  - *Rationale:* One task at a time keeps the agent's context window focused and prevents it from skipping ahead or reordering work.
- **REQ-MCP-9:** WHEN `complete_task(module)` is called, THE SYSTEM SHALL mark the first unchecked task as `- [x]` and write through to disk.
- **REQ-MCP-10:** The server SHALL use in-memory index for content (parsed markdown sections) and SQLite for session metadata.

### 4.3 Framework Reference Files

- **REQ-RES-1:** Role-specific agent files SHALL be loaded per phase via `get_agent()` MCP tool calls (per REQ-ARCH-6): Analyst for gather, Architect for plan and escalations, Developer for develop/automate/verify.
- **REQ-RES-2:** Skill files SHALL live in `resources/skills/` with uppercase filenames. Available skills SHALL be determined dynamically from the directory contents.
- **REQ-RES-3:** WHILE the plan phase is active, skill files SHALL be loaded on demand via `get_skill()` MCP tool calls (per REQ-ARCH-6).
- **REQ-RES-4:** WHILE the develop phase is active, skill files SHALL be loaded per-task via `get_skill()` MCP tool calls based on `[tag, ...]` annotations (per REQ-ARCH-6).
- **REQ-RES-5:** IF a skill file referenced in a task tag does not exist, THE SYSTEM SHALL print a warning and continue without loading it.

### 4.4 Phase 1 — Gather

- **REQ-G-1:** WHEN `voidrift gather <model>` is run AND the target file exists, THE SYSTEM SHALL include it in the system prompt as context for revision. IF the file does not exist, THE SYSTEM SHALL create a new file.
- **REQ-G-2:** WHEN `voidrift gather <model> <feature>` is run AND `.voidrift/REQUIREMENTS.md` does not exist, THE SYSTEM SHALL exit with error code 1.
- **REQ-G-3:** The gather phase SHALL use the shared interactive terminal loop (REQ-UI-3 through REQ-UI-5). The interactive gather agent SHALL only have access to local filesystem tools (`write_file`, `read_source_file`) provided by the CLI (REQ-MCP-4a), not the full MCP tool set. Tools SHALL be disabled by default and enabled via `/write` command (REQ-UI-4). IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt (not exit).
  - *Rationale:* Exposing all 16 MCP tools in interactive mode causes local models to enter infinite tool-call loops instead of conversing. Disabling tools by default also prevents the model from burning tokens on hidden thinking when tools are present in the request.
- **REQ-G-4:** The model SHALL ask clarifying questions before writing the output file and SHALL NOT write until it has sufficient information.
- **REQ-G-5:** The model SHALL NOT focus on technology choices unless the operator explicitly requests them.
- **REQ-G-6:** Full project gather SHALL produce `.voidrift/REQUIREMENTS.md` with sections: Goal, Users, Features, Runtime Environment, Constraints, Out of Scope.
- **REQ-G-7:** Feature gather SHALL produce `.voidrift/spec/<feature>.md` with sections: Goal, User Stories, Acceptance Criteria (BDD), Non-Functional Requirements, Edge Cases.
- **REQ-G-8:** WHEN `--from <path>` is specified, THE SYSTEM SHALL reverse-engineer requirements in three stages, each using a separate agent instance (per REQ-ARCH-7):
  1. **Triage:** Agent receives the file tree and returns a JSON list of source files to analyze (skipping build artifacts, binaries, lock files, etc.).
  2. **Analysis:** One agent per file — reads the file via `read_source_file()`, stores a summary via `store_file_analysis()`, then exits. Each agent has a clean context containing only the single file.
  3. **Synthesis:** Agent calls `get_all_analyses()` to retrieve all stored summaries, fetches formatting guidance via `get_template()` and `get_skill()` (per REQ-ARCH-6), and writes the final requirements via `write_file()`.
  The reference directory SHALL be strictly read-only. The system prompt for each stage SHALL contain only the role and stage-specific instructions.
- **REQ-G-9:** WHEN `--reference <path>` is specified, THE SYSTEM SHALL load the reference codebase read-only for lookup during interactive conversation.
- **REQ-G-10:** Gather SHALL never auto-commit. `auto-commits: false` and `dirty-commits: false` SHALL be set.

### 4.5 Phase 2 — Plan

- **REQ-P-1:** Plan SHALL always produce `.voidrift/ARCHITECTURE.md` and `.voidrift/TASKS.md`. IF either is missing after the first run, one retry SHALL be issued. IF the retry also fails, THE SYSTEM SHALL exit with code 1.- **REQ-P-2:** Planner output SHALL be fully hidden from the terminal. Only a spinner and status line SHALL be shown.
- **REQ-P-3:** WHEN `--fresh-start` is specified, THE SYSTEM SHALL delete ARCHITECTURE.md, TASKS.md, and spec/*.md before planning.
- **REQ-P-4:** `auto-commits: false` SHALL be set for the plan phase.
- **REQ-P-5:** For single-module projects, tasks SHALL be written under a `## Tasks` header. For multi-module projects, tasks SHALL be grouped under `## Module: <name>` headers in a single TASKS.md.
- **REQ-P-6:** In multi-module projects, each file path SHALL appear in exactly one module's task group. No file SHALL be created or modified by tasks in more than one module.
- **REQ-P-7:** Each task line SHALL be a single atomic file operation: `- [ ] <Action verb> <file path>: <exact behavior> [skill1, skill2]`.
- **REQ-P-8:** Tasks SHALL NOT contain shell commands. Tasks describe file content only.
- **REQ-P-9:** WHEN the architect writes task files, all skill tags SHALL be validated against available skill files. IF invalid tags are found, THE SYSTEM SHALL fail with an error listing invalid and valid tags.
- **REQ-P-10:** `.voidrift/ARCHITECTURE.md` SHALL contain: Components table, Data Models, API Surface, Configuration, Dependencies, Constraints & Limitations, Glossary.

### 4.6 Phase 3 — Develop

- **REQ-D-1:** WHEN `.voidrift/TASKS.md` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift plan`.
- **REQ-D-2:** WHEN all tasks are marked `[x]`, THE SYSTEM SHALL exit with "all tasks complete" and return 0.
- **REQ-D-3:** WHEN a develop session starts, THE SYSTEM SHALL create `.voidrift/.develop.lock` with PID and timestamp. IF the lock exists with a live PID, THE SYSTEM SHALL exit with error.
- **REQ-D-4:** WHILE the develop loop is active, THE SYSTEM SHALL process the first unchecked task from TASKS.md via `get_next_task()`. WHEN no unchecked tasks remain, the loop SHALL exit.
- **REQ-D-5:** IF the worker produces no file changes (HEAD unchanged), THE SYSTEM SHALL retry once. IF the retry also fails AND an architect is configured, THE SYSTEM SHALL escalate.
- **REQ-D-6:** WHEN the worker writes an escalation file (`.voidrift/escalations/<task_num>.md`), THE SYSTEM SHALL consult the architect and write the response to `.voidrift/architect_responses/<task_num>.md`, then retry the task.
- **REQ-D-7:** WHEN `max_escalations` (5) is exceeded for a session, THE SYSTEM SHALL mark the task `[!]` (blocked), increment `blocked_tasks`, and continue to the next task.
- **REQ-D-8:** WHEN architect is consulted, THE SYSTEM SHALL provide: problem description, REQUIREMENTS.md, ARCHITECTURE.md, and task text. Source code files SHALL NOT be loaded.
- **REQ-D-9:** Task completion SHALL be managed by the MCP server's `complete_task()` tool, which marks `- [ ]` as `- [x]` and writes through to disk.
- **REQ-D-10:** WHEN `.voidrift/TASKS.md` contains `## Module:` headers, THE SYSTEM SHALL spawn up to `--workers N` concurrent agent loops, each assigned a module. With `--workers 1` (default), modules SHALL be processed sequentially. With `--workers 0`, one worker SHALL be spawned per module.
  - *Rationale:* Single-branch execution avoids merge complexity. File ownership constraints (REQ-P-6) prevent cross-module conflicts. A commit lock (REQ-D-11) serializes git operations.
- **REQ-D-11:** WHEN multiple workers are active, git commits SHALL be serialized through a lock to prevent index conflicts.
- **REQ-D-12:** WHEN `--workers` is greater than 1 AND no module headers exist, THE SYSTEM SHALL print a warning and fall back to single-worker mode.
- **REQ-D-13:** WHEN Ctrl+C or SIGTERM is received, THE SYSTEM SHALL set an interrupted flag, send SIGTERM to active workers, allow a 2-second grace period, then SIGKILL.

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
- **REQ-U-2:** `voidrift chat <model>` SHALL start an interactive session with no git context (`--no-git`).
- **REQ-U-3:** `voidrift log <phase>` SHALL show the last 200 lines of the most recent log. `--prune` SHALL delete log files.
- **REQ-U-4:** `voidrift unlock` SHALL remove the develop lock file and kill any running develop process.
- **REQ-U-5:** `voidrift completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. All model, worker, and architect arguments SHALL complete from configured aliases in `models.yml`.

### 4.10 Model Configuration

- **REQ-MC-1:** WHEN a model alias is used, THE SYSTEM SHALL resolve it to `(base_url, api_key, model_id)` from a models config file (`models.yml`). IF the alias is not found, THE SYSTEM SHALL exit with an error listing available aliases.
- **REQ-MC-2:** Cloud models SHALL require no initialization and be accessed directly via API endpoints.
- **REQ-MC-3:** The models config file SHALL support three endpoint types: `local` (worker node vLLM), `cloud` (provider APIs), and `gateway` (Kiro Gateway). Each entry specifies `base_url`, `api_key` (or env var reference), and `model_id`.

### 4.11 Worker CLI

- **REQ-WK-1:** The Worker CLI (`worker-cli/`) SHALL be a separate Python package providing the `worker` command, installed independently from the VoidRift CLI.
- **REQ-WK-2:** `worker start <alias>` SHALL SSH to the worker node, stop any running model container, start the requested model container, and poll until the API health check responds. During polling, the system SHALL check `docker ps` to detect container exit — IF the container is no longer running, THE SYSTEM SHALL exit immediately with the container's logs as error context.
- **REQ-WK-3:** `worker stop` SHALL SSH to the worker node and stop the active model container.
- **REQ-WK-4:** `worker status` SHALL report the active model (if any), container health, and API endpoint URL.
- **REQ-WK-5:** `worker bench [<num_prompts>] [<req_rate>]` SHALL benchmark the active model using vLLM's benchmark tool via SSH.
- **REQ-WK-6:** `worker models list` SHALL display configured models (from `worker-models.yml`) and cached models (from HF cache) with clear section headers.
- **REQ-WK-6a:** `worker models add <alias> <repo>` SHALL add a new model to `worker-models.yml` AND download the weights. IF the alias already exists, THE SYSTEM SHALL exit with an error.
- **REQ-WK-6b:** `worker models remove <alias>` SHALL delete the cached weights AND move the model config to a `retired` section in `worker-models.yml`.
- **REQ-WK-6c:** `worker models check` SHALL audit all configured models, verify cache integrity, and attempt to download missing weights for configured models. It SHALL report unconfigured models in the cache. With `--prune`, it SHALL remove unconfigured cached models.
- **REQ-WK-7:** Only one local model container SHALL run at a time on the worker node.
- **REQ-WK-8:** Model configurations SHALL be defined in `worker-models.yml` specifying: repository, docker image, GPU memory utilization, max model length, vLLM args, served model name, and cache mounts.
- **REQ-WK-9:** `worker kiro start` SHALL start the Kiro Gateway container. `worker kiro stop` SHALL stop it. `worker kiro status` SHALL report health and available models.
- **REQ-WK-10:** WHEN Kiro Gateway credentials are invalid (expired token, database permissions), THE SYSTEM SHALL stop immediately with a clear error message identifying the failure mode.
  - *Rationale:* Prevents the CLI from entering an infinite retry loop against invalid credentials. The error message directs the operator to the specific fix (re-login, chmod).
- **REQ-WK-11:** `worker logs [-f]` SHALL list all worker containers (running and stopped) with status, mark the active one, and prompt the user to select one. It SHALL then show that container's logs. IF no containers exist, it SHALL exit with an error.
- **REQ-WK-12:** `worker info` SHALL report worker node GPU status (`nvidia-smi`), disk usage (`df -h`), and memory (`free -h`) over SSH.
- **REQ-WK-13:** `worker images pull [<image>]` SHALL pull a vLLM docker image on the worker node. IF no image is specified, THE SYSTEM SHALL pull the default image from `worker-models.yml`. `worker images list` SHALL list docker images on the worker node.
- **REQ-WK-14:** `worker cache clear` SHALL remove compiled kernel caches (flashinfer, vllm) on the worker node over SSH.
- **REQ-WK-15:** `worker check` SHALL verify worker node prerequisites over SSH: Docker available, NVIDIA GPU accessible (`nvidia-smi`), `uvx` on PATH, and SSH connectivity. Each check SHALL report pass/fail. IF any check fails, THE SYSTEM SHALL exit with code 1.
- **REQ-WK-16:** All `worker` CLI help output SHALL follow the CLI Help Convention defined in SYSTEMS-ENG skill. WHEN an unknown command or invalid arguments are given, THE SYSTEM SHALL display the error and help text (no tracebacks).
- **REQ-WK-17:** `worker completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. Alias arguments SHALL complete from configured models in `worker-models.yml`.

### 4.12 Git

- **REQ-GIT-1:** Planning artifacts SHALL be committed in a single commit with message `"docs: add planning artifacts"`.
- **REQ-GIT-2:** WHILE the develop phase is active, source code SHALL be committed per task with task-specific messages. WHEN multiple workers are active, commits SHALL be serialized through a lock.
- **REQ-GIT-3:** `auto-commits: false` SHALL be set only for the plan phase.

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
- **REQ-UI-3:** ALL interactive conversation phases (gather, chat) SHALL use a consistent plain-terminal interface with: a dim header block (phase name, log path, model label), a `prompt_toolkit` multi-line input (blank line to submit, backspace/arrows work across lines), streamed model responses via `on_token` callback, and a dim stats line after each response showing token count, tokens/sec, and elapsed time.
- **REQ-UI-4:** The `/write` command in gather SHALL enable file-writing tools for that turn only. Any user message starting with `/write` OR equal to common write phrases (e.g. "please write the file now", "write it", "go ahead and write") SHALL trigger tool activation. Tools SHALL be disabled by default during conversation to avoid model thinking-token overhead. Chat SHALL always have its tools available.
- **REQ-UI-5:** Interactive sessions SHALL handle Ctrl+C gracefully (print dim "Session ended." and exit), handle EOF on input (exit cleanly), and log all operator input and model responses to the session log file.

### 4.16 Framework Configuration

- **REQ-CFG-1:** All framework configuration SHALL be read from `~/.voidrift/config.yml`. Config files SHALL support `${VAR}` and `${VAR:-default}` for environment variable expansion, and `${section.key}` for cross-referencing values from config.yml.
- **REQ-CFG-2:** `config.yml` SHALL contain sections for: `worker` (user, ip, api_key, hf_token), `kiro` (port, api_key), and `api_keys` (anthropic, gemini). Connection settings are literal values; secrets use env var references.
- **REQ-CFG-3:** Framework resources (agents, skills, templates), `models.yml`, and `worker-models.yml` SHALL be read from `~/.voidrift/`. The repo is the source of truth; `make sync` copies to `~/.voidrift/`.
- **REQ-CFG-4:** `VOIDRIFT_HOME` env var MAY override `~/.voidrift/` for testing and CI. IF not set, `~/.voidrift/` is used.

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
| V-MCP-3 | REQ-MCP-5 | Test | `test_server_tools.py::TestGetAgent` — role retrieval and errors |
| V-MCP-4 | REQ-MCP-6 | Test | `test_server_tools.py::TestGetTemplate` — template retrieval |
| V-MCP-5 | REQ-MCP-7 | Test | `test_task_store.py` — module parsing, single and multi |
| V-MCP-6 | REQ-MCP-8 | Test | `test_task_store.py::test_get_next` — returns first unchecked |
| V-MCP-7 | REQ-MCP-9 | Test | `test_task_store.py::test_complete_writes_through` |
| V-ARCH-1 | REQ-ARCH-2 | Test | `test_phases.py::TestCLICommands` — subcommands exist |
| V-ARCH-2 | REQ-ARCH-4 | Test | `test_agent.py` — agent loop sends/receives messages |
| V-ARCH-3 | REQ-ARCH-6 | Test | `test_agent.py::TestBuildMcpTools` — tools present, no direct reads |
| V-G-1 | REQ-G-2 | Test | `test_phases.py::TestGatherPreflightChecks` |
| V-P-1 | REQ-P-1 | Test | `test_phases.py::TestPlanPreflightChecks` — artifact production |
| V-P-2 | REQ-P-6 | Analysis | Code review of generated TASKS.md for file ownership |
| V-D-1 | REQ-D-1 | Test | `test_phases.py::TestDevelopPreflightChecks::test_missing_tasks` |
| V-D-2 | REQ-D-2 | Test | `test_phases.py::TestDevelopPreflightChecks::test_all_tasks_complete` |
| V-D-3 | REQ-D-3 | Test | `test_phases.py::TestDevelopPreflightChecks::test_lock_file_stale` |
| V-D-4 | REQ-D-10 | Test | `test_phases.py::TestDevelopPreflightChecks::test_workers_without_modules` |
| V-U-1 | REQ-U-1 | Test | `test_phases.py::TestCLICommands::test_status_command` |
| V-U-2 | REQ-U-3 | Test | `test_phases.py::TestCLICommands::test_log_view` |
| V-U-3 | REQ-U-4 | Test | `test_phases.py::TestCLICommands::test_unlock_no_lock` |
| V-MC-1 | REQ-MC-1 | Test | `test_models.py::TestResolveModel` — alias resolution from config |
| V-MC-2 | REQ-MC-2 | Test | `test_models.py::TestResolveModel::test_cloud_models` |
| V-WK-1 | REQ-WK-2 | Test | `test_worker.py` — container start/stop via SSH |
| V-WK-2 | REQ-WK-10 | Test | `test_worker.py::TestKiroGateway::test_validate_credentials_expired` |

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
├── analyses/                 # Per-file analysis (write-through from MCP)
│   └── <sanitized_path>.md
├── escalations/              # Developer escalation questions
│   └── [module/]<task_num>-<N>.md
├── architect_responses/      # Architect guidance
│   └── [module/]<task_num>-<N>.md
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
