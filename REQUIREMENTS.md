# Project VoidRift: Local-first Agentic Development Framework Requirements

## System Architecture

Project VoidRift consists of multiple components working together:

**Source:** `~/Projects/voidrift/` (monorepo)

**Production:**
- `~/opt/voidrift/cli/` — installed CLI
- `~/opt/voidrift/mcp-context-server/` — installed MCP server
- `~/opt/voidrift/resources/` — framework reference files

**Per-project:** `<project>/.voidrift/` — project artifacts (committed to git)

### 1. VoidRift CLI (`cli/`)

Python CLI providing the `voidrift` command with subcommands for all five phases. Replaces the bash-based dispatcher.sh.

**AC-CLI1 — Command Interface:** The CLI provides subcommands: `gather`, `plan`, `develop`, `automate`, `verify`, `chat`, `status`, `bench`, `log`, `unlock`. Direct commands (`voidrift gather kiro-sonnet`) work for power users.

**AC-CLI2 — Interactive Mode:** When `voidrift` is run with no arguments, it launches an interactive guided flow:
- Presents a menu of available actions (gather, plan, develop, automate, verify, chat, status)
- Prompts for model selection from available models
- Prompts for phase-specific options (e.g., new vs existing codebase for gather, worker + architect for develop)
- Launches the selected phase with chosen options

**AC-CLI3 — Agent Loop:** The CLI implements an agent loop that sends messages to model APIs (OpenAI-compatible for local/kiro, native for cloud), handles MCP tool calls from the model, and streams responses to the terminal. Replaces aider as the execution engine.

**AC-CLI4 — Interactive Chat:** The `gather` command (without `--from`) provides an interactive terminal chat where the operator converses with the model. The model has MCP tools available to read/write requirements.

**AC-CLI5 — Model Management:** The CLI manages model lifecycle: starts/stops local containers via SSH, starts/stops Kiro Gateway, validates credentials, maps model aliases to API endpoints.

**AC-CLI6 — Installation:** Source at `~/Projects/voidrift/cli/`. Built with `pyproject.toml`. Deployed to `~/opt/voidrift/cli/`.

### 2. MCP Context Server (`mcp-context-server/`)

Python MCP server that stores, retrieves, and exports project artifacts and framework resources. The model pulls context on demand via tool calls instead of loading full files into the context window.

**AC-MCP1 — Server:** An MCP server at `~/opt/voidrift/mcp-context-server/` built with Python/FastMCP, communicates via stdio. Source at `~/Projects/voidrift/mcp-context-server/`.

**AC-MCP2 — Framework Resources:** The server loads framework files from `~/opt/voidrift/resources/` (agents/*.md, skills/*.md, templates/*.md), indexes them by markdown header, and serves targeted sections on demand.

**AC-MCP3 — Project Artifacts:** The server reads/writes project artifacts in `<project>/.voidrift/`. Uses write-through storage: `store_*` tools write to both in-memory cache and disk simultaneously. Memory serves as a read cache; disk is the source of truth. No data is lost if the server process exits unexpectedly.

**AC-MCP4 — Tools:** The server exposes tools including: `store_file_analysis()`, `get_file_analysis()`, `get_all_analyses()`, `store_requirements()`, `get_requirements()`, `get_agent(role, topic)`, `get_skill(name, topic)`, `get_template(name)`, `read_source_file(path)`, `write_file(path, content)`, `export_to_file(type, path)`.

**AC-MCP4a — `get_agent(role, topic)`:** Retrieves a role-specific agent file from `resources/agents/`. The `role` parameter accepts `analyst`, `architect`, or `developer` (case-insensitive). When `topic` is provided, returns only matching sections from the indexed markdown. When empty, returns the full file content. Returns an error listing available roles if the role is not found.

**AC-MCP4b — `get_template(name)`:** Retrieves a template file from `resources/templates/`. The `name` parameter accepts the template name without path or extension (e.g. `adr-template`, `architecture-template`). Returns the full file content. Returns an error listing available templates if the name is not found.

**AC-MCP5 — Storage:** In-memory index for content (parsed markdown sections). SQLite for session metadata (context tracking, what was loaded, what changed).

**AC-MCP6 — Context Boundary:** The CLI never reads framework resource files (`resources/`, skills, agents, templates) directly. All framework context is served exclusively through MCP server tool calls. The CLI's role is orchestration: phase sequencing, model lifecycle, agent loop, and git operations. In-flight session state (analyses, drafts, intermediate artifacts) is held by the MCP server. Final compiled artifacts are written to `<project>/.voidrift/`.

### 3. Framework Reference Files (`resources/`)

Core documents that define voidrift identity, operational rules, and editing conventions. Loaded as read-only context in aider sessions to guide model behavior.

**Implementation:** Markdown files in `<VOIDRIFT_HOME>/` loaded via aider config `read:` lists.

#### 2a. AGENT.md — Agent Identity & Philosophy

**Purpose:** Defines who the voidrift is, what it believes in, and how it operates across the five-phase lifecycle. Provides personality, backstory, and philosophical foundation.

**Loaded by:** All aider sessions (all phases)

**Acceptance Criteria:**

**AC-AGENT1:** AGENT.md defines voidrift identity with:
- Identity statement (Analyst, Architect, or Developer role)
- Runtime role assignment via `[ROLE: X]` prefix in task messages
- Core philosophy (SOLID, Clean Architecture, PoLP, End-to-End Traceability)
- Observability principles (Four Golden Signals)

**AC-AGENT2:** AGENT.md documents the five-phase lifecycle with overview and purpose of each phase (Gather → Plan → Develop → Automate → Verify).

**AC-AGENT3:** AGENT.md defines three distinct roles:
- **Analyst:** Elicits requirements through questions, focuses on "what" not "how", produces requirements documents. Does NOT make technology choices, design architecture, or create tasks. Receives existing requirements (if revising) and operator responses.
- **Architect:** Designs structure, creates roadmap, answers design questions, provides guidance. Does NOT write implementation code or handle boilerplate. During escalation consultations, receives problem description, REQUIREMENTS.md, ARCHITECTURE.md, and task text — NOT source code files.
- **Developer:** Executes tasks, writes tests/docs/boilerplate, makes one fix attempt, escalates when blocked. Does NOT run shell commands during develop or make architectural decisions. Notes that Developer and Architect may be different models during develop phase.

**AC-AGENT4:** For each phase, AGENT.md specifies:
- Purpose (what the phase accomplishes)
- Your role (Architect or Developer)
- Goal (specific outcome)
- Artifacts (files produced)
- Key behaviors (what to do and what NOT to do)

**AC-AGENT5:** AGENT.md documents State Management:
- STATE.md is session memory for context continuity
- Structure (single-module vs multi-module)
- Developer responsibility (reference it, update during compaction, don't manually edit)
- When to compact (every 10 turns, task completion, context window full)

**AC-AGENT6:** AGENT.md documents Skill System:
- Skills define canonical tech stack and conventions
- Plan time: all skills loaded
- Develop time: only tagged skills loaded per task
- Skills are read-only and authoritative
- Available skills list
- Skill tagging rules (be selective, minimize context window)

**AC-AGENT7:** AGENT.md documents Escalation Protocol:
- When to escalate (blocked, error persists, needs guidance, verification failure)
- How escalation works (mark `[!]`, create escalation file, framework consults architect, architect responds, continue with guidance)
- Architect consultation context (problem description, REQUIREMENTS.md, ARCHITECTURE.md, task text — NOT source code)
- Two-model system: Developer and Architect may be different models during develop
- What NOT to do (no retries, no guessing, no skipping escalation)

**AC-AGENT8:** AGENT.md documents TASKS.md format and execution protocol:
- Task structure (checkbox, verb phrase, skill tags)
- Execution steps (execute, test, mark, commit, next)
- Skill tag usage

**AC-AGENT9:** AGENT.md documents Cost & Token Optimization:
- Division of labor (Architect: design/complex, Developer: boilerplate/tests/docs)
- Response style (minimal, no narration)
- Context management (caching, contextual skill loading, compaction)
- Error handling (one attempt, then escalate)

**AC-AGENT10:** AGENT.md includes Framework Reference Files table showing which files are loaded when and for what purpose.

**AC-AGENT11:** AGENT.md tone is identity-focused: "This is who you are and what you believe in." It provides philosophical foundation, not operational procedures.

#### 2b. Other Shared Infrastructure

- **templates/EDIT-FORMAT.md** — File editing instructions (loaded during Develop, Automate, Verify)
- **Skill files** (`skills/*.md`) — Domain-specific conventions (loaded contextually during Develop)
- **Aider configurations** (`.aider.*.yml`) — Phase-specific aider settings
- **Templates** (`templates/*.md`) — Document scaffolding for requirements, design, and ADRs

### 4. Future Components
Additional components to be defined in separate requirements documents.

---

## Agent Dispatcher Requirements

### Goal

A local-first AI development lifecycle tool that routes work between a worker model (primary execution) and an optional architect model (escalation and design). The five phases — Gather → Plan → Develop → Automate → Verify — produce a deployable, tested project from requirements alone. All compute-intensive implementation runs on a local worker node; architect models are consulted for planning and escalation only.

### Users

- **Operator:** Human who runs phase commands, reviews artifacts, corrects bad behaviors, and edits task files.
- **Developer:** Model that executes implementation tasks. Can be local or cloud. Executes file edits atomically during develop, automate, and verify phases. Cannot and must not run shell commands.
- **Architect:** Model that performs planning and design work. Can be local or cloud. Creates task files and architecture decisions during plan phase. Consulted during develop phase when worker is blocked. Reformulates tasks, answers design questions, and creates fix plans. Never writes source code directly.

### Prerequisites

**Environment Variables:**

*Framework Configuration:*
- `VOIDRIFT_HOME` — Path to the framework installation directory containing skill files, aider configs, scripts, and templates. Referenced throughout this document as `<VOIDRIFT_HOME>`. Default: `$HOME/.voidrift`

*Local Developer Node (required for local models):*
- `WORKER_USR` — SSH username for worker node (e.g., `tjpresley`)
- `WORKER_IP` — IP address of the worker node running local LLM containers (e.g., `192.168.50.100`)
- `OPENAI_API_BASE` — OpenAI-compatible API endpoint for local models (e.g., `http://$WORKER_IP:8000/v1`)
- `OPENAI_API_KEY` — Dummy key for local models (e.g., `no-key-needed-here`)

*Cloud Model APIs (required for cloud models):*
- `ANTHROPIC_API_KEY` — API key for Claude models
- `GEMINI_API_KEY` — API key for Gemini models
- `HF_TOKEN` — Hugging Face token for model downloads

*Kiro Gateway (optional, for kiro-* models):*
- `KIRO_GATEWAY_PORT` — Port for Kiro Gateway proxy (default: 8000)
- `KIRO_API_KEY` — API key for Kiro Gateway authentication (PROXY_API_KEY from gateway's .env file)

**Kiro Gateway Integration:**

The framework supports kiro-* models (kiro-sonnet, kiro-haiku, kiro-deepseek, kiro-minimax, kiro-qwen) which provide free access to Claude and other AI models through Amazon Q Developer / AWS CodeWhisperer credentials via [Kiro Gateway](https://github.com/jwadow/kiro-gateway).

**AC-KIRO1:** When a model name starts with `kiro-`, the framework:
- Maps kiro aliases to actual model names: `kiro-sonnet` → `claude-sonnet-4-5`, `kiro-haiku` → `claude-haiku-4-5`, `kiro-deepseek` → `deepseek-v3-2`, `kiro-minimax` → `minimax-m2-1`, `kiro-qwen` → `qwen3-coder-next`
- Prefixes the mapped model with `openai/` for aider compatibility (e.g., `openai/claude-sonnet-4-5`)
- Adds `--openai-api-base http://localhost:${KIRO_GATEWAY_PORT}/v1` to all aider invocations
- Sets `OPENAI_API_KEY` from `KIRO_API_KEY` environment variable for authentication
- Uses `KIRO_GATEWAY_PORT` environment variable (defaults to 8000 if not set)

**AC-KIRO2:** The `_aider_with_model` wrapper function handles base URL injection and API key authentication for kiro models transparently across all 17 aider invocations in the framework (gather, plan, develop, automate, verify, chat, escalations, state updates, merge conflicts).

**AC-KIRO3:** Kiro Gateway container lifecycle is managed automatically:
- `_is_kiro_model` checks if model name starts with `kiro-`
- `_start_kiro_gateway` starts the container if not running (via docker-compose or existing container)
- Waits for health check at `http://localhost:${KIRO_GATEWAY_PORT}/health` (30s timeout)
- `_stop_kiro_gateway` stops the container after phase completion to free resources
- `_ensure_model_ready` unified function starts local worker or kiro gateway as needed
- `_cleanup_model` stops kiro gateway on both success and error paths

**AC-KIRO4:** Kiro Gateway must be installed at `~/opt/kiro-gateway` with `docker-compose.yml` configured. Installation and configuration instructions are provided in README.md. The framework will start/stop the container automatically when using kiro-* models.

**AC-KIRO5 — Credential Validation:** After the Kiro Gateway health check passes, the framework sends a minimal test request to verify credentials are valid before proceeding:
- Sends a short completion request to the gateway's `/v1/chat/completions` endpoint
- If the request fails with a 500 error (e.g., expired refresh token), the framework stops immediately with a clear error message
- Detects specific failure modes:
  - **Database permissions:** The Kiro CLI database (`data.sqlite3`) is not readable by the gateway container. Directs user to fix with `chmod 644`.
  - **Expired tokens:** The stored tokens have expired. Directs user to run `kiro-cli logout && kiro-cli login` and restart the gateway.
- Prevents aider from entering an infinite retry loop against invalid credentials

---

## Phase 1 — Gather (`voidrift gather`)

### Purpose
Produce a requirements artifact through an interactive conversation with a model. No architecture, technology choices, or code are discussed during this phase.

### Command Signatures
```
voidrift gather <model>              # full project → .voidrift/REQUIREMENTS.md (create or revise)
    <model>       Any model; acts as requirements gatherer in interactive mode

voidrift gather <model> <feature>    # feature spec → .voidrift/spec/<feature>.md (create or revise)
    <model>       Any model; acts as requirements gatherer in interactive mode
    <feature>     Feature name for spec file

voidrift gather <model> --from <path>              # reverse engineer full project from existing code
voidrift gather <model> <feature> --from <path>    # reverse engineer feature from existing code
    --from <path>  Path to existing codebase (loaded read-only, respects .gitignore)
                   Non-interactive mode: auto-generates requirements
                   Errors if target file exists (use --force to overwrite)
    --force        Overwrite existing requirements when using --from

voidrift gather <model> --reference <path>              # interactive with reference codebase
voidrift gather <model> <feature> --reference <path>    # interactive feature spec with reference
    --reference <path>  Path to reference codebase (loaded read-only for lookup/clarification)
                        Interactive mode: analyst can examine code during conversation
```

### Acceptance Criteria

**AC-G1:** If the target file exists (`.voidrift/REQUIREMENTS.md` for full project, `.voidrift/spec/<feature>.md` for feature), the file is loaded into the interactive session for revision. If the file does not exist, a new file is created. No prompts or flags are required - behavior is determined by file existence.

**AC-G2:** If `voidrift gather <model> <feature>` is run and `.voidrift/REQUIREMENTS.md` does not exist, the command exits with an error message: "REQUIREMENTS.md not found. Run 'voidrift gather <model>' first to create project requirements." Returns exit code 1.

**AC-G3:** Gather is always interactive. Model output streams directly to the terminal in real time. It is never backgrounded, logged-only, or hidden behind a spinner.

**AC-G4:** The model must ask clarifying questions before writing the output file. It does not write the file until it has sufficient information to produce complete, testable criteria. The conversation may span multiple exchanges.

**AC-G5:** The model should not focus on technology choices, implementation approach, infrastructure, or frameworks during gather **unless the operator explicitly requests them**. It should focus on user needs and system behavior first. When the operator specifies technology requirements (e.g., "use FastAPI", "must be containerized"), these should be captured in the Constraints section of REQUIREMENTS.md.

**AC-G6 — Full project gather** produces `.voidrift/REQUIREMENTS.md` with exactly these sections:
- **Goal** — one paragraph describing what the system does and who it serves
- **Users** — list of user roles with one-line descriptions
- **Features** — high-level list of capabilities the system must provide (no implementation detail, no checkboxes)
- **Runtime Environment** — two sub-sections: Local development (tools, how to run) and Production (deployment method)
- **Constraints** — technology requirements (must use X, cannot use Y), regulatory/compliance requirements, team skill constraints, budget/licensing constraints
- **Out of Scope** — what the system will not do

**AC-G7 — Feature gather** produces `.voidrift/spec/<feature>.md` with exactly these sections:
- **Goal** — one paragraph describing what this feature accomplishes
- **User Stories** — each in format: "As a [role], I want [capability] so that [benefit]"
- **Acceptance Criteria** — BDD format: "Given [context], When [action], Then [outcome]" — one per behavior, covering happy path and all key failure/edge cases
- **Non-Functional Requirements** — performance, security, accessibility, and scale constraints that are requirements (not implementation choices)
- **Edge Cases** — boundary conditions and exceptional scenarios the system must handle

**AC-G8:** After writing `.voidrift/REQUIREMENTS.md`, the model lists all identified features and explicitly tells the user to run `voidrift gather <model> <feature>` for each before proceeding to plan.

**AC-G9:** The gather session runs through aider in interactive (tee) mode with the specified model. The gather aider config (`<VOIDRIFT_HOME>/.aider.gather.yml`) is used for all gather sessions.

**AC-G10:** `.voidrift/spec/` is created automatically if it does not exist before writing a feature spec.

**AC-G11 — Reverse Engineering Mode:** When `voidrift gather <model> --from <path>` is run:
- The command must be run from the new project directory (where REQUIREMENTS.md will be created)
- If the target file already exists, the command errors with message: "Error: [file] already exists. Use --force to overwrite, or run without --from to revise interactively."
- With `--force` flag, existing file and log are deleted before starting (clean slate)
- **Reference directory (`<path>`) is strictly read-only:**
  - No files are created, modified, or deleted in the reference directory
  - No `cd` into the reference directory
  - No git operations against the reference repository
  - Reference files are loaded via `--read` (read-only) only
- **All artifacts are written to the current (target) project's `.voidrift/` directory:**
  - `.voidrift/source-files.txt` — list of identified source files
  - `.voidrift/codebase-analysis.md` — per-file analysis and summary
  - `.voidrift/REQUIREMENTS.md` — generated requirements
  - Aider operates on root-level temp files (e.g., `source-files.txt`, `codebase-analysis.md`) during each phase, then moves them to `.voidrift/` on completion. This avoids path resolution issues with aider's `--no-git` mode.
- **Three-phase process (all phases run in the target project directory):**
  1. **Identify source files:**
     - Builds a file tree from the reference directory (excluding `.git/`, `node_modules/`, `__pycache__/`, `.cache/`)
     - Model classifies files as source vs build artifacts (no hardcoded file extension patterns)
     - Writes identified source file paths to `.voidrift/source-files.txt`
  2. **Analyze source files one at a time:**
     - Each file is loaded individually via `--read` (read-only) from the reference directory to avoid context overflow
     - Model appends per-file analysis (purpose, functionality, dependencies, issues) to `.voidrift/codebase-analysis.md`
     - File is unloaded before the next file (separate aider invocation per file)
     - Progress shown: `[N/total] relative/path`
  3. **Generate summary:**
     - Model reads the per-file analysis and appends a consolidated summary
     - Summary covers: what the code does, tech stack, features, architecture, users, issues, constraints
- **Requirements generation** uses the completed analysis as input to produce `.voidrift/REQUIREMENTS.md` following AC-G6 format
- All aider calls use `--no-git` to prevent any commits
- Does NOT load framework config during analysis phases
- Treats **code as ground truth, documentation as claims to verify**
- The `--from` flag works with feature mode: `voidrift gather <model> <feature> --from <path>` produces `.voidrift/spec/<feature>.md`
- **Full output visible** to operator during analysis and logged to `gather-*.log`
- After generation, user can run normal `voidrift gather <model>` to interactively refine the requirements

**AC-G12 — Reference Mode:** When `voidrift gather <model> --reference <path>` is run:
- The session is interactive (normal gather behavior)
- The reference codebase at `<path>` is loaded in read-only mode (respects .gitignore)
- The Analyst can examine the reference code during conversation to look up functionality, patterns, or technical details
- Useful for refining requirements when you need to reference an existing implementation
- Works with feature mode: `voidrift gather <model> <feature> --reference <path>`

**AC-G13:** Gather never auto-commits. The operator must explicitly commit requirements changes when satisfied. `auto-commits: false` and `dirty-commits: false` are set in the gather config.

### Artifacts
- `.voidrift/REQUIREMENTS.md` (full project) or `.voidrift/spec/<feature>.md` (feature)
- `gather-*.log`

---

## Phase 2 — Plan (`voidrift plan`)

### Purpose
Produce task files, an architecture decision record, and `.voidrift/ARCHITECTURE.md` from requirements. No source code is written during this phase. The planner maps "how" to every "what" from the requirements.

### Command Signature
```
voidrift plan <model> [<feature>] [--fresh-start]
    <model>       Model that performs planning and architecture work (architect role)
    [<feature>]   Optional feature name to plan (default: full project)
    --fresh-start Delete existing planning artifacts before starting (optional)
```

### Context Loaded by Planner
The planner reads all of the following before generating output:
1. `.voidrift/REQUIREMENTS.md` (mandatory — aborts if missing)
2. All `.voidrift/spec/*.md` feature files not already covered by existing `.voidrift/TASKS.md` entries
3. All skill files in `<VOIDRIFT_HOME>/skills/*.md` — so the planner knows required frameworks, libraries, and conventions per domain before writing tasks
4. ADR template (`<VOIDRIFT_HOME>/templates/ADR-TEMPLATE.md`)
5. Design template (`<VOIDRIFT_HOME>/templates/DESIGN-TEMPLATE.md`)
6. Architecture template (`<VOIDRIFT_HOME>/templates/ARCHITECTURE-TEMPLATE.md`)
7. Role-specific agent file (loaded via `.aider.plan.yml` `read:` list)

### Acceptance Criteria

**AC-P1:** Plan always produces at minimum: `.voidrift/ARCHITECTURE.md` and at least one task file (`.voidrift/TASKS.md` or one or more `.voidrift/TASKS-<module>.md`). If either is missing after the first run, one retry is issued with an explicit correction message. If the retry also fails to produce required artifacts, the command exits with code 1 and an error message indicating which artifacts are missing.

**AC-P2:** Planner output is fully hidden from the terminal. Only a spinner and a brief status line are shown while planning runs. All model output, including thinking and intermediate steps, is written exclusively to `plan-*.log`.

**AC-P3:** At the start of each plan run, a header is appended to `plan-*.log` with the current timestamp and command invocation. The aider cache (`.aider.tags.cache.v4/`) and chat history (`.aider.chat.history.md`) are deleted before each plan run to prevent stale context.

**AC-P3a:** When `--fresh-start` flag is specified, the following files are deleted before planning begins:
- `.voidrift/ARCHITECTURE.md`
- `.voidrift/TASKS*.md` (all task files)
- `.voidrift/adr/` (entire directory)
- `.voidrift/spec/*.md` (all feature spec files)

This allows regenerating the plan from scratch without manually deleting files.

**AC-P4:** `auto-commits: false` is set for the plan phase. Aider edits files but never commits them. Committing is done selectively by the framework after validation.

**AC-P5:** Only known planning artifacts are staged and committed after a successful run:
- `.voidrift/TASKS.md`
- `.voidrift/TASKS-<module>.md` files
- `.voidrift/ARCHITECTURE.md`
- `.voidrift/adr/*.md`
- `.voidrift/spec/*.md`

  Any file with a language-keyword name (e.g., a file literally named `python`, `typescript`, `code`) or other artifact files created by misformatted model output are left untracked and never committed.

**AC-P6:** The `edit-format: whole` setting is used for planning. This prevents SEARCH/REPLACE failures that occur when aider commits `.voidrift/ARCHITECTURE.md` mid-response, which would cause subsequent SEARCH blocks to fail to match and reject the entire response including new `.voidrift/TASKS-*.md` files.

**AC-P7 — Subproject identification:** A subproject is an independently deployable unit with its own source tree that does not share source files with other subprojects (e.g., a backend API and a frontend SPA). The planner:
1. Lists all deployable units implied by requirements
2. Creates one `.voidrift/TASKS-<module>.md` per subproject when there are two or more
3. Creates a single `.voidrift/TASKS.md` when there is only one deployable unit
4. Always creates `.voidrift/TASKS-infra.md` when any build, packaging, or deployment artifact is required

**AC-P8 — .voidrift/TASKS-infra.md triggers:** A `.voidrift/TASKS-infra.md` must be created whenever the project requires any of:
- Containerized: `Dockerfile`, `Containerfile`, `docker-compose.yml`, `podman-compose.yml`
- Native/binary: `Makefile`, `CMakeLists.txt`, build scripts, install scripts, systemd/launchd units
- Cloud/IaC: Terraform, CDK, Pulumi, Ansible playbooks
- Distribution: `.deb`/`.rpm` packaging, Homebrew formula, snap/flatpak, GitHub Releases workflow
- Config/secrets: `.env.example`, config file templates, secrets rotation scripts
- CI/CD: GitHub Actions workflows, Jenkinsfiles, GitLab CI configs

**AC-P9 — Task format requirements:** Each task line must be a single atomic file operation with this exact format:

```
- [ ] <Action verb> <file path>: <exact behavior with inputs, outputs, rules> [skill1, skill2]
```

**Required elements:**
- **Action verb:** Create, Update, Add, Implement, Define (never "Design", "Plan", "Consider")
- **File path:** Exact relative path from project root (e.g., `src/services/weather.ts`, `package.json`)
- **Exact behavior:** Specific inputs, outputs, return types, error handling, validation rules
- **Skill tags:** Only skills directly needed for this specific task

**Good examples:**
```
- [ ] Create src/types/weather.ts: Define WeatherData interface with temp (number), feelsLike (number), windSpeed (number), windDirection (number), description (string), icon (string) [frontend]
- [ ] Create src/services/weather.ts: Implement fetchWeather(lat: number, lon: number) that calls OpenWeather One Call API, returns WeatherData or throws Error with message, includes 3-retry logic with 1s delay [frontend]
- [ ] Update package.json: Add dependencies: axios@^1.6.0, date-fns@^3.0.0 [frontend]
- [ ] Create src/components/WeatherDisplay.vue: Implement component that accepts weatherData prop (WeatherData | null), displays temp/feelsLike/wind or "Loading..." if null, emits 'refresh' event on error [frontend]
```

**Bad examples (too vague):**
```
- [ ] Define system architecture with BFF pattern
- [ ] Design data flow between components
- [ ] Implement data fetching from external services
```

These are not tasks - they're categories. Each must be broken into specific file operations.

**AC-P10 — No shell commands in tasks:** Tasks describe file content to create or modify. The worker is a file editor and cannot execute shell commands. Tasks must never say "run npm install", "run pip install", "execute make", etc. Instead, they describe the resulting files (e.g., "Create `package.json` with `dependencies` field listing `axios@^1.6`").

**AC-P11:** Infrastructure tasks (`[infra]` tagged) are placed exclusively in `.voidrift/TASKS-infra.md`. They are never mixed into source subproject task files.

**AC-P12:** Skill tags are chosen from the available skills in `<VOIDRIFT_HOME>/skills/`. Only skills directly relevant to a specific task are tagged. Over-tagging wastes context window on every aider invocation for that task.

**AC-P13:** After the architect writes task files, all skill tags used in tasks are validated against the available skill files in `<VOIDRIFT_HOME>/skills/`. If any invalid tags are found, the plan phase fails with an error listing the invalid tags and the available valid tags. The operator must correct the task files before proceeding.

**AC-P14:** Feature plan: produces `.voidrift/adr/ADR-NNN-<feature>.md`. ADR number is chosen by inspecting existing files in `.voidrift/adr/` and incrementing.

**AC-P15:** Full project plan: produces `.voidrift/adr/ADR-001-architecture.md` as the master architectural decision record.

**AC-P16:** `.voidrift/ARCHITECTURE.md` is the shared technical reference for all workers during develop. It contains: Components table, Data Models, API Surface, Configuration, Dependencies, Decisions (ADR references), Constraints & Limitations, Glossary. If it already exists, only the affected sections are updated; all other content is preserved.

### Artifacts
- `.voidrift/TASKS.md` (single subproject) or `.voidrift/TASKS-<module>.md` files (multiple subprojects)
- `.voidrift/ARCHITECTURE.md`
- `.voidrift/adr/ADR-NNN-<title>.md`
- `plan-*.log`

---

## Phase 3 — Develop (`voidrift develop`)

### Purpose
The worker executes tasks from .voidrift/TASKS.md atomically, one at a time, top to bottom. Each completed task results in a git commit. The architect is consulted only when the worker is blocked.

### Command Signatures
```
voidrift develop <worker> [<architect>] [--parallel] [--retry | --overwrite]
    <worker>      Model that executes implementation tasks
    [<architect>] Optional model consulted when worker is blocked (default: none)
    --parallel    Execute modules concurrently in git worktrees
    --retry       Resume from partial/failed run (only with --parallel)
    --overwrite   Remove existing worktrees and start fresh (only with --parallel)
```

### Pre-flight Checks

**AC-D1:** If `.worktrees/` directory exists when `--parallel` is specified:
1. Without `--retry` or `--overwrite`: Exit with error message showing task completion state (done/remaining counts per module) and prompt user to run with `--retry` to resume or `--overwrite` to start fresh. Return exit code 1.
2. With `--retry`: Resume execution in existing worktrees, skipping already-completed tasks per module.
3. With `--overwrite`: Remove all worktrees, delete voidrift branches, and start fresh.

**AC-D2:** If `--parallel` is specified but no `.voidrift/TASKS-<module>.md` files exist, the command exits with an error and a prompt to run `voidrift plan` or omit `--parallel`.

**AC-D3:** If no task files exist at all (`.voidrift/TASKS.md` or `.voidrift/TASKS-*.md`), the command exits with an error prompting the user to run `voidrift plan`.

**AC-D4:** If all tasks are already marked `[x]`, the command exits cleanly with a "all tasks complete" message and returns 0.

**AC-D4a:** If `.voidrift/REQUIREMENTS.md` does not exist, the command exits with an error message: "REQUIREMENTS.md not found. Run 'voidrift gather <model>' first." Returns exit code 1.

**AC-D5:** At session start, a lock file `.voidrift/.develop.lock` is created containing the process PID and timestamp. If the lock file already exists:
1. Read the PID from the lock file
2. Check if that PID is still running
3. If PID is dead or stale (older than 24 hours): remove the lock and continue
4. If PID is alive: exit with error showing the PID and timestamp of the running session

The lock file is removed automatically on session exit (normal or via signal trap).

### Session Initialization (per module)

**AC-D6:** At the start of each develop session the following are cleared:
- `.aider.tags.cache.v4/` — deleted recursively
- `.aider.chat.history.md` — deleted

A header with timestamp and command invocation is appended to `develop-*.log` to mark the start of the new session.

**AC-D7:** Background job notifications (e.g., `[n] pid`, `[n]+ Done`) are suppressed during the develop loop to keep terminal output clean. Task progress is shown via the framework's own status messages.

**AC-D8:** A PATH shim directory is created at a temp location containing stub executables for: `sudo`, `apt-get`, `apt`, `yum`, `dnf`, `brew`, `pip`, `pip3`. Each stub prints an error and exits with code 1. This directory is prepended to `$PATH` for the duration of the session to prevent the worker from installing packages on the host. The directory is removed on session exit.

### Task Loop (per task)

**AC-D9:** Each loop iteration processes the first unchecked task from `.voidrift/TASKS.md`. When no unchecked tasks remain, the loop exits cleanly.

**AC-D10:** Task counter (`task_num`) and total count (`total_tasks`) are recomputed from the file on every iteration to correctly reflect tasks added mid-run and prevent counter drift.

**AC-D11:** The task label shown on the terminal is truncated to 72 characters and strips the checkbox and skill tags for readability.

**AC-D11a:** During task execution, progress indication is shown:
- Visual indicator (spinner, dots, or similar) that work is in progress
- Elapsed time counter
- Current task label

This is required because aider output is redirected to log files. Implementation details (spinner style, update frequency) are flexible.

**AC-D12:** The worker is given the full task text as its instruction, plus:
- `.voidrift/TASKS.md` as read-only context
- Relevant skill files for the task's tags as read-only context
- `.voidrift/architect_responses/[module/]<task_num>-<N>.md` as read-only context (if present from a prior escalation for this task, where N is the highest numbered response file for this task)
- `AGENT.md` and `CONVENTIONS.md` (always loaded via dev config)
- `EDIT-FORMAT.md` (always loaded via dev config, mandatory format specification)

The `[module/]` path segment is included only for multi-module projects (when `TASKS-<module>.md` files exist); for single-module projects, the path is `.voidrift/architect_responses/<task_num>-<N>.md`.

**AC-D13:** The worker must strictly follow the edit format specified in `EDIT-FORMAT.md`. All file edits must include the complete file path before code blocks. The framework does not attempt to detect or correct format errors; the worker is responsible for proper formatting.

**AC-D14:** Task completion is detected by comparing `git rev-parse HEAD` before and after the aider call. An unchanged HEAD means the worker produced no file changes.

### No-Output Retry

**AC-D15:** If the worker produced no file changes (HEAD unchanged), print "No file changes produced — retrying..." and issue one retry. The retry message explicitly instructs the worker to output complete file content, not descriptions.

**AC-D16:** After the retry, if the worker still produced no changes and an architect is configured, escalate. The escalation message asks the architect to either: (a) rewrite the task as a clearer, more specific file-editing instruction, or (b) provide step-by-step guidance including file paths, function signatures, and exact behavior. The architect's response is written to `.voidrift/architect_responses/[module/]<task_num>.md` and the task is retried.

**AC-D17:** If no architect is configured and the worker persistently produces no output, print an error message telling the user to re-run with an architect. Do not silently skip the task.

### Developer Escalation via Escalation Files

**AC-D18:** The worker may write `.voidrift/escalations/[module/]<task_num>.md` containing a specific design question it cannot resolve without architectural guidance. When this file is detected after a task run:
1. The question is read from the file
2. The question is printed to the terminal
3. The architect is consulted with the question
4. The architect's answer is written to `.voidrift/architect_responses/[module/]<task_num>.md`
5. The same task is retried with that response loaded as context

The escalation file is kept as an artifact (not deleted) for traceability.

**AC-D19:** If no architect is configured when an escalation file is present, print a warning with the escalation content and tell the user to re-run with an architect. Do not silently skip the task.

### Verification Pass

**AC-D20:** After successful implementation (HEAD changed, no persistent no-output), a verification pass runs. The worker reads the implementation files and checks for correctness, completeness, and alignment with `.voidrift/REQUIREMENTS.md`.

**AC-D21:** Verify behavior:
- If the implementation is correct: worker makes no changes and writes no `.voidrift/VERIFY-FAIL.md`
- If there are fixable issues: worker fixes them directly without escalating
- If there are architectural issues requiring design input: worker writes a concise description to `.voidrift/VERIFY-FAIL.md` and stops

**AC-D22:** The verify aider call does not include `.voidrift/TASKS.md` as a writable target — it is read-only context for verification. Skill files are loaded per the task's tags.

**AC-D23:** If `.voidrift/VERIFY-FAIL.md` is present and an architect is configured, the architect is consulted with the task text and the failure description. The architect's response is written to `.voidrift/architect_responses/[module/]<task_num>.md`, `.voidrift/VERIFY-FAIL.md` is deleted, and a guided fix pass runs with the architect's guidance loaded. The fix pass uses the same model and config as normal task execution.

**AC-D24:** If `.voidrift/VERIFY-FAIL.md` is present and no architect is configured, print the failure content and exit with an error message telling the user to re-run with an architect.

### Escalation Counter and Blocked Tasks

**AC-D25:** Each develop session (or each parallel worker) maintains an escalation counter starting at 0 with a maximum of 5. It increments on every escalation event (no-output escalation, escalation file, VERIFY-FAIL.md escalation). The counter is NOT reset between tasks — it accumulates across the session. In parallel mode, each worktree has its own independent escalation counter.

**AC-D25a:** Escalation and architect response files are numbered sequentially per task. For a task's first escalation: `<task_num>-1.md`, second: `<task_num>-2.md`, etc. The worker loads only the latest (highest numbered) architect response for the current task.

**AC-D26:** When `max_escalations` is exceeded for a task:
1. The task is marked `[!]` (blocked) in `.voidrift/TASKS.md` using the same awk pattern as `[x]` marking
2. Any pending `.voidrift/VERIFY-FAIL.md` file is deleted
3. `blocked_tasks` counter increments
4. The loop continues to the next task (does not abort the session)

Escalation and architect response files are kept as artifacts for review.

**AC-D27:** At the end of the develop loop, if `blocked_tasks > 0`:
1. Print count: "N task(s) blocked — marked [!] in .voidrift/TASKS.md"
2. List each `[!]` task line
3. Return exit code 1

**AC-D28:** Hard errors (no architect configured when required, `_consult_architect` failure) still abort the loop with `return 1`. These are not converted to blocked tasks.

### Architect Consultation

**AC-D28a:** When the architect is consulted (no-output escalation, worker escalation, verification failure, merge conflict), the consultation runs via aider using the plan config (`.aider.plan.yml`) with the architect model. Output is hidden behind a spinner with status message indicating consultation is in progress. All output is logged to `develop-*.log`.

**AC-D28b:** Architect consultation context includes:
- The specific problem or question being escalated
- `.voidrift/REQUIREMENTS.md` (read-only)
- `.voidrift/ARCHITECTURE.md` (read-only)
- Current task text (for task-related escalations)
- Source code files are NOT loaded (architect provides guidance, not implementation)

**AC-D28c:** If the architect model is local, the model container is started before consultation (same startup process as worker model in AC-MC3). The container remains running for the duration of the develop session.

### State Tracking

**AC-D29:** The framework maintains two levels of state:
- **Module state** (`.voidrift/STATE-<module>.md`): Detailed task-by-task progress for a specific module
- **Project state** (`.voidrift/STATE.md`): High-level summary of overall project status, which modules are complete, cross-module issues

For single-module projects (only `TASKS.md` exists), only `.voidrift/STATE.md` is used.

**AC-D30:** After each successfully verified and committed task, a module state update runs. The worker reads `.voidrift/STATE-<module>.md` (or `.voidrift/STATE.md` for single-module projects) and writes a summary of what was just completed and the current status of remaining tasks in that module. The update is committed automatically via aider's auto-commit.

**AC-D31:** The state update uses the same worker model with dev config. It does not load skill files or TASKS.md as editable targets.

**AC-D32:** In sequential mode, after all tasks in a module complete, the project state (`.voidrift/STATE.md`) is updated with a high-level summary of that module's completion and committed separately.

**AC-D33:** In parallel mode, each worktree maintains its own `STATE-<module>.md`. On successful merge of a module branch, the project state (`.voidrift/STATE.md`) is updated with a section header `## Module: <module>` followed by a high-level completion summary, and the module's `STATE-<module>.md` is merged into root.

### Task Completion Marking

**AC-D34:** `_mark_next_complete` marks the first `- [ ]` in `.voidrift/TASKS.md` as `- [x]` using an awk replacement. This is done by the framework, not by the worker model.

**AC-D32:** `_guard_complete` is available to re-mark a task `[x]` if a subsequent aider call reverts it back to `[ ]` (models sometimes undo checkboxes when editing files they were given as context).

### Sequential Mode (multiple subprojects)

**AC-D33:** When `.voidrift/TASKS-<module>.md` files are present and `--parallel` is not specified, modules are processed in alphabetical order, one at a time.

**AC-D34:** Before each module, its `.voidrift/TASKS-<module>.md` is copied to `.voidrift/TASKS.md`. After the module's loop completes, `.voidrift/TASKS.md` is copied back to `.voidrift/TASKS-<module>.md` to sync completion state.

**AC-D35:** Each progress line is prefixed with `[module]` to identify which subproject is active.

**AC-D36:** `.voidrift/TASKS.md` is deleted after all sequential modules complete.

### Parallel Mode (`--parallel`)

**AC-D37:** Parallel mode assumes modules are independent (non-overlapping source files) and a single operator. The base branch should not be modified during parallel execution. Modules are designed by the planner to avoid file conflicts.

**AC-D38:** Each `.voidrift/TASKS-<module>.md` file gets its own git worktree in `.worktrees/<module>/` on a branch named `voidrift/<module>`. Each worker runs concurrently and independently in its worktree.

**AC-D39:** If `git worktree add` fails for any module (disk space, permissions, path conflicts, branch conflicts), the command aborts immediately, prints the git error, and exits with code 1. Any successfully created worktrees from the same invocation are cleaned up before exit.

**AC-D40:** The task file for each module is copied into its worktree as `.voidrift/TASKS.md` before the worker starts.

**AC-D41:** The poll loop checks all workers every 30 seconds and reports which modules are still running with elapsed time.

**AC-D42:** Developer output in parallel mode is silent (no spinner, no per-task lines). Completion is indicated by the final merge summary.

### Signal Handling

**AC-D43:** Ctrl+C or SIGTERM sent to `_develop_parallel` sets an `_interrupted` flag, prints a stop message, and sends SIGTERM to each worker process tree using `_kill_tree`.

**AC-D44:** `_kill_tree` recursively kills depth-first: it kills all children of a PID before killing the PID itself. This ensures aider (grandchild of the worker subshell) is killed before its parent wrapper subshell, preventing orphan processes.

**AC-D45:** After SIGTERM, a 2-second grace period is allowed. Any surviving processes in each worker tree are then sent SIGKILL.

**AC-D46:** Each worker's `_develop_loop` sets a TERM trap that kills the currently-running aider child (`$_develop_child_pid`) and its children before exiting. `_develop_child_pid` is updated by `_spinner_wait` at the start of each aider call and cleared on completion.

**AC-D47:** Background subshells (workers) ignore SIGINT by default in bash. Only SIGTERM (sent by `_develop_parallel`'s trap) triggers the worker's cleanup logic.

### Parallel Merge

**AC-D48:** After all workers finish, each `voidrift/<module>` branch is merged into the base branch in completion order (first worker to finish is merged first). Merges are performed sequentially with `git merge --no-edit`.

**AC-D49:** Before merging, files added only by the voidrift branch (not present in the base) are explicitly checked out from the voidrift branch and staged. This prevents new files from being silently dropped during a merge that proceeds without conflicts but lacks explicit checkout.

**AC-D50:** After successful merge of a module branch, the project state (`.voidrift/STATE.md`) is updated with a section header `## Module: <module>` followed by a high-level summary of that module's completion. The module's `STATE-<module>.md` from the worktree is merged into root `.voidrift/STATE-<module>.md`. Both updates are committed.

**AC-D51:** If a merge conflict occurs, the architect is consulted. The architect analyzes the conflict diff and provides a resolution. The worker then applies the fix to the conflicted files. After the fix, the merge is completed with `git merge --continue --no-edit` if `MERGE_HEAD` is present, or via `git commit` if the merge state was already cleared.

**AC-D52:** If conflict resolution fails (worker fix didn't resolve all markers), the merge is aborted with `git merge --abort` and an error is printed. The user must resolve manually.

**AC-D53:** After each successful merge and state update, the worktree and voidrift branch are cleaned up (`git worktree remove`, `git branch -D`).

### Artifacts
- Source code files (committed per task)
- `.voidrift/STATE.md` (project-level state, updated per module completion)
- `.voidrift/STATE-<module>.md` (module-level state, updated per task)
- `.voidrift/escalations/[module/]<task_num>-<N>.md` (worker questions, numbered per escalation attempt)
- `.voidrift/architect_responses/[module/]<task_num>-<N>.md` (architect guidance, numbered per escalation attempt)
- `develop-*.log`
- `.voidrift/TASKS.md` with tasks marked `[x]` (complete) or `[!]` (blocked)

---

## Phase 4 — Automate (`voidrift automate`)

### Purpose
Generate infrastructure-as-code from requirements, or reconcile existing IaC with the current architecture, so the project can be deployed and tested end-to-end.

### Command Signature
```
voidrift automate <worker> [<architect>]
    <worker>      Model that generates/reconciles infrastructure code
    [<architect>] Optional model for design decisions (default: none)
```

### IaC Detection

**AC-A1:** IaC is considered present if any of the following exist: `*.tf` files (up to 2 directory levels deep), `cdk.json`, `podman-compose.yml`, `podman-compose.yaml`, `docker-compose.yml`, `docker-compose.yaml`.

### Generate Mode (no IaC found)

**AC-A2:** The worker reads `.voidrift/REQUIREMENTS.md` (Runtime Environment section) and `.voidrift/ARCHITECTURE.md` (Deployment, Configuration, Components sections) to understand what infrastructure is needed.

**AC-A3:** The worker selects the appropriate infrastructure type based on the deployment requirements described in `.voidrift/REQUIREMENTS.md`. The choice is driven by what the requirements specify (containerization, cloud resources, orchestration, etc.), not by framework defaults.

**AC-A4:** Generated IaC files go in an `infra/` subdirectory. Exception: Compose files (`podman-compose.yml`, `docker-compose.yml`) go in the project root.

**AC-A5:** No secrets or credentials are hardcoded. All sensitive values are parameterized via environment variables, `.env.example`, or `tfvars` files.

**AC-A6:** Every generated cloud resource is tagged with at minimum: project name and environment.

**AC-A7:** `.voidrift/ARCHITECTURE.md` ## Deployment section is updated with the commands to provision and run the generated IaC.

**AC-A8:** After generation, IaC detection is re-run. If still no IaC files are found, print a warning referencing REQUIREMENTS.md ## Deployment and exit with code 1.

### Review Mode (IaC exists)

**AC-A9:** The worker reviews existing IaC files for consistency with `.voidrift/REQUIREMENTS.md` and `.voidrift/ARCHITECTURE.md`. It reconciles gaps: adds missing services, corrects port mappings, updates environment variable references, and aligns resource names.

**AC-A10:** Existing IaC is never deleted and replaced wholesale. Only specific gaps are addressed.

### Artifacts
- IaC files (`infra/`, `podman-compose.yml`, `Containerfile`, etc.)
- Updated `.voidrift/ARCHITECTURE.md`
- `automate-*.log`

---

## Phase 5 — Verify (`voidrift verify`)

### Purpose
Run all applicable quality checks automatically, then produce a structured PASS/FAIL report cross-referenced against REQUIREMENTS.md acceptance criteria.

Technology stacks and testing frameworks are determined by the plan phase and guided by skill files. Verify detects what was implemented and runs the appropriate checks.

### Command Signature
```
voidrift verify <worker> [<architect>]
    <worker>      Model that analyzes test results and produces report
    [<architect>] Optional model for fix planning when verification fails (default: none)
```

### Check Execution

**AC-V1:** Checks are run based on the technology stack documented in `.voidrift/ARCHITECTURE.md` and detected project files. For each detected type, the appropriate test suite and static analysis tools are executed. All output is appended to `.voidrift/VERIFY-RAW.md` with labeled section headers. Each unique check is run only once, even if multiple detection patterns match. Test suite failures cause verification to fail; static analysis warnings are reported but don't fail verification.

**AC-V2:** `failed_checks` counter increments for every check that exits non-zero. Lint/checkstyle failures do not increment it (warn only).

**AC-V3:** `.voidrift/VERIFY-RAW.md` is prefixed with a header line containing the current date/time.

### Analysis

**AC-V4:** The worker reads `.voidrift/VERIFY-RAW.md`, `.voidrift/REQUIREMENTS.md`, and `.voidrift/ARCHITECTURE.md` and produces `.voidrift/VERIFY.md` with exactly these sections:
- **Test Results** — pass/fail summary; every failing test listed by name
- **Lint & Static Analysis** — issues found, or "None"
- **Infrastructure** — validation result, or "N/A"
- **Requirements Coverage** — one table row per acceptance criterion from REQUIREMENTS.md: Met / Partial / Unmet with brief evidence (only included if REQUIREMENTS.md exists)
- **Issues** — numbered list of every failure and unmet requirement that must be addressed; empty list if none
- **Verdict** — first line is exactly the word `PASS` or the word `FAIL` (no other text on that line), followed by a one-sentence summary

**AC-V5:** `.voidrift/VERIFY-RAW.md` is deleted after analysis (it is an intermediate artifact).

**AC-V6:** The verdict is PASS only if the verdict line starts with `PASS` AND `failed_checks` is 0. If either condition fails, the verdict is FAIL.

**AC-V7:** On PASS: print "✅ Verification passed." and return 0.

**AC-V8:** On FAIL without a architect: print "❌ Verification failed." and tell the user to re-run with a architect alias to generate fix tasks. Return 1.

### Fix Planning (FAIL + architect configured)

**AC-V9:** The architect receives `.voidrift/VERIFY.md` contents and responds with a remediation plan categorizing each issue as: fixable task, acceptable tradeoff (no task needed), or out-of-scope. The consultation uses plan config with REQUIREMENTS.md and ARCHITECTURE.md loaded as read-only context. Output is hidden behind a spinner.

**AC-V10:** The architect response is written to `.voidrift/ARCHITECT_VERIFY.md`.

**AC-V11:** The worker reads `.voidrift/ARCHITECT_VERIFY.md` and produces `.voidrift/TASKS-fixes.md` using the standard task file format (## Context + ## Tasks checklist with skill tags). It includes only tasks the architect explicitly marked as needing work. Tasks for accepted tradeoffs are excluded. The worker deletes `.voidrift/ARCHITECT_VERIFY.md` when done.

**AC-V12:** After producing `.voidrift/TASKS-fixes.md`, the user is prompted to run `voidrift develop <worker> <architect>` to address the fix tasks. The command returns 1 (verification failed — fixes needed).

### Artifacts
- `.voidrift/VERIFY.md` (structured report — kept)
- `.voidrift/VERIFY-RAW.md` (raw check output — deleted after analysis)
- `.voidrift/TASKS-fixes.md` (if issues found and architect consulted)
- `verify-*.log`

---

## Utility Commands

### `voidrift status`

**AC-U1:** Prints the current phase completion status for the project in the working directory:
- Phase 1 (Gather): ✅ if `.voidrift/REQUIREMENTS.md` exists, else ⬜
- Phase 2 (Plan): ✅ if `.voidrift/TASKS.md` + `.voidrift/adr/` exist, else ⬜
- Phase 3 (Develop): 🔄 with `done/total` task counts, or ✅ if all done
- Phase 4 (Automate): ⬜ with prompt (shows whether IaC exists)
- Phase 5 (Verify): ⬜ with prompt

**AC-U2:** If `.voidrift/spec/*.md` files exist, they are listed below the phase summary.

### `voidrift chat <model> [--refresh]`

**AC-U3:** Starts an interactive aider session with the specified model (local or cloud). If a local model is specified, it is started automatically. No git context is loaded (`--no-git`). Uses the chat-specific aider config (`.aider.chat.yml`). Intended for ad-hoc questions and exploration, not task execution.

The `--refresh` flag forces container recreation for local models.

### `voidrift bench [<num_prompts>] [<req_rate>]`

**AC-U4:** Benchmarks the currently active worker model using vLLM's built-in benchmark tool. Default: 100 prompts at infinite request rate.

The command:
1. SSHs to the worker node
2. Finds the active worker container (pattern: `worker-*`)
3. Queries the active model name from the API
4. Extracts the tokenizer path from container args
5. Runs `vllm bench serve` inside the container with ShareGPT dataset
6. Displays benchmark results (throughput, latency, etc.)

If no active worker container is found, exits with error.

### `voidrift log <phase> [--prune]`

**AC-U4b:** View or manage phase log files.

**View mode (no --prune flag):**
- `voidrift log <phase>` - Shows last 200 lines of most recent log for specified phase
- Phase must be one of: gather, plan, develop, automate, verify
- Finds most recent timestamped log file: `.voidrift/<phase>-YYYYMMDD-HHMMSS.log`
- If no log file exists for phase, prints error and exits with code 1

**Prune mode (with --prune flag):**
- `voidrift log --prune` - Deletes all log files for all phases
- `voidrift log <phase> --prune` - Deletes all log files for specified phase only
- Confirms deletion count: "Deleted N log file(s)"
- If no log files found, prints "No log files to prune" and exits with code 0

### `voidrift unlock`

**AC-U4a:** Removes the develop phase lock file and kills any running develop process.

The command:
1. Checks if `.voidrift/.develop.lock` exists
2. If not found, prints "No lock file found" and exits with code 0
3. Reads PID and timestamp from lock file
4. Checks if process is still alive using `kill -0 $PID`
5. If alive: sends SIGTERM, waits 2 seconds, sends SIGKILL if still alive
6. Removes lock file
7. Prints what was done (killed PID or removed stale lock)

Returns exit code 0 on success, 1 on error.

### `worker-perf`

**AC-U5:** Sends a single test completion request to the worker and times the response, printing token usage stats. Used for quick latency checks.

### `worker-compact`

**AC-U6:** Summarizes current conversation context into project state files, allowing the operator to start a fresh session with reduced context window usage. For single-module projects, updates `.voidrift/STATE.md`. For multi-module projects, updates both `.voidrift/STATE.md` (project-level) and the current module's `.voidrift/STATE-<module>.md`. Intended to be run manually after every 10 turns or on task completion. Uses the worker model with dev config.

### `worker-insight` / `worker-watch` / `worker-report`

**AC-U7:** Aliases for `<VOIDRIFT_HOME>/scripts/voidrift-insight.sh`. Provides real-time monitoring and watch mode for worker node activity (system metrics, GPU utilization, vLLM performance stats).

---

## Cross-Cutting: Project Structure

**AC-PS1:** All framework-generated files are stored in `.voidrift/` within the target project directory:

```
.voidrift/
├── REQUIREMENTS.md           # Project requirements
├── ARCHITECTURE.md           # Architecture reference
├── STATE.md                  # Project-level state summary
├── STATE-<module>.md         # Module-level state (multi-module projects)
├── TASKS.md                  # Task list (single subproject)
├── TASKS-<module>.md         # Task lists (multiple subprojects)
├── spec/                     # Feature specifications
│   └── <feature>.md
├── adr/                      # Architecture decision records
│   └── ADR-NNN-<title>.md
├── escalations/              # Developer escalation questions (kept as artifacts)
│   ├── <task_num>-<N>.md     # Single-module project (N = escalation attempt number)
│   └── <module>/             # Multi-module project
│       └── <task_num>-<N>.md
├── architect_responses/      # Architect guidance (kept as artifacts)
│   ├── <task_num>-<N>.md     # Single-module project (N = escalation attempt number)
│   └── <module>/             # Multi-module project
│       └── <task_num>-<N>.md
├── gather-*.log          # Phase logs
├── plan-*.log
├── develop-*.log
├── automate-*.log
├── verify-*.log
├── .develop.lock       # Concurrent execution lock
└── (temporary files)         # VERIFY-FAIL.md, etc.
```

**AC-PS2:** The `.voidrift/` directory is created automatically on first phase run if it does not exist.

**AC-PS3:** `.voidrift/STATE.md` is created automatically on first develop run if it does not exist. For multi-module projects, `.voidrift/STATE-<module>.md` files are created per module. Single-module projects use only `.voidrift/STATE.md`.

**AC-PS4:** The `.voidrift/escalations/` and `.voidrift/architect_responses/` directories are created automatically when needed. For multi-module projects, module subdirectories are created as needed.

**AC-PS5:** If `.voidrift/` exists but is missing required files for a phase, the command exits with an error message listing the missing elements and suggesting corrective action (e.g., "Missing REQUIREMENTS.md - run 'voidrift gather <model>' first").

---

## Cross-Cutting: Developer Model Management

---

## Cross-Cutting: Model Configuration

**AC-MC1:** Available models and their configuration:

| Alias | Model ID | Type | Notes |
|---|---|---|---|
| `qwen` | `Qwen/Qwen3-32B-FP8` | Local | General purpose |
| `qwen3-coder` | `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | Local | Code-focused |
| `granite` | `ibm-granite/granite-4.0-h-small-FP8` | Local | Compact, fast |
| `claude` | `anthropic/claude-opus-4-6` | Cloud | High capability |
| `haiku` | `anthropic/claude-haiku-4-5-20251001` | Cloud | Fast, cost-effective |
| `gemini` | `gemini/gemini-2.5-pro` | Cloud | High capability |
| `gemini-flash` | `gemini/gemini-2.5-flash` | Cloud | Fast, cost-effective |
| `kiro-sonnet` | `kiro/claude-sonnet-4-5` | Cloud | Kiro gateway |
| `kiro-haiku` | `kiro/claude-haiku-4-5` | Cloud | Kiro gateway |
| `kiro-deepseek` | `kiro/deepseek-v3` | Cloud | Kiro gateway |
| `kiro-minimax` | `kiro/minimax` | Cloud | Kiro gateway |
| `kiro-qwen` | `kiro/qwen3-coder` | Cloud | Kiro gateway |

Note: The model list is maintained in `<VOIDRIFT_HOME>/worker-models.yml` and can be extended without code changes.
| `kiro-haiku` | `kiro/claude-haiku-4-5` | Cloud | Kiro gateway |
| `kiro-deepseek` | `kiro/deepseek-v3` | Cloud | Kiro gateway |
| `kiro-minimax` | `kiro/minimax` | Cloud | Kiro gateway |
| `kiro-qwen` | `kiro/qwen3-coder` | Cloud | Kiro gateway |

**AC-MC2:** Local models are served via an OpenAI-compatible API at `http://$WORKER_IP:8000/v1`. The active model ID is discovered at runtime via `GET /v1/models`.

**AC-MC3:** When a phase requires a local model, the framework:
1. SSHs to the worker node at `$WORKER_IP`
2. Runs the docker command to start the model container with configuration from `worker-models.yml`
3. Polls `http://$WORKER_IP:8000/v1/models` every second until a valid response is received. During each poll iteration, verifies the container is still running. If container crashes or stops, exits immediately with error.
4. Monitors the docker container process throughout the phase execution
5. If the container crashes or stops during execution, the phase fails with an error

**AC-MC4:** If SSH connection to `$WORKER_IP` fails, the command exits immediately with an error message indicating the worker node is unreachable. No retry is attempted.

**AC-MC5:** If the docker container fails to start or crashes during startup polling, the error is reported and the command exits with code 1.

**AC-MC6:** Cloud models require no initialization. They are accessed directly via their API endpoints. API authentication is handled by aider's standard credential mechanisms (environment variables, config files).

**AC-MC7:** At the start of each phase, available disk space in the current directory is checked. If less than 1GB is available, a warning is printed but execution continues.

**AC-MC8:** Developer model configurations are defined in `<VOIDRIFT_HOME>/worker-models.yml`. Each model specifies:
- Repository/model ID
- Docker image and version
- GPU memory utilization
- Maximum model length (context window)
- vLLM arguments and feature flags
- Tool call parser
- Served model name alias

All docker run options are configurable per model.

**AC-MC8a:** When passing local models to aider, the framework:
1. Looks up the `served_model_name` from the model's YAML configuration
2. Prefixes it with `openai/` for litellm compatibility
3. Example: alias `qwen3-coder` → served name `qwen3-coder` → aider receives `openai/qwen3-coder`

This allows litellm to recognize local models as OpenAI-compatible API calls using the `OPENAI_API_BASE` environment variable.

**AC-MC9:** Single-worker constraint and lifecycle management:
1. Only one model container runs at a time on the worker node
2. Before starting a model, stop and remove any containers matching pattern `worker-*`
3. Container names follow pattern: `worker-<alias>`
4. `--refresh` flag (on develop/automate/verify commands): stop, remove, and recreate container even if already running

**AC-MC10:** Local model containers mount cache directories to persist:
- Downloaded model weights
- vLLM compilation cache  
- Kernel compilation artifacts

This prevents re-downloading models and recompiling kernels on each container start. Mount paths are defined in `worker-models.yml`.

---

## Cross-Cutting: Git & Worktrees

**AC-GW1:** The `.worktrees/` directory is gitignored. Worktrees are always ephemeral and are cleaned up on merge or interrupted-run startup.

**AC-GW2:** Agent branches follow the naming convention `voidrift/<module>`.

**AC-GW3:** Planning artifacts (`.voidrift/TASKS.md`, `.voidrift/TASKS-*.md`, `.voidrift/ARCHITECTURE.md`, ADRs, specs) are committed in a single commit with message `"docs: add planning artifacts"` after plan validation.

**AC-GW4:** During develop, aider auto-commits source code per task with task-specific commit messages. The framework does not commit manually during develop.

**AC-GW5:** Before creating worktrees for parallel mode, available disk space is checked. If insufficient space is available (less than estimated repo size × number of modules), the command fails with an error message indicating required vs available space.

**AC-GW6:** `auto-commits: false` is set only for the plan phase. Develop, automate, and verify phases use aider's default auto-commit behavior.

---

## Cross-Cutting: Skill System

**AC-SK1:** Skill files live in `<VOIDRIFT_HOME>/skills/` with uppercase filenames (e.g., `FRONTEND.md`, `BACKEND.md`, `INFRA.md`).

**AC-SK2:** Available skills: `backend`, `frontend`, `infra`, `native`, `design`, `branding`, `security`, `tdd`, `debugging`, `verification`, `worktrees`.

**AC-SK3:** At plan time, all skill files are loaded as read-only context so the planner knows the canonical tech stack, required frameworks, libraries, and conventions per domain before writing tasks.

**AC-SK4:** At develop time, skill files are loaded per-task based on the `[tag, ...]` annotation on each task line. Skills are deduplicated: each unique skill file is loaded at most once per aider invocation.

**AC-SK5:** If a skill file referenced in a task tag does not exist in `<VOIDRIFT_HOME>/skills/`, a warning is printed showing the missing skill file name and the task continues without loading it. This handles cases where the operator manually edited TASKS.md or a skill file was deleted after planning.

**AC-SK6:** Skill files are authoritative for technology choices. The planner and worker must follow them without deviation. Each skill file defines the canonical framework, libraries, and conventions for its domain.

**AC-SK7:** The MCP server dynamically lists available skills from `<VOIDRIFT_HOME>/skills/`. The planner uses the `get_skill()` and `list_skills()` MCP tools to discover available tags and their conventions.

---

## Cross-Cutting: Framework Reference Files

**AC-FR1:** Framework reference files in `<VOIDRIFT_HOME>/` guide model behavior and are loaded as read-only context:

| File | Purpose | Loaded By |
|------|---------|-----------|
| `agents/ANALYST.md` | Analyst role definition and guidelines | Gather phase |
| `agents/ARCHITECT.md` | Architect role definition and guidelines | Plan phase, escalations |
| `agents/DEVELOPER.md` | Developer role definition and guidelines | Develop, automate, verify phases |
| `templates/EDIT-FORMAT.md` | Instructions for formatting file edits | Develop, automate, verify sessions |
| `skills/*.md` | Skill files loaded contextually per task tag | Develop phase (per task) |
| `templates/*.md` | Document scaffolding for requirements, design, and ADRs | Plan phase |

**AC-FR2:** Role-specific agent files are loaded per phase to prevent role confusion:
- Gather phase loads only `agents/ANALYST.md`
- Plan phase loads only `agents/ARCHITECT.md`
- Develop/automate/verify phases load only `agents/DEVELOPER.md`
- Escalations during develop load `agents/ARCHITECT.md` for architect consultations

**AC-FR3:** `templates/EDIT-FORMAT.md` is loaded only during develop, automate, and verify phases to guide file editing behavior.

**AC-FR5:** Each role-specific AGENT file contains:
- Role identity and responsibilities
- What the role does and does NOT do
- Communication style and behavioral rules
- Context available during that role's phases
- Specific workflows (e.g., TODO comments for Analyst, escalation for Developer)

---

## Cross-Cutting: Change Management

**AC-CM1 — Changelog:** A `CHANGELOG.md` at the repo root tracks all notable changes using [Keep a Changelog](https://keepachangelog.com/) format. Sections: Added, Changed, Fixed, Removed. Each release has a version header and date.

**AC-CM2 — Versioning:** Both packages use the same version number, following [Semantic Versioning](https://semver.org/). The version is defined in a `VERSION` file at the repo root (single source of truth). Each package's `pyproject.toml` reads from this file via `hatchling`'s version source.

**AC-CM3 — Build Targets:** A `Makefile` at the repo root provides:
- `make test` — run full test suite
- `make install` — editable install of both packages
- `make build` — build wheels for both packages
- `make release VERSION=x.y.z` — bump version, update changelog header, build

---

## Cross-Cutting: Logging

**AC-LOG1:** All phase logs use timestamped filenames in format `<phase>-YYYYMMDD-HHMMSS.log` (e.g., `gather-20260312-133628.log`). Each run creates a new log file, making it easy to distinguish between runs and review specific sessions.

**AC-LOG2:** Log files accumulate indefinitely. The operator is responsible for manual cleanup or archival as needed.

---

## Cross-Cutting: Aider Configuration Files

| Config file | Used by | Key settings |
|---|---|---|
| `.aider.plan.yml` | `plan` | `edit-format: whole`, `auto-commits: false`, `map-tokens: 0`, reads AGENT.md + CONVENTIONS.md + templates |
| `.aider.dev.yml` | `develop`, `automate`, `verify` | `map-tokens: 1024`, `max-chat-history-tokens: 8192`, reads AGENT.md + CONVENTIONS.md + EDIT-FORMAT.md |
| `.aider.gather.yml` | `gather` (model-driven) | Interactive mode, full chat history |
| `.aider.chat.yml` | `chat` | Interactive mode, `--no-git` |

**AC-AIDER1:** All aider invocations include `--no-show-model-warnings` to suppress model compatibility warnings from aider/litellm.

**AC-AIDER2:** All configs share: `dark-mode: true`, `yes-always: true`, `attribute-author: false`, `attribute-committer: false`, `gitignore: false`.

**AC-AIDER3:** All aider invocations include explicit role assignment in the `--message` parameter:
- Analyst invocations: `[ROLE: Analyst] <task description>`
- Architect invocations: `[ROLE: Architect] <task description>`
- Developer invocations: `[ROLE: Developer] <task description>`

This provides runtime position assignment while AGENT.md provides the full playbook. The model knows which role boundaries apply for that specific invocation.


---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - command completed normally |
| 1 | Error - missing prerequisites, validation failures, worker unreachable, or other operational errors |
