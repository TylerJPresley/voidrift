# Requirements: VoidRift — Local-first Agentic Development Framework

## 1. Introduction

- **Purpose:** A local-first AI development lifecycle tool that routes work between a worker model (primary execution) and an optional architect model (escalation and design), producing a deployable, tested project from requirements alone through five phases: Gather → Plan → Develop → Automate → Verify.
- **Project Scope:** VoidRift provides the CLI orchestration layer, MCP context server, framework reference files, and worker node management. AI models are external (local vLLM containers, cloud APIs, or gateway endpoints). Hosting, CI/CD infrastructure, and runtime environments for generated projects are the operator's responsibility.

## 2. User Stories

- **As an** Operator, **I want to** run `voidrift gather <model> <path>` to reverse-engineer requirements from an existing codebase, **so that** I can onboard projects into the framework without writing requirements manually.
- **As an** Operator, **I want to** run `voidrift chat <model>` to interactively review and refine requirements, architecture, and tasks, **so that** I can iterate on framework artifacts through conversation.
- **As an** Operator, **I want to** run `voidrift plan` to generate architecture and task breakdowns, **so that** implementation work is pre-planned with atomic, ordered tasks.
- **As an** Operator, **I want to** run `voidrift develop` to have an AI execute tasks automatically, **so that** code is written, tested, and committed without manual intervention.
- **As an** Operator, **I want to** use concurrency configuration to process multiple modules in parallel, **so that** large projects complete faster.
- **As an** Operator, **I want to** use local models for bulk implementation and cloud models for escalation, **so that** I minimize API costs while maintaining quality on hard problems.
- **As an** Operator, **I want to** run `voidrift automate` to generate infrastructure-as-code, **so that** my project is deployable without manual IaC authoring.
- **As an** Operator, **I want to** run `voidrift verify` to validate the implementation against requirements, **so that** I have confidence the project meets its acceptance criteria.
- **As a** model executing tasks, **I want to** receive one task at a time via MCP tools, **so that** my context window stays small and focused.
- **As a** model consulted during escalation, **I want to** receive only the problem description and architecture docs, **so that** I provide design guidance without implementation bias.

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
- **REQ-ARCH-2:** The CLI SHALL provide subcommands: `gather`, `plan`, `develop`, `automate`, `verify`, `chat`, `status`, `log`, `unlock`, `prune`, `completions`, `skills`. WHEN an unknown command is given, THE SYSTEM SHALL display the error and full help text (no tracebacks). No CLI command SHALL ever display a Python traceback to the user.
- **REQ-ARCH-3:** WHEN `voidrift` is run with no arguments, THE SYSTEM SHALL launch an interactive guided flow presenting available actions, model selection, and phase-specific options. WHEN presenting the model selection prompt, THE SYSTEM SHALL default to the active local model alias (read from `~/.voidrift/.active-container`) if one is running, or the first alias in the configured model list otherwise. No hardcoded model alias SHALL appear as a default in any user-facing prompt or interactive flow.
  - Given a local model with alias `qwen3-coder` is active (recorded in `.active-container`), When the interactive model prompt is shown, Then the default is `qwen3-coder`.
  - Given no local model is active, When the interactive model prompt is shown, Then the default is the first alias from the configured model list.
  - Given the configured model list is empty, When the interactive model prompt is shown, Then no default is set.
- **REQ-ARCH-4:** The CLI SHALL implement an agent loop that sends messages to model APIs (OpenAI-compatible for local/kiro, native for cloud), handles MCP tool calls, and returns responses. The agent loop SHALL support a configurable `tool_choice` parameter with two modes: `"required"` (default) and `"auto"`. Automated phases (gather, plan, develop) SHALL use `tool_choice: "required"` — WHEN tools are provided, the agent SHALL set `tool_choice: "required"` on every call, and a `done` tool SHALL be included automatically. WHEN the model calls `done()`, the agent SHALL make one final call with no tools to get the text summary. Interactive phases (chat) SHALL use `tool_choice: "auto"` — tools are available but the model decides when to call them; no `done` tool is injected. Automated phases SHALL use non-streaming mode (`stream=False`) for reliable tool call parsing. Interactive phases (chat) SHALL use streaming mode for token-by-token display and interruptibility. The agent loop SHALL detect stalls: IF the model makes the same tool call (same name and arguments) on consecutive iterations, the agent SHALL inject a user message instructing the model to stop repeating and proceed to write output, resetting the stall signature. IF the model stalls again after 2 nudges, the agent SHALL force a final text-only call. The stalled call signature and nudge count SHALL be logged. WHILE waiting for any model response (initial or after tool calls), THE SYSTEM SHALL display a "Thinking..." spinner on stderr that clears when the response arrives. The agent loop SHALL log all interactions to the active phase log file: system prompts, user messages, model responses, tool calls (name + arguments), and tool results.
  - *Rationale:* `tool_choice: "required"` ensures automated phases use tools rather than generating text about what they would do. `tool_choice: "auto"` is necessary for interactive chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text. Streaming in chat provides responsive UX and allows the operator to interrupt generation. Non-streaming in automated phases ensures reliable tool call parsing — vLLM's streaming parser does not reliably separate text from tool calls. Stall nudging preserves tool access so the model can deliver output — stripping tools on stall causes models to emit tool calls as text (XML/JSON) which are never executed. Comprehensive logging enables post-run debugging without reproducing the full agent session.
  - Given an agent with `tool_choice="required"` and tools, When the API is called, Then `tool_choice: "required"` and the `done` tool are included.
  - Given an agent with `tool_choice="auto"` and tools, When the API is called, Then `tool_choice: "auto"` is set and no `done` tool is injected.
  - Given a chat session, When the operator sends a message, Then the model may respond with text only or call tools as needed.
  - Given a model repeats the same tool call on consecutive iterations, When stall is detected, Then a nudge message is injected and tools remain available.
  - Given 2 nudges have been sent and the model stalls again, When the 3rd stall is detected, Then tools are stripped to only write tools (`write_source_file`, `write_framework_file`) and `done`, and a final call is forced.
- **REQ-ARCH-5:** The CLI SHALL be model-agnostic. It SHALL resolve model aliases to `(base_url, api_key, model_id)` tuples from a models config file and connect to the endpoint directly. It SHALL NOT manage containers, SSH connections, or gateway processes.
  - *Rationale:* The worker node already exposes an OpenAI-compatible endpoint. Cloud APIs expose endpoints. Kiro Gateway exposes an endpoint. The CLI treats all three identically — the only variable is the URL.
- **REQ-ARCH-6:** The CLI SHALL load all framework resource content (skills, templates, prompts) exclusively through MCP server tool calls.
  - *Rationale:* On-demand retrieval via MCP tools keeps context windows small. Models pull only the sections they need instead of loading full files upfront.
- **REQ-ARCH-7:** Multi-stage phases SHALL use separate agent instances per unit of work to prevent context accumulation. Each agent starts with a clean message history. Shared state between agents SHALL be passed through MCP tools (`store_file_analysis`, `get_all_analyses`, etc.), not message history.
  - *Rationale:* A single agent reading multiple files accumulates raw content in its message history until the context window fills. Separate agents per file keep each context small and focused — the same pattern used by the develop phase (one agent per task).
- **REQ-ARCH-8:** The agent loop SHALL strip `<think>...</think>` blocks (including content) from all model response text before returning it to the caller or appending it to message history. Stripped thinking content SHALL be logged to the phase log file (prefixed `[THINKING]`) before removal. This is model-agnostic: models that do not emit thinking tokens are unaffected. WHEN streaming, the agent SHALL buffer tokens and filter think blocks in real-time — thinking content SHALL NOT be displayed to the terminal. The agent SHALL also handle orphaned `</think>` tags (closing tag without opening `<think>`): all content before the orphaned `</think>` SHALL be treated as thinking content, logged, and suppressed. WHEN streaming and the response begins with thinking content (no opening `<think>` tag), the agent SHALL buffer up to 200 characters; IF `</think>` arrives within that buffer, the content is discarded as thinking. IF 200 characters accumulate without `</think>`, the buffer SHALL be flushed as real content.
  - *Rationale:* Some models emit chain-of-thought reasoning wrapped in `<think>` tags. This internal reasoning is valuable for debugging (logged) but should not leak into user-facing output or pollute message history for subsequent turns. Models frequently omit the opening `<think>` tag, emitting only `</think>` to close their reasoning — the orphaned tag handler catches this. The 200-character streaming buffer balances latency (short buffer) against reliable detection (enough text to see `</think>`).
  - Given a model response containing `<think>reasoning</think>Hello`, When the agent processes the response, Then the returned text is `Hello` and the log contains `[THINKING] reasoning`.
  - Given a model response containing no `<think>` tags, When the agent processes the response, Then the text is returned unchanged and no `[THINKING]` entry is logged.
  - Given a streaming response starting with `reasoning</think>Hello`, When tokens arrive, Then `reasoning` is buffered and logged as `[THINKING]`, and only `Hello` is displayed.
  - Given a streaming response with no think tags, When 200 characters accumulate without `</think>`, Then the buffer is flushed to the terminal as real content.
- **REQ-ARCH-10:** The agent loop SHALL retry API calls that fail due to transient errors using exponential backoff. Retryable errors: connection errors, HTTP 5xx responses, rate limit responses (HTTP 429). Non-retryable errors: HTTP 4xx (except 429), authentication errors, and context length errors. The retry policy SHALL use a base delay of 1 second, multiplier of 2, maximum delay of 30 seconds, and a maximum of 3 attempts. Each retry attempt SHALL be logged to the phase log. WHEN all retry attempts are exhausted, the agent SHALL raise the original exception to the caller.
  - *Rationale:* Transient network errors and rate limits are common against cloud APIs and local vLLM. Without retry logic, a single dropped packet or momentary rate limit terminates a phase run that may have taken minutes of work to reach. Exponential backoff avoids thundering-herd against rate-limited endpoints.
  - Given a connection error occurs on attempt 1, When the agent retries with backoff, Then up to 3 attempts are made and each retry is logged.
  - Given an HTTP 429 response is returned, When the agent retries, Then it waits before retrying and logs the rate limit event.
  - Given an HTTP 401 response is returned, When the agent encounters the error, Then no retry is attempted and the error is raised immediately.
  - Given a context length error occurs, When the agent encounters the error, Then no retry is attempted and the error is raised immediately.
  - Given all 3 retry attempts fail, When exhausted, Then the original exception is raised.
- **REQ-ARCH-9:** `build_mcp_tools()` SHALL accept an optional `phase` parameter. WHEN a phase is specified, THE SYSTEM SHALL return only the tools relevant to that phase. WHEN phase is empty or omitted, all tools SHALL be returned. Each phase command SHALL pass its phase name: `gather`, `plan`, `develop`, `chat`. Tools excluded from a phase's visible set SHALL still have handlers registered for programmatic use by framework code. `get_prompt` and `list_prompts` SHALL be excluded from all phases — the CLI loads prompts, not the model. Filesystem tools SHALL enforce domain separation by tool name: `write_source_file` and `read_source_file` operate on the project source tree, `write_framework_file` and `read_framework_file` operate on `.voidrift/` artifacts. Per-phase tool sets:
  - **Gather:** `read_source_file`, `write_framework_file`, plus analysis, requirements, and resource tools.
  - **Plan:** `read_framework_file`, `write_framework_file`, plus resource tools (get_skill, get_template, list_skills, list_templates).
  - **Develop (orchestrator):** `read_source_file`, `write_source_file`, `read_framework_file`, plus task and resource tools. Used by `run_develop()` when building the shared tool set.
  - **Develop (per-task agent):** `read_source_file`, `write_source_file`, `read_framework_file`, `get_skill`, `list_skills`. Task orchestration tools (`load_tasks`, `get_next_task`, `complete_task`, `get_task_status`) SHALL be excluded — these are called directly by framework Python code, not by the model. The per-task tool set is used when constructing the `AgentLoop` inside `_develop_module`.
  - **Chat:** all tools.
  - *Rationale:* Models waste context and iterations calling tools irrelevant to their phase. Restricting the visible tool set keeps the model focused and prevents cross-phase tool misuse. Separating source and framework filesystem tools by name makes the domain boundary structural — the develop phase cannot write to `.voidrift/` because it has no tool that does so, and the plan phase cannot write source files for the same reason. No runtime guards needed.
  - Given phase="plan", When `build_mcp_tools()` is called, Then `write_framework_file` and `read_framework_file` are included but `write_source_file` and `read_source_file` are not.
  - Given phase="develop", When `build_mcp_tools()` is called, Then `write_source_file`, `read_source_file`, and `read_framework_file` are included but `write_framework_file` is not.
  - Given phase="gather", When `build_mcp_tools()` is called, Then `read_source_file` and `write_framework_file` are included but `write_source_file` is not.
  - Given phase="", When `build_mcp_tools()` is called, Then all tools are returned.

### 4.2 MCP Context Server

- **REQ-MCP-1:** The MCP server SHALL communicate via stdio using the MCP protocol, built with the standalone `fastmcp` package (PrefectHQ, `fastmcp>=3.1.1`). The server SHALL NOT depend on `mcp[cli]` or its bundled FastMCP variant.
  - *Rationale:* The standalone `fastmcp` package is the industry-standard implementation that follows MCP specifications independently of Anthropic's SDK release cycle. Using it aligns the framework with community tooling and unlocks MCP Resource support for skill file access.
- **REQ-MCP-2:** WHEN the server starts, THE SYSTEM SHALL load all framework files from `resources/` (skills, templates, prompts), index them by markdown header, and serve targeted sections on demand.
- **REQ-MCP-3:** The server SHALL use write-through storage for persistent artifacts (requirements, specs): `store_*` tools write to both in-memory cache and disk simultaneously. Ephemeral artifacts (analyses, escalation context) SHALL be stored in the SessionStore SQLite database (`~/.voidrift/sessions.db`), keyed by run ID.
  - *Rationale:* Persistent artifacts are operator work products that belong on disk. Ephemeral data belongs in the MCP's data store — queryable, prunable by age, and correlated by run ID.
- **REQ-MCP-3a:** ALL phase executions SHALL be scoped to a run ID. The run ID SHALL be the log filename stem (e.g. `gather-20260318-101048`). The CLI SHALL pass the run ID to the MCP server after `_boot()` to start a session in the SessionStore. ALL ephemeral MCP data (analyses, escalation context) SHALL be stored in the SessionStore keyed by run ID. The log file serves as the run's PID file — its existence and filename are the canonical record of the run.
- **REQ-MCP-4:** The MCP server SHALL expose content management tools as defined by REQ-MCP-6 through REQ-MCP-16. The MCP server SHALL serve framework resources from memory and ephemeral data from SQLite — it SHALL NOT perform local filesystem write operations, as it MAY reside on a different host than the CLI.
- **REQ-MCP-4a:** The CLI SHALL provide local filesystem tools directly (not via MCP): `write_source_file(path, content)`, `read_source_file(path)`, `write_framework_file(path, content)`, `read_framework_file(path)`, `export_to_file(type, path)`, `list_project_artifacts()`. These tools execute on the workstation where the CLI runs. `write_source_file` and `read_source_file` operate on the project source tree — paths are relative to the project root and SHALL NOT resolve into `.voidrift/`. `write_framework_file` and `read_framework_file` operate on `.voidrift/` artifacts — paths are relative to `.voidrift/` (e.g. `TASKS.md` resolves to `.voidrift/TASKS.md`). Log files (`.voidrift/logs/`) SHALL NOT be readable by any tool.
  - *Rationale:* The MCP server may be remote. Only the CLI is guaranteed to have local filesystem access. Separating source and framework tools by name makes the domain boundary structural — the develop phase cannot write to `.voidrift/` because it only has `write_source_file`, and the plan phase cannot write source files because it only has `write_framework_file`. No runtime path guards needed.
  - Given the plan phase calls `write_framework_file("TASKS.md", content)`, Then the file is written to `.voidrift/TASKS.md`.
  - Given the plan phase calls `write_framework_file("arch/backend-api.md", content)`, Then the file is written to `.voidrift/arch/backend-api.md`.
  - Given the develop phase calls `write_source_file("src/main.py", content)`, Then the file is written to `src/main.py`.
  - Given the develop phase calls `read_framework_file("arch/backend-api.md")`, Then the content of `.voidrift/arch/backend-api.md` is returned.
  - Given any phase calls `read_framework_file("logs/plan-20260324.log")`, Then access is denied.
- **REQ-MCP-6:** WHEN `get_template(name)` is called, THE SYSTEM SHALL retrieve the template from the in-memory index. IF the name is not found, THE SYSTEM SHALL return an error listing available templates.
  - Given `resources/templates/REQUIREMENTS-TEMPLATE.md` is indexed, When `get_template("REQUIREMENTS-TEMPLATE")` is called, Then the template content is returned.
  - When `get_template("NONEXISTENT")` is called, Then an error string is returned containing "not found" and a list of available template names.
- **REQ-MCP-7:** WHEN `load_tasks(path)` is called, THE SYSTEM SHALL parse `## Module: <name>` headers to split tasks into per-module queues. Tasks without a module header SHALL be assigned to a default module. All state changes SHALL be persisted back to the single TASKS.md file on disk.
  - *Rationale:* A single file with module headers is simpler to manage than multiple files per module — no glob discovery, no file copying, and atomic write-through updates all module state at once.
- **REQ-MCP-8:** WHEN `get_next_task(module)` is called, THE SYSTEM SHALL return the first unchecked (`- [ ]`) task for the given module, including its skill tags. The agent SHALL only ever see one task at a time.
  - *Rationale:* One task at a time keeps the agent's context window focused and prevents it from skipping ahead or reordering work.
- **REQ-MCP-9:** WHEN `complete_task(module)` is called, THE SYSTEM SHALL mark the first unchecked task as `- [x]` and write through to disk.
- **REQ-MCP-10:** The server SHALL use in-memory index for content (parsed markdown sections) and SQLite (`~/.voidrift/sessions.db`) for session metadata and ephemeral run data (analyses, escalation context). The SQLite connection SHALL be thread-safe (`check_same_thread=False`) to support concurrent file analysis in the gather pipeline.
- **REQ-MCP-11:** `write_source_file()` and `write_framework_file()` SHALL each track paths written during the current run. IF a path has already been written in the same run, the tool SHALL reject the call with an error message (e.g. "File already written this run: <path>") and return without overwriting.
  - Given a run where `write_framework_file("TASKS.md", "content")` has succeeded, When `write_framework_file("TASKS.md", "new content")` is called, Then the tool returns an error containing "already written" and the file content is unchanged.
- **REQ-MCP-12:** `list_skills()` SHALL return names and one-line descriptions of all available skill files across all three layers (north star, domain, project) per the search order defined in REQ-SKL-2.
- **REQ-MCP-13:** `list_templates()` SHALL return names and one-line descriptions of all available template files loaded from the resources directory.
- **REQ-MCP-14:** `list_documents()` SHALL return a listing of all `.voidrift/` artifacts (REQUIREMENTS.md, ARCHITECTURE.md, TASKS.md, spec/*.md, etc.) with file sizes.
- **REQ-MCP-15:** WHEN `get_prompt(phase, section)` is called, THE SYSTEM SHALL retrieve the named section from `resources/prompts/<phase>.md` using the markdown index (H2 heading match). IF the section is not found, THE SYSTEM SHALL return an error listing available sections for that phase. IF the phase file is not found, THE SYSTEM SHALL return an error listing available phase prompt files.
  - Given `resources/prompts/gather.md` contains `## TRIAGE`, When `get_prompt("gather", "TRIAGE")` is called, Then the TRIAGE section content is returned.
  - Given `resources/prompts/gather.md` exists, When `get_prompt("gather", "NONEXISTENT")` is called, Then an error is returned listing available section names.
  - Given no `resources/prompts/missing.md` exists, When `get_prompt("missing", "TRIAGE")` is called, Then an error is returned listing available phase files.
- **REQ-MCP-16:** `list_prompts(phase)` SHALL return the available section names (H2 headings) for the given phase prompt file. IF phase is omitted, SHALL return all phase names with their section lists.

### 4.3 Framework Reference Files

- **REQ-RES-1:** Each phase prompt file (`resources/prompts/<phase>.md`) SHALL contain stage-specific instructions as H2 sections. The shared methodology for a phase SHALL be a skill file (e.g. ANALYSIS-REQS for gather) loaded once and prepended to every stage prompt.
- **REQ-RES-2:** Global (north-star) skill files SHALL live in `resources/skills/` with uppercase filenames and serve as universal orientation guidance — they answer *what good looks like*, not *how to implement*. Available skills SHALL be determined dynamically from the directory contents. Domain and project skills follow the same filename convention but live in their respective layer directories (per REQ-SKL-1).
- **REQ-RES-3:** WHILE the plan phase is active, skill files SHALL be loaded on demand via `get_skill()` MCP tool calls (per REQ-ARCH-6).
- **REQ-RES-4:** WHILE the develop phase is active, skill files SHALL be loaded per-task via `get_skill()` MCP tool calls based on `[tag, ...]` annotations (per REQ-ARCH-6).
- **REQ-RES-5:** IF a skill file referenced in a task tag does not exist, THE SYSTEM SHALL print a warning and continue without loading it.
- **REQ-RES-6:** Phase prompt files SHALL live in `resources/prompts/<phase>.md` with H2 sections for each stage/step. The CLI SHALL load prompts via `get_prompt(phase, section)` MCP tool calls (per REQ-ARCH-6). Prompts MAY contain Python format variables (e.g. `{spec_path}`, `{group_name}`) which the CLI resolves via `.format()` before passing to the agent. A missing variable SHALL raise a `KeyError` — no silent substitution.
  - Given a prompt containing `{group_name}`, When the CLI calls `.format(group_name="backend")`, Then `{group_name}` is replaced with `backend`.
  - Given a prompt containing `{missing_var}`, When the CLI calls `.format(group_name="backend")`, Then a `KeyError` is raised for `missing_var`.
- **REQ-RES-7:** The CLI SHALL construct each agent's system prompt by concatenating four layers: (1) the shared framework context (`get_prompt("system", "CONTEXT")`) — phase lifecycle table and artifact ownership boundaries, loaded once per process; (2) the phase's methodology skill (loaded once via `get_skill()`) — how to think; (3) the stage-specific prompt (`get_prompt("<phase>", "<stage>")`) — what to do for this invocation; (4) any injected context (analyses, specs, task details) — what to work with. The system context and skill are loaded once per pipeline and reused across all agent invocations in that run. `resources/prompts/system.md` contains the shared framework context. Phase prompt files (`resources/prompts/<phase>.md`) contain only phase-specific instructions — they SHALL NOT duplicate the framework context from `system.md`.
  - *Rationale:* `system.md` ensures every agent — regardless of phase — understands the artifact table, phase boundaries, and what it must not do. Without it, each phase prompt would need to embed this context, creating duplication and drift. The four layers have distinct responsibilities: **system context** establishes *where in the framework this agent operates*, the **skill** defines *how to think*, the **prompt** defines *what to do*, and the **injected context** provides *what to work with*. Each layer is independently editable without touching the others. This replaced the former per-role agent files (ANALYST.md, ARCHITECT.md, DEVELOPER.md) — a single phase can have multiple agent invocations, each shaped by its specific prompt rather than a static role assignment.
  - Given any phase runs, When an agent is invoked, Then the system prompt opens with the `system/CONTEXT` section before phase-specific content.
  - Given `system.md` is updated, When the next phase runs, Then all agents across all phases see the updated framework context without changes to phase prompt files.

### 4.4 Phase 1 — Gather

- **REQ-G-1:** `voidrift gather <model> <path>` SHALL reverse-engineer requirements from the codebase at `<path>` using the four-stage pipeline (REQ-G-8). `--overwrite` removes files from the previous gather run (per STATE.md manifest) before starting.
  - Given no `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src` completes, Then `.voidrift/REQUIREMENTS.md` exists with content.
  - Given `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src` is run without `--overwrite`, Then the command exits with an error and the file is unchanged.
  - Given `.voidrift/REQUIREMENTS.md` exists, When `voidrift gather model ./src --overwrite` completes, Then the previous gather files are removed and new content is written.
- **REQ-G-8:** THE SYSTEM SHALL reverse-engineer requirements in four stages, each using separate agent instances (per REQ-ARCH-7). Source code is the primary requirements source — non-source files (tests, config, infrastructure, documentation, assets) are treated as context that informs source analysis. All agent outputs are returned as direct response text; the CLI captures responses and handles all persistence via the MCP session store and filesystem. No stage uses tool calls for output. All stage instructions SHALL live in `resources/prompts/gather.md`.
  - *Rationale:* Source code is the ground truth of what the system does. Tests reveal behavioral contracts, docs reveal intent, config reveals constraints — but only source defines what the system actually implements. Treating non-source as context ensures requirements are grounded in implementation, not documentation aspirations. Direct response output eliminates tool call JSON overhead: for the same `max_tokens` budget, direct text provides ~15-20% more usable content with no risk of mid-JSON truncation. The CLI owning persistence keeps each agent context minimal — agents process one message and return one response, never accumulating state.
  1. **Triage:** Agent receives the complete file tree and returns a JSON object with files sorted into predefined categories — `source` (application code), `tests` (test files), `config` (build/project configuration), `infrastructure` (deployment, CI/CD, IaC), `documentation` (READMEs, ADRs, guides), `assets` (static resources, migrations, seeds). All categories are flat file lists. The file tree SHALL respect `.gitignore`: IF a `.gitignore` file exists in the target directory, the CLI SHALL exclude all paths matched by its patterns. Dot-prefixed files and directories (e.g. `.git/`, `.env`, `.voidrift/`) SHALL always be excluded regardless of `.gitignore`. The agent infers category membership from its knowledge of the project's language and toolchain; the CLI SHALL NOT hardcode language-specific rules. A second validation pass SHALL review the triage output and remove any files that were incorrectly included (e.g. build output, lock files, binary assets).
  2. **Context Build:** One agent per non-source category (tests, config, infrastructure, documentation, assets). The CLI reads all files in the category and passes their contents in the user message. Each agent returns a concise context summary as direct response text — behavioral contracts from tests, design intent from docs, deployment constraints from infrastructure, toolchain constraints from config, data requirements from assets. The CLI stores each summary in the MCP session store and writes `.voidrift/analysis/context-<category>.md`. Context summaries SHALL be concise per REQ-G-17.
  3. **Source Analysis:** One agent per source file, run concurrently. Each agent receives the full context summary (all categories concatenated) in its user message alongside the instruction to analyze the file. The only tool available is `read_source_file()` (to read the file content). The agent returns requirements-focused analysis as direct response text — what the file implements, expressed as EARS requirements. The CLI stores each response in the MCP session store and writes `.voidrift/analysis/<filepath>.md`. Large source files SHALL be chunked per REQ-G-13.
  4. **Final Pass:** A single agent receives the context summary and all source-derived requirements in the user message. The CLI pre-fetches the REQUIREMENTS-TEMPLATE and includes it in the system prompt. No tools. The agent returns the complete REQUIREMENTS.md content as direct response text. The CLI writes the file to disk. The final pass SHALL resolve conflicts between source files, identify gaps (behaviors in context not implemented in source), deduplicate, and organize by functional area.
  The reference directory SHALL be strictly read-only.
  - Given a project with `src/main.py`, `Dockerfile`, `README.md`, and `tests/test_api.py`, When triage runs, Then each file is placed in the correct category (`source`, `infrastructure`, `documentation`, `tests`).
  - Given a project with non-source files, When context build runs, Then one summary agent is created per non-source category that has files.
  - Given a source file `src/api.py` and a context summary from `tests/` and `docs/`, When source analysis runs, Then the agent's user message contains both the context summary and the instruction to analyze `src/api.py`.
  - Given source analysis completes for all files, When the final pass agent is created, Then its user message contains the context summary and all per-file requirements.
  - Given a final pass agent, When its system prompt is examined, Then it contains the REQUIREMENTS-TEMPLATE and the ANALYSIS-REQS skill but no source requirements text.
  - Given the final pass completes, When REQUIREMENTS.md is inspected, Then it contains requirements traceable to source files with context from non-source files where relevant.
- **REQ-G-10:** Gather SHALL never auto-commit. `auto-commits: false` and `dirty-commits: false` SHALL be set.
- **REQ-G-11:** WHEN an API call fails due to context length exceeded, THE SYSTEM SHALL display a clear error identifying the stage, the group name, and a suggestion to use a model with a larger context window. The pipeline SHALL NOT silently truncate content to fit.
  - Given a model API returns an error containing "context length", When the agent loop catches the exception, Then a `RuntimeError` is raised with a message containing the model alias and "larger context window".
  - Given a source tree with 600 files, When `_build_file_tree` is called with the default 500 limit, Then a `RuntimeError` is raised with the actual file count and the limit.
- **REQ-G-12:** All gather agents SHALL use non-streaming mode (`stream=False`). Source analysis agents use `read_source_file()` tool calls; all other stages return direct response text.
  - *Rationale:* Non-streaming mode ensures vLLM parses the complete response before returning, which is required for reliable tool call extraction in the source analysis stage.
- **REQ-G-13:** WHEN a source file's character count exceeds the configured limit (REQ-CFG-6 `limits.max_input_chars`), THE SYSTEM SHALL split the file into overlapping chunks of that size (200-character overlap) and analyze each chunk with a separate agent. The default chunk size SHALL be 8000 characters for local models and unlimited (no chunking) for cloud models. IF the file produces more than one chunk, THE SYSTEM SHALL run a consolidation agent to merge the partial analyses into a single unified analysis before storing. IF chunking is triggered, the fact and chunk count SHALL be logged.
  - *Rationale:* Truncation loses the portion of the file beyond the limit. Chunking ensures every line is analyzed, at the cost of additional API calls per large file.
  - Given a local model and a source file of 20,000 characters, When source analysis runs, Then the file is split into chunks and each chunk is analyzed separately.
  - Given a cloud model, When source analysis runs on a 20,000 character file, Then no chunking occurs and the full file is passed in one agent call.
- **REQ-G-14:** The gather ANALYSIS prompt SHALL include an explicit conciseness instruction: bullet points only, maximum 15 items per analysis. The instruction SHALL appear after the analysis lens.
  - *Rationale:* Without an explicit output constraint, models produce exhaustive analyses that exceed token budgets for local models. Bullet-point format and an item cap force proportionate output without sacrificing signal.
  - Given an analysis agent prompt is constructed, When reviewed, Then it contains a conciseness instruction specifying bullet points and a maximum item count.
- **REQ-G-15:** *(Retired — tool call output eliminated from gather pipeline. JSON truncation errors are no longer possible. `_is_truncated_json_error` retained as a utility.)*

- **REQ-G-16:** *(Retired — superseded by REQ-G-8 Stage 4 direct response design.)*

- **REQ-G-17:** Context summaries produced in Stage 2 SHALL be concise: bullet points only, maximum 10 items per category. The CLI SHALL inject all category summaries concatenated as a single "Project Context" block into each source analysis agent's user message.
  - *Rationale:* Context summaries are injected into every concurrent source analysis agent. Unbounded summaries would multiply context cost across all source files. 10 items per category caps total injected context at ~300 tokens regardless of how many non-source files exist.
  - Given 12 documentation files, When context build runs, Then the documentation summary contains no more than 10 bullet points.
  - Given 3 non-source categories with files, When source analysis runs, Then each source agent's user message contains a "Project Context" section with summaries from all 3 categories.

### 4.5 Phase 2 — Plan

- **REQ-P-1:** Plan SHALL always produce `.voidrift/ARCHITECTURE.md` and `.voidrift/TASKS.md`. For multi-module projects, Plan SHALL also produce `.voidrift/arch/<module>.md` for each module — containing module-specific design detail (component internals, data models, internal interfaces, error handling patterns, and any cross-module interfaces this module exposes or consumes). ARCHITECTURE.md SHALL contain system-level context only: introduction, constraints, context diagram, module inventory, cross-module API contracts, and cross-cutting concerns. Module filenames in `arch/` SHALL match the `## Module: <name>` headers in TASKS.md (lowercased, spaces replaced with hyphens). IF ARCHITECTURE.md or TASKS.md is missing after the first run, one retry SHALL be issued. IF the retry also fails, THE SYSTEM SHALL exit with code 1. The agent's system prompt SHALL be constructed per REQ-RES-7: the ARCH-DESIGN skill (loaded once via `get_skill("ARCH-DESIGN")`) concatenated with the stage-specific prompt (loaded via `get_prompt("plan", "<stage>")`). All instructions SHALL live in `resources/prompts/plan.md`.
  - *Rationale:* ARCHITECTURE.md is the system map — lean by design so it can be loaded as overview context without consuming the developer's context window. Module arch files carry design depth and are loaded only for the relevant module's tasks. Including consumed/exposed interfaces in each module file ensures the developer has complete contract context without loading other modules' files. This mirrors the requirements hierarchy (REQUIREMENTS.md + spec/) and follows separation of concerns.
  - Given REQUIREMENTS.md exists, When `voidrift plan <model>` completes for a multi-module project, Then ARCHITECTURE.md, TASKS.md, and `arch/<module>.md` for each module exist in `.voidrift/`.
  - Given TASKS.md has `## Module: Backend API`, When arch files are produced, Then `arch/backend-api.md` exists.
  - Given module A consumes an API from module B, When `arch/module-a.md` is produced, Then it includes the interface contract it consumes from module B.
  - Given ARCHITECTURE.md is produced, When reviewed, Then it contains system-level context and does not contain module-internal component design.
  - Given the model fails to produce ARCHITECTURE.md on the first run, When the retry also fails, Then the command exits with code 1 and names the missing artifact.
- **REQ-P-2:** Planner output SHALL be fully hidden from the terminal. Only a spinner and status line SHALL be shown.
- **REQ-P-3:** WHEN `--overwrite` is specified, THE SYSTEM SHALL remove files from the previous plan run (per STATE.md manifest) before planning. Gather-produced artifacts (REQUIREMENTS.md, spec/*.md) SHALL be preserved.
  - Given a previous plan created ARCHITECTURE.md, TASKS.md, and arch/*.md, When `voidrift plan <model> --overwrite` is run, Then those files are deleted (per STATE.md manifest) before the planning agent starts.
- **REQ-P-4:** `auto-commits: false` SHALL be set for the plan phase.
- **REQ-P-5:** For single-module projects, tasks SHALL be written under a `## Tasks` header. For multi-module projects, tasks SHALL be grouped under `## Module: <name>` headers in a single TASKS.md.
- **REQ-P-6:** In multi-module projects, each file path SHALL appear in exactly one module's task group. No file SHALL be created or modified by tasks in more than one module.
- **REQ-P-7:** Each task line SHALL be a single atomic file operation: `- [ ] <Action verb> <file path>: <exact behavior>. <rationale or user story context> [skill1, skill2]`. The behavior description SHALL include enough context for a developer agent to implement without cross-referencing requirements — acceptance criteria, expected inputs/outputs, error cases, and the *why* behind the task. Tasks that say only "implement X" without specifying behavior are insufficient.
  - *Rationale:* The developer agent processes one task at a time with limited context. Front-loading implementation detail and rationale into the task description reduces the developer's dependence on loading full requirements, decreasing context window usage and improving output quality.
  - Given a task for creating an API endpoint, When the planner writes the task, Then the task includes the route, method, request/response shape, error cases, and the user story it satisfies.
  - Given a task for creating a UI component, When the planner writes the task, Then the task includes props, behavior, accessibility requirements, and which requirement it addresses.
  - Given a task creates test files, When the planner writes the task description, Then the description identifies the AC identifier(s) the tests must validate (e.g. "validates AC-ARCH-4 and AC-ARCH-8").
- **REQ-P-8:** Tasks SHALL NOT contain shell commands. Tasks describe file content only.
- **REQ-P-9:** WHEN the architect writes TASKS.md, THE SYSTEM SHALL parse all skill tags (`[skill1, skill2]`) and validate them against available skill files. IF invalid tags are found, THE SYSTEM SHALL strip them from TASKS.md directly and log a warning. Valid tags on the same task line SHALL be preserved. The plan prompt SHALL include the complete list of valid skill names so the model cannot invent nonexistent tags.
  - *Rationale:* Asking the model to rewrite a large TASKS.md via tool calls is unreliable — the model's context is exhausted after the initial plan, and tool call parsing fails on large payloads. Direct string manipulation is deterministic and instant. Injecting valid skill names into the prompt prevents the problem at the source.
  - Given TASKS.md contains `[web-eng, documentation]` and `documentation` is not a valid skill, When validation runs, Then the line is rewritten to `[web-eng]` and a warning is logged.
  - Given TASKS.md contains `[documentation]` (only tag is invalid), When validation runs, Then the tag bracket is removed entirely from the task line.
  - Given the plan prompt is constructed, When the system prompt is formatted, Then it contains the complete list of valid skill names.
- **REQ-P-10:** `.voidrift/ARCHITECTURE.md` SHALL follow the structure defined in `ARCHITECTURE-TEMPLATE` (loaded via `get_template("ARCHITECTURE-TEMPLATE")`). The template follows the arc42 documentation standard with C4 model diagrams (Mermaid). The model SHALL populate each section with project-specific content.
  - *Rationale:* arc42 is an industry-standard architecture documentation framework providing a proven section structure. C4 (Context, Container, Component, Code) provides consistent diagram levels. Together they ensure architecture documents are complete, navigable, and familiar to engineers.
- **REQ-P-11:** `voidrift plan <model> --update` SHALL read the current REQUIREMENTS.md, spec files, and existing ARCHITECTURE.md and TASKS.md, then plan from the current requirements. The existing artifacts are context to preserve completed work — requirements are the source of truth. The model SHALL preserve completed tasks (`- [x]`), update or remove tasks that no longer apply, and add new tasks for any unaddressed requirements. The existing architecture SHALL be treated as a starting point, not regenerated from scratch.
  - Given ARCHITECTURE.md and TASKS.md exist, When `voidrift plan <model> --update` completes, Then requirements are the source of truth and completed tasks are preserved.
  - Given no ARCHITECTURE.md exists, When `voidrift plan <model> --update` is run, Then the command exits with an error.
- **REQ-P-12:** Tasks SHALL NOT target `.voidrift/` paths. The `.voidrift/` directory contains framework artifacts (requirements, architecture, specs, logs) produced by gather and plan — not the develop phase. Dot-prefixed project files (`.github/`, `.dockerignore`, `.eslintrc`, etc.) are valid develop targets.
  - *Rationale:* `.voidrift/` contains framework artifacts produced by gather and plan. Develop tasks that target `.voidrift/` paths overwrite planning artifacts or create redundant specs. However, many projects legitimately require dot-prefixed config files (CI workflows, linter configs, Docker ignore files) that the develop phase must create.
  - Given TASKS.md contains a task targeting `.voidrift/spec/backend.md`, When the plan is reviewed, Then the task is invalid — spec files are plan artifacts.
  - Given TASKS.md contains a task targeting `.github/workflows/ci.yml`, When the plan is reviewed, Then the task is valid — CI config is a project source file.
  - Given TASKS.md contains a task targeting `src/main.py`, When the plan is reviewed, Then the task is valid.

### 4.6 Phase 3 — Develop

- **REQ-D-1:** WHEN `.voidrift/TASKS.md` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift plan`.
  - Given no `.voidrift/TASKS.md` exists, When `voidrift develop <model>` is run, Then the command exits with an error containing "Run 'voidrift plan'".
- **REQ-D-2:** WHEN all tasks are marked `[x]`, THE SYSTEM SHALL exit with "all tasks complete" and return 0.
  - Given all tasks in TASKS.md are `[x]`, When `voidrift develop <model>` is run, Then the command exits with code 0 and prints "All tasks complete."
- **REQ-D-3:** WHEN a develop session starts, THE SYSTEM SHALL create `.voidrift/.develop.lock` with PID and timestamp. IF the lock exists with a live PID, THE SYSTEM SHALL exit with error.
  - Given no lock file exists, When a develop session starts, Then `.develop.lock` is created with the current PID.
  - Given a lock file exists with a live PID, When `voidrift develop <model>` is run, Then the command exits with an error containing the PID.
  - Given a lock file exists with a dead PID, When `voidrift develop <model>` is run, Then the stale lock is removed and the session starts.
- **REQ-D-4:** WHILE the develop loop is active, THE SYSTEM SHALL process the first unchecked task from TASKS.md via `get_next_task()`. WHEN no unchecked tasks remain, the loop SHALL exit. Each developer agent SHALL use the narrowed per-task tool set (REQ-ARCH-9) and load context on demand via tool calls following the step sequence in the develop prompt: load the module's architecture (`arch/<module>.md` via `read_framework_file`), load the module's requirements (`spec/<module>.md` via `read_framework_file`), then implement the task. Module filenames are derived from the `## Module:` header (lowercased, spaces to hyphens). The system prompt SHALL contain only: the develop task prompt with the task text, any architect guidance, and the names of tagged skills (if present) — the CLI SHALL NOT pre-load system context or full skill content into the system prompt. Tagged skill names SHALL appear in the task text so the agent can call `get_skill()` on demand. Architect guidance (when present) MAY be included in the system prompt as it is already specific to the task. All instructions SHALL live in `resources/prompts/develop.md`.
  - *Rationale:* On-demand loading lets the model process each document intentionally — reading it, extracting what's relevant to the task, and keeping those decisions in message history. This produces higher fidelity than pre-loading everything into the system prompt as an undifferentiated blob. Module-scoped files keep each load small. Fresh agents per task (REQ-ARCH-7) prevent context accumulation. Excluding system context and pre-loaded skills reduces the system prompt to the minimum needed to start, keeping local model context overhead proportionate.
  - Given TASKS.md has 3 unchecked tasks, When the develop loop runs, Then tasks are processed in order via `get_next_task()` until none remain.
  - Given `arch/backend-api.md` and `spec/backend-api.md` exist, When a "Backend API" task runs, Then the agent loads both via `read_framework_file` tool calls during execution.
  - Given a task has `[web-eng, quality-qa]` tags, When the task prompt is constructed, Then the task text contains the tag names but the skill content is NOT pre-loaded in the system prompt.
  - Given no `arch/` file exists for a module, When the agent attempts to load it, Then the tool returns a not-found message and the agent proceeds with available context.
  - Given a task implements test files, When the developer writes test functions, Then each test function name includes the AC identifier it validates (e.g. `test_req_arch4_tool_choice_required`).
- **REQ-D-5:** AFTER a task completes, THE SYSTEM SHALL verify that `write_source_file()` was called at least once during the task. IF no writes occurred, THE SYSTEM SHALL retry the task once. IF the retry also produces no writes AND an architect is configured, THE SYSTEM SHALL escalate. Additionally, IF git is initialized and HEAD exists, THE SYSTEM SHALL check `git diff HEAD` — if no changes are detected despite writes, THE SYSTEM SHALL log a warning.
  - Given a task completes without any `write_source_file()` calls, When the system checks, Then the task is retried.
  - Given a retry also produces no writes and an architect is configured, When the system checks, Then the task is escalated.
- **REQ-D-6:** WHEN the developer escalates, THE SYSTEM SHALL consult the architect model with the escalation context and inject the architect's response into the agent's message history, then retry the task. Escalations and responses are ephemeral — they exist only in the agent's message history during the run. The architect's system prompt SHALL be constructed per REQ-RES-7: the escalation prompt (loaded via `get_prompt("develop", "ESCALATION")`) with the question, task text, requirements, and architecture injected via format variables. WHEN only one model is provided, THE SYSTEM SHALL use that model for both task execution and escalation consultations.
  - *Rationale:* Any model can fill either role. The escalation prompt assigns the architect role regardless of which model serves it. A single capable model (e.g. claude) can handle both implementation and design guidance.
  - Given a developer writes an escalation file, When the system detects it, Then the architect is consulted and the response is injected into the developer's next attempt.
  - Given `voidrift develop claude` is run with no architect argument, When the developer escalates, Then the same claude model is consulted using the ESCALATION prompt.
- **REQ-D-7:** WHEN `max_escalations` (5) is exceeded for a session, THE SYSTEM SHALL mark the task `[!]` (blocked), increment `blocked_tasks`, and continue to the next task.
  - Given 5 escalations have occurred, When the developer escalates again, Then the task is marked `[!]` and the next task begins.
- **REQ-D-8:** WHEN architect is consulted, THE SYSTEM SHALL provide: problem description, REQUIREMENTS.md, ARCHITECTURE.md, and task text. Source code files SHALL NOT be loaded.
  - Given a developer escalates, When the architect prompt is constructed, Then it contains the question, task text, full REQUIREMENTS.md, and full ARCHITECTURE.md — no source files.
- **REQ-D-9:** Task completion SHALL be managed by the develop phase framework code, which calls `complete_task()` on the MCP server with the correct module name after verifying writes occurred. The model SHALL NOT call `complete_task()` directly — the develop prompt SHALL explicitly instruct the model not to. The `complete_task()` MCP tool marks `- [ ]` as `- [x]` and writes through to disk.
  - *Rationale:* The model does not know the correct module name for multi-module projects. When the model calls `complete_task()` with an empty or wrong module, the task store cannot find the task. The framework has the correct module context from `_develop_module` and calls completion after verifying `write_source_file()` was invoked.
  - Given a task is pending `[ ]`, When the framework calls `complete_task(module)` after successful writes, Then the task is marked `[x]` in TASKS.md on disk.
  - Given the develop prompt, When the model reads its instructions, Then the prompt contains "Do NOT call complete_task()".
- **REQ-D-10:** WHEN `.voidrift/TASKS.md` contains `## Module:` headers, THE SYSTEM SHALL run modules concurrently using `ThreadPoolExecutor` with the concurrency limit from `get_concurrency()` for the model type (local: 1, cloud: 8, gateway: 8, configurable via `config.yml`). WHEN concurrency is 1, modules SHALL be processed sequentially. WHEN concurrency is 0, one worker SHALL be spawned per module.
  - *Rationale:* Concurrency is a model capacity concern, not a per-command flag. The same `concurrency` config used by gather applies to develop — one place to configure, consistent behavior across phases.
  - Given TASKS.md has 3 `## Module:` headers and the model type is cloud, When develop runs, Then up to 8 modules run concurrently via ThreadPoolExecutor.
  - Given the model type is local (concurrency 1), When develop runs with module headers, Then modules are processed sequentially.
- **REQ-D-11:** WHEN multiple workers are active, git operations SHALL be serialized through a `threading.Lock` to prevent index conflicts.
  - *Rationale:* Concurrent `git diff` or future `git commit` calls from parallel module workers can corrupt the git index. A shared lock serializes access.
  - Given 3 modules running concurrently, When two workers trigger git diff simultaneously, Then only one executes at a time (the other blocks until the lock is released).
- **REQ-D-12:** WHEN the concurrency config is greater than 1 AND no module headers exist in TASKS.md, THE SYSTEM SHALL process tasks sequentially (single module behavior).
  - Given TASKS.md has no `## Module:` headers, When develop runs with cloud concurrency config of 8, Then tasks are processed sequentially.
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
- **REQ-U-2:** `voidrift chat <model>` SHALL start an interactive session with full MCP tool access (per REQ-ARCH-6) — the central command for iterating on any `.voidrift/` artifact. The agent SHALL use `tool_choice: "auto"` (per REQ-ARCH-4) and streaming mode for responsive token-by-token display. The agent's system prompt SHALL be constructed per REQ-RES-7: the ANALYSIS-REQS skill as baseline methodology, the `chat/SYSTEM` prompt for behavioral rules, and optional context. The agent MAY load additional domain skills on demand via `get_skill()`. `--doc <path>` SHALL scope the conversation to a specific `.voidrift/` artifact, loading its content into the system prompt context. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt (not exit).
  - Given a valid model alias, When `voidrift chat <model>` is run, Then an interactive session starts with the ANALYSIS-REQS skill and `chat/SYSTEM` prompt loaded.
  - Given `--doc REQUIREMENTS.md` and the file exists, When the session starts, Then the system prompt includes the file's content.
  - Given `--doc new-spec.md` and the file does not exist, When the session starts, Then a warning is printed and the system prompt includes the DOC-NEW section.
  - Given a model API error during a chat turn, When the agent raises a RuntimeError, Then the error is printed and the prompt reappears.
- **REQ-U-3:** `voidrift log <phase>` SHALL show the last 200 lines of the most recent log. `--follow` / `-f` SHALL tail the latest log file, streaming new lines as they are written. `--prune` SHALL delete log files.
- **REQ-U-4:** `voidrift unlock` SHALL remove the develop lock file and kill any running develop process.
- **REQ-U-5:** `voidrift completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. All model, worker, and architect arguments SHALL complete from configured aliases in `models.yml`.
- **REQ-U-6:** `voidrift prune` SHALL remove project-level ephemeral data (`.voidrift/` logs, stale `.develop.lock`) beyond the configured retention limit (`retention.project`, default 5). `--all` SHALL remove the entire `.voidrift/` directory — a clean slate. `--global` SHALL prune the framework-level SessionStore (`~/.voidrift/`) beyond the configured retention limit (`retention.global`, default 30 days). `--global --all` SHALL remove ALL framework SessionStore data. WHEN `--global` is NOT set AND no `.voidrift/` directory exists in the current project, THE SYSTEM SHALL exit with a friendly error (e.g. "No .voidrift directory found — nothing to prune").
- **REQ-U-7:** WHEN the operator types `/compact` during a chat session, THE SYSTEM SHALL summarize the conversation history to free context. The agent SHALL send the current message history to the model with a summarization prompt, replace all user/assistant/tool messages with a single system message containing the summary, and preserve the original system prompt. The resulting message history (system prompt + summary) SHALL NOT exceed 10% of the model's context window. The summary SHALL capture key decisions, artifacts discussed, and any pending work. The context window size SHALL be queried from the model's API at session start — no hardcoded limits.
  - *Rationale:* Long chat sessions accumulate context from tool results (file contents, analyses, requirements) until the context window fills. Summarization preserves session continuity without restarting. The 10% ceiling leaves 90% of the context available for the next exchange.
  - Given a chat session with 50K tokens of history, When the operator types `/compact`, Then the history is replaced with a summary and the total message size is ≤10% of the model's max context.
  - Given a chat session with only the system prompt, When the operator types `/compact`, Then the system prints "Nothing to compact." and the history is unchanged.

### 4.10 Model Configuration

- **REQ-MC-1:** WHEN a model alias is used, THE SYSTEM SHALL resolve it to `(base_url, api_key, model_id)`. The CLI SHALL discover local model aliases from `worker-models.yml` (at `~/.voidrift/worker-models.yml`) in addition to `models.yml`. A local model present in `worker-models.yml` SHALL be accessible via its alias without requiring a duplicate entry in `models.yml`. Explicit entries in `models.yml` take precedence over synthesized worker entries. IF an alias is not found in either source, THE SYSTEM SHALL exit with an error listing all available aliases from both sources.
  - *Rationale:* `worker-models.yml` is the source of truth for local models — it is already maintained by `worker models add/remove`. Requiring operators to duplicate entries in `models.yml` adds toil and introduces drift. Auto-discovery eliminates that toil: add a model to the worker, it immediately appears in `voidrift` tab-completion and interactive mode.
  - Given `worker-models.yml` has alias `qwen35` and `models.yml` does not, When `resolve_model("qwen35")` is called, Then a `ModelConfig` with `type=local` and `base_url` derived from `worker.ip` and `worker.port` is returned.
  - Given both `models.yml` and `worker-models.yml` have alias `qwen35`, When `resolve_model("qwen35")` is called, Then the `models.yml` entry is used (explicit takes precedence).
  - Given `voidrift gather qwen35` is run with no `models.yml` entry but a `worker-models.yml` entry, When the alias is resolved, Then the command proceeds normally.
- **REQ-MC-2:** Cloud models SHALL require no initialization and be accessed directly via API endpoints.
- **REQ-MC-3:** The models config file SHALL support three endpoint types: `local` (worker node vLLM), `cloud` (provider APIs), and `gateway` (Kiro Gateway). Each entry specifies `base_url`, `api_key` (or env var reference), and `model_id`. Cloud and gateway model entries MAY include an integer `max_context` field specifying the context window size. The CLI SHALL use this field when the model's API endpoint does not expose `max_model_len`. No hardcoded context size table SHALL exist in the CLI code.
  - *Rationale:* Cloud APIs (Anthropic, Google) do not return `max_model_len` on their `/v1/models` endpoint. Rather than hardcoding a lookup table in the CLI that silently becomes stale, context sizes belong in the config file where they are visible, auditable, and operator-controlled. Local vLLM endpoints already return `max_model_len` via their API — no config field needed.
  - Given `models.yml` has `max_context: 200000` for `claude`, When `_query_max_context(mc)` is called and the API returns no `max_model_len`, Then `200000` is returned.
  - Given `models.yml` has no `max_context` for a model and the API returns no `max_model_len`, When `_query_max_context(mc)` is called, Then `None` is returned.

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
- **REQ-WK-6:** `worker models list` SHALL display configured models (from `worker-models.yml`) and cached models (from HF cache) with clear section headers. Each configured model SHALL show a status: `✅ running` (active container), `✓ current` (cached, matches remote HEAD SHA), `⬆ update` (cached, remote has newer revision), `⚠ not downloaded` (not cached). Remote revision checks SHALL use the HuggingFace API (`/api/models/<repo>/revision/main`). IF the API is unreachable, the status SHALL fall back to `✓ cached`.
  - Given a configured model is cached and matches the remote HEAD SHA, When `worker models list` is run, Then the model shows `✓ current`.
  - Given a configured model is cached but the remote HEAD SHA differs, When `worker models list` is run, Then the model shows `⬆ update`.
  - Given the HuggingFace API is unreachable, When `worker models list` is run, Then cached models show `✓ cached` (graceful fallback).
- **REQ-WK-6a:** `worker models add <alias> <repo>` SHALL add a new model to `worker-models.yml` AND download the weights. IF the alias already exists, THE SYSTEM SHALL exit with an error.
  - Given alias `new-model` does not exist, When `worker models add new-model org/repo` is run, Then the alias is added to `worker-models.yml` and weights are downloaded.
  - Given alias `qwen3-coder` already exists, When `worker models add qwen3-coder org/repo` is run, Then the command exits with an error and `worker-models.yml` is unchanged.
- **REQ-WK-6b:** `worker models remove <alias>` SHALL delete the cached weights AND move the model config to a `retired` section in `worker-models.yml`.
- **REQ-WK-6c:** `worker models check` SHALL audit all configured models, verify cache integrity, and attempt to download missing weights for configured models. It SHALL report unconfigured models in the cache. With `--prune`, it SHALL remove unconfigured cached models.
- **REQ-WK-7:** Only one local model container SHALL run at a time on the worker node.
  - Given container A is running, When `worker start` launches container B, Then container A is stopped before container B starts.
- **REQ-WK-8:** Model configurations SHALL be defined in `worker-models.yml` specifying: repository, image source (alias referencing `worker-images.yml`), GPU memory utilization, max model length, vLLM args, served model name, cache mounts, and optional recipe name. A `default_image` key at the top level SHALL set the image source for all models that do not specify one. IF a model specifies `image`, it SHALL override the default. IF neither `image` nor `default_image` is set, THE SYSTEM SHALL exit with an error identifying the model. WHEN a model specifies a `recipe` field AND the resolved image source is type `git`, `worker start` SHALL execute the recipe via the image source's run command (e.g. `./run-recipe.sh <recipe> --solo`) instead of constructing a `docker run` command. The recipe handles container creation, mods, environment, and vLLM arguments — `vllm_args`, `gpu_memory_utilization`, and `max_model_len` from the model config are ignored when a recipe is active. `worker start` SHALL still poll the API endpoint until ready and enforce the single-container constraint (REQ-WK-7).
  - *Rationale:* Decoupling image sources from model configs means switching all models from one image (e.g. scitrera) to another (e.g. eugr) is a single `default_image` change, not an edit per model. Recipe support allows image sources with their own launch systems (mods, patches, chat templates) to manage the full container lifecycle while the worker-cli handles health polling and the single-container constraint.
  - Given `default_image: eugr` and a model with no `image` field, When the model is started, Then the `eugr` image source is used.
  - Given `default_image: eugr` and a model with `image: scitrera`, When the model is started, Then the `scitrera` image source is used.
  - Given no `default_image` and a model with no `image` field, When the model is started, Then the command exits with an error.
  - Given a model with `recipe: qwen3.5-35b-a3b-fp8` and `image: eugr` (git source at `~/opt/eugr`), When `worker start` is run, Then the CLI executes `cd ~/opt/eugr && ./run-recipe.sh qwen3.5-35b-a3b-fp8 --solo` on the worker and polls until the API responds.
  - Given a model with `recipe` set but the image source is type `docker`, When `worker start` is run, Then the CLI ignores the recipe and uses the standard `docker run` path.
- **REQ-WK-9:** `worker kiro start` SHALL start the Kiro Gateway container. `worker kiro stop` SHALL stop it. `worker kiro status` SHALL report health and available models.
- **REQ-WK-10:** WHEN Kiro Gateway credentials are invalid (expired token, database permissions), THE SYSTEM SHALL stop immediately with a clear error message identifying the failure mode.
  - *Rationale:* Prevents the CLI from entering an infinite retry loop against invalid credentials. The error message directs the operator to the specific fix (re-login, chmod).
  - Given the Kiro Gateway returns a 401 during health check, When the CLI detects the auth failure, Then the command exits with an error message identifying expired credentials.
- **REQ-WK-11:** `worker logs [-f]` SHALL list all worker containers (running and stopped) with status, mark the active one, and prompt the user to select one. It SHALL then show that container's logs. IF no containers exist, it SHALL exit with an error.
  - Given no containers exist on the worker node, When `worker logs` is run, Then the command exits with an error message.
- **REQ-WK-12:** `worker info` SHALL report worker node GPU status (`nvidia-smi`), disk usage (`df -h`), and memory (`free -h`) over SSH.
- **REQ-WK-13:** Image sources SHALL be defined in `worker-images.yml`. Each source SHALL have an alias, a type (`git` or `docker`), and type-specific fields. The Worker CLI SHALL provide subcommands to manage image sources:
  - `worker images list` SHALL display all configured image sources with their type, status (built/pulled, version, last updated), and which models reference them. It SHALL also list Docker images present on the worker node.
  - `worker images add <alias> <url>` SHALL register a new image source. The CLI SHALL auto-detect the type from the URL: git repository URLs (ending in `.git` or matching known hosts) create `git` type sources; Docker Hub or registry URLs create `docker` type sources. For `git` sources, the CLI SHALL clone the repository on the worker node AND build the Docker image. For `docker` sources, the CLI SHALL pull the image on the worker node. In both cases, the command SHALL not return until a usable Docker image exists on the worker. IF the alias already exists, THE SYSTEM SHALL exit with an error.
  - `worker images remove <alias>` SHALL remove the image source from `worker-images.yml` AND delete all associated assets from the worker node: cloned repositories, built Docker images, and pulled Docker images. IF any model references the alias, THE SYSTEM SHALL warn and require `--force`.
  - `worker images update <alias>` SHALL update the image source on the worker node. For `git` sources, this SHALL `git pull` the repository and rebuild the Docker image. For `docker` sources, this SHALL pull the latest tag. The CLI SHALL report what changed (new commits, new tag, no changes). The command SHALL not return until the updated Docker image exists on the worker.
  - `worker images build <alias>` SHALL build (or rebuild) the Docker image for a `git` source on the worker node by executing the source's build command. SHALL exit with an error for `docker` type sources.
  - *Rationale:* Different vLLM images serve different needs — pre-built images (scitrera, official vllm) are convenient, while source-built images (eugr) provide latest patches and model-specific fixes. Managing them as named sources decouples image lifecycle from model configuration.
  - Given `worker-images.yml` has `eugr` (git) and `scitrera` (docker), When `worker images list` is run, Then both sources are shown with their type and status.
  - Given alias `eugr` does not exist, When `worker images add eugr https://github.com/eugr/spark-vllm-docker.git` is run, Then the alias is added to `worker-images.yml` and the repo is cloned on the worker.
  - Given alias `scitrera` does not exist, When `worker images add scitrera scitrera/dgx-spark-vllm:0.17.0-t5` is run, Then the alias is added to `worker-images.yml` and the image is pulled on the worker.
  - Given alias `eugr` exists and a model references it, When `worker images remove eugr` is run without `--force`, Then the command exits with a warning listing the referencing models.
  - Given alias `eugr` exists, When `worker images remove eugr --force` is run, Then the repo and built images are deleted from the worker and the alias is removed from config.
  - Given alias `eugr` is a git source, When `worker images update eugr` is run, Then the repo is pulled and the image is rebuilt on the worker.
- **REQ-WK-13a:** `worker-images.yml` SHALL define image sources with the following structure:
  ```yaml
  sources:
    <alias>:
      type: git | docker
      # git sources:
      url: <repository URL>
      build_cmd: <build command, default: ./build-and-copy.sh>
      image_name: <resulting Docker image name, default: vllm-node>
      clone_path: <path on worker, default: ~/opt/<alias>>
      # docker sources:
      image: <registry/image:tag>
  ```
  For `git` sources, the `build_cmd` SHALL be executed in the cloned repository directory on the worker node via SSH. For `docker` sources, the `image` field SHALL be the full Docker image reference used for `docker pull` and `docker run`.
  - *Rationale:* Git sources need a clone location, build command, and resulting image name because different repos have different build conventions. Docker sources just need the image reference. Defaults minimize config for common cases.
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
- **REQ-PS-3:** `.voidrift/STATE.md` SHALL be created on the first phase run and appended to by every phase. Each entry records: timestamp, phase name, model used, outcome summary, and a file manifest listing every file created or modified during that run. The gather phase SHALL additionally record each analyzed file with its triage category. The chat agent SHALL read STATE.md to understand project lifecycle position. STATE.md is append-only — phases add entries, they never rewrite or truncate (except `--undo` which removes the last entry for a phase).
  - *Rationale:* A single state file provides lifecycle traceability, enables `--undo` and `--overwrite` by tracking exactly what each phase produced, and gives the chat agent awareness of project state without inferring from file existence.
  - Given gather completes, Then STATE.md contains a gather entry with analyzed files (with categories), output summary, and file manifest.
  - Given plan completes, Then STATE.md contains a plan entry listing ARCHITECTURE.md, arch/*.md, and TASKS.md in its file manifest.
  - Given the chat agent starts, Then it reads STATE.md and knows which phases have run, when, with which model, and what they produced.
  - Given no STATE.md exists, Then the project has no phase history.
- **REQ-PS-4:** IF `.voidrift/` exists but is missing required files for a phase, THE SYSTEM SHALL exit with an error suggesting corrective action.

### 4.14 Logging

Two log roots, two intents:
- **`~/.voidrift/logs/`** — framework logs. Record what the framework itself did: CLI invocations, phase outcomes, MCP server internals. Persist across projects. Managed by RotatingFileHandler.
- **`<project-root>/.voidrift/logs/`** — project logs. Record what the framework did *to a specific project*: full agent dialog, tool calls, tool results for each phase run. Scoped to the project. Pruned by `voidrift prune`.

- **REQ-LOG-1:** Phase run logs SHALL be written to `<project-root>/.voidrift/logs/<phase>-YYYYMMDD-HHMMSS.log`. The log filename stem is the run ID passed to the MCP server (REQ-MCP-3a). Phase logs are the canonical verbose record of agent interactions, tool calls, and tool results for a run.
  - Given `voidrift gather qwen3 ./src` is run, When the phase starts, Then a log file is created at `<project-root>/.voidrift/logs/gather-<timestamp>.log`.
- **REQ-LOG-2:** Project log files SHALL accumulate until pruned by `voidrift prune`. Framework log files rotate automatically via `RotatingFileHandler`.
- **REQ-LOG-3:** WHEN a phase displays its log path, it SHALL appear immediately after the phase title line.
- **REQ-LOG-4:** THE SYSTEM SHALL maintain a persistent system log at `~/.voidrift/logs/voidrift.log` using Python's `logging` module with a `RotatingFileHandler` (max 1 MB per file, 5 backup files, UTF-8 encoding). THE SYSTEM SHALL initialize this log at CLI startup in `main()` before any commands execute. The system log SHALL record: CLI invocations (argv), phase completion events (phase name, exit code, elapsed time), configuration load errors, and unhandled exceptions.
  - *Rationale:* Phase logs record agent dialog at depth — they are verbose by design. A separate, compact system log answers the operational question: "what did the CLI do and did it succeed?" without tailing a 10,000-line agent log. Keeping it in `~/.voidrift/logs/` (not the project) means it persists across projects and is always accessible even when no project is active.
  - Given `main()` is called, When the CLI starts, Then `~/.voidrift/logs/voidrift.log` exists and is writable.
  - Given a `voidrift gather qwen3` run completes, When the system log is read, Then it contains an invocation line and a completion line with exit code.
- **REQ-LOG-5:** THE SYSTEM SHALL maintain a persistent MCP server log at `~/.voidrift/logs/mcp.log` using Python's `logging` module with a `RotatingFileHandler` (max 1 MB per file, 5 backup files, UTF-8 encoding). THE SYSTEM SHALL initialize this log in `_boot()` before any MCP tools execute. The MCP log SHALL record: server boot events (run ID, project directory), write operations (`write_file` calls with path and byte count), tool call errors (tool name and exception text). `voidrift.log` records CLI invocations and phase outcomes. `mcp.log` records MCP server internals. The two logs have distinct intents and SHALL NOT duplicate each other's entries.
  - *Rationale:* The MCP server runs as a subprocess with no terminal output. Without a log, tool errors and write operations are invisible to the operator. Keeping it in `~/.voidrift/logs/` alongside the system log groups all framework-internal observability in one place.
  - Given `_boot()` is called, When the MCP server starts, Then `~/.voidrift/logs/mcp.log` exists and contains a boot entry with the run ID.
  - Given `write_file("src/main.py", content)` is called, When the write succeeds, Then `mcp.log` contains an entry recording the path and byte count.
  - Given a tool call raises an exception, When the exception is caught, Then `mcp.log` contains an error entry with the tool name and exception text.

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
- **REQ-UI-6:** WHILE a chat session is active, the input prompt SHALL display the current context window utilization as a percentage: `[25%] >`. The percentage SHALL be calculated from the total message history token count relative to the model's max context window, queried from the model's API at session start. The percentage color SHALL be: white when ≤60%, yellow when >60% and ≤80%, red when >80%.
  - *Rationale:* Operators need visibility into context consumption to know when to `/compact` or start a new session. Color thresholds match standard warning/danger conventions.
  - Given message history using 15K of 65K tokens, When the prompt is displayed, Then it shows `[23%] >` in white.
  - Given message history using 45K of 65K tokens, When the prompt is displayed, Then it shows `[69%] >` in yellow.
  - Given message history using 55K of 65K tokens, When the prompt is displayed, Then it shows `[85%] >` in red.

### 4.16 Framework Configuration

- **REQ-CFG-1:** All framework configuration SHALL be read from `~/.voidrift/config.yml`. Config files SHALL support `${VAR}` and `${VAR:-default}` for environment variable expansion, and `${section.key}` for cross-referencing values from config.yml.
- **REQ-CFG-2:** `config.yml` SHALL contain sections for: `worker` (user, ip, api_key, hf_token), `kiro` (port, api_key), and `api_keys` (anthropic, gemini). Connection settings are literal values; secrets use env var references.
- **REQ-CFG-3:** Framework resources (skills, templates, prompts), `models.yml`, and `worker-models.yml` SHALL be read from `~/.voidrift/`. The repo is the source of truth; `make sync` copies to `~/.voidrift/`.
- **REQ-CFG-4:** `VOIDRIFT_HOME` env var MAY override `~/.voidrift/` for testing and CI. IF not set, `~/.voidrift/` is used.
- **REQ-CFG-5:** `config.yml` SHALL contain a `retention:` section with `project` (integer, default 5 — number of recent runs to keep) and `global` (integer, default 30 — days of session data to keep). `voidrift prune` uses these limits.
- **REQ-CFG-6:** `config.yml` SHALL support a `limits:` section with: `local_max_tokens` (integer, default 4096), `cloud_max_tokens` (integer, default 32768), and `max_input_chars` (integer, default 8000 for local / 0 = unlimited for cloud). These caps are applied by `get_max_tokens(model_type, phase)` and `get_max_input_chars(model_type)` in `config.py`. IF the section or a key is absent, the defaults apply.
  - *Rationale:* Local models hallucinate and produce truncated JSON when asked to generate more tokens than their effective working window supports. Hard-coding 16384 everywhere gives local models too large an output budget. Making the cap configurable lets operators tune for their specific hardware without code changes.
  - Given `limits.local_max_tokens: 3000` is set, When a local model agent is constructed with phase "analysis", Then its max_tokens is 2000 (the per-phase default is lower than the cap, so the phase default wins).
  - Given `limits.local_max_tokens: 1500` is set, When a local model agent is constructed with phase "task", Then its max_tokens is 1500 (the cap is lower than the phase default of 4000, so the cap wins).
  - Given no `limits:` section exists, When any agent is constructed, Then the model-type defaults apply.
- **REQ-CFG-7:** `get_max_tokens(model_type, phase)` SHALL apply per-phase default max_tokens, capped by the model-type limit from REQ-CFG-6. Phase defaults: `triage` 4096, `analysis` 2000, `synthesis` 2000, `consolidation` 8192, `task` 4000, `plan` 32768. The result is `min(phase_default, model_type_cap)`.
  - *Rationale:* Different phases have fundamentally different output requirements. Analysis needs a concise bullet list; consolidation needs a full requirements document. Per-phase defaults encode these expectations while the model-type cap prevents runaway output on constrained hardware.
  - Given model_type="local" and phase="analysis", When get_max_tokens is called, Then it returns min(2000, local_max_tokens_cap).
  - Given model_type="cloud" and phase="consolidation", When get_max_tokens is called, Then it returns min(8192, cloud_max_tokens_cap).

### 4.17 Skills System

- **REQ-SKL-1:** The framework SHALL maintain two distinct skill layers with separate purposes and storage locations:
  - **Global skills** (north star): `~/.voidrift/resources/skills/` — universal principles that orient agents across any project. Shipped with the framework, updated via `make sync`. Answer *what good looks like*, not *how to implement*. Apply to 80-90% of standard work across all project types. The framework ships with a `BACKEND-ENG` north-star skill covering Python/Click/FastMCP/pytest conventions used when building VoidRift itself.
  - **Domain skills**: installed globally at `~/.voidrift/domain-skills/` — specific knowledge for a technology, platform, or API. Reusable across projects. Installed via `voidrift skills install`.
  - **Project skills**: `<project>/.voidrift/skills/` — project-specific overrides. Take precedence over all other layers for this project only. Contain constraints, decisions, and patterns unique to this codebase that may deviate from or extend general domain guidance.
  - *Rationale:* North-star skills are timeless and universal — they keep agents oriented without prescribing implementation. Domain skills are reusable but specific to a technology. Project skills are the highest specificity — they capture what is true for this project that cannot be expressed in general guidance. Separating the layers prevents project-specific constraints from polluting the global domain layer and prevents domain noise from diluting north-star guidance.

- **REQ-SKL-2:** WHEN `get_skill(name)` is called, THE SYSTEM SHALL search in order: project skills (`<project>/.voidrift/skills/`) → global domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`). THE SYSTEM SHALL return the first match. A project skill with the same name as a domain or north-star skill SHALL fully replace it for that project — no merging occurs. IF no skill is found at any layer, THE SYSTEM SHALL return an empty result and log a warning.
  - *Rationale:* Project skills are intentional overrides. An operator who writes a project-level skill has specific reasons to deviate from global guidance — merging would undermine that intent and produce inconsistent guidance. The agent receives one skill per name, the most specific one wins.
  - Given a project skill `QUALITY-QA.md` exists in `<project>/.voidrift/skills/`, When `get_skill("QUALITY-QA")` is called, Then the project skill is returned and the global north-star `QUALITY-QA` is not loaded.
  - Given no project skill exists for `BACKEND-ENG` but a domain skill does, When `get_skill("BACKEND-ENG")` is called, Then the domain skill is returned.
  - Given no skill exists at any layer for `UNKNOWN`, When `get_skill("UNKNOWN")` is called, Then an empty result is returned and a warning is logged.

- **REQ-SKL-3:** `config.yml` SHALL support a `skills:` section with:
  - `repos` — ordered list of GitHub repo URLs to search for domain skills; earlier entries take precedence on name collision.
  - `synthesis_model` — model alias to use for skill synthesis; SHALL be a capable reasoning model with internet access.
  - *Rationale:* Multiple repos allow the operator to combine a private skills repo with community sources. Precedence order gives the operator control over which source wins on conflict. The synthesis model is separate from the phase model because skill synthesis is a one-time research task that benefits from a strong reasoning model.

- **REQ-SKL-4:** THE SYSTEM SHALL provide a `voidrift skills` subcommand group with the following commands: `search <query>`, `install <name>`, `list`, `remove <name>`, `review`, `approve <name>`.
  - `search <query>` — queries manifests from all configured repos and returns matching skills with source attribution. Does not download skill content.
  - `install <name>` — synthesizes and installs a domain skill (per REQ-SKL-5).
  - `list` — displays all available skills grouped by layer (north star, domain, project) with source.
  - `remove <name>` — removes a domain skill from `~/.voidrift/domain-skills/`.
  - `approve <name>` — promotes a pending skill from `~/.voidrift/domain-skills/pending/` to `~/.voidrift/domain-skills/`.
  - `review` — displays pending skills awaiting operator approval.

- **REQ-SKL-5:** WHEN `voidrift skills install <name>` is called, THE SYSTEM SHALL execute a synthesis pipeline: (1) query manifests from all configured repos for skills matching `<name>`, (2) fetch all matching source skill content, (3) invoke a synthesis agent using the configured `synthesis_model` with the `DOMAIN-SKILL-TEMPLATE.md` guidelines to produce a single domain skill in VoidRift skill format, (4) write the result to `~/.voidrift/domain-skills/pending/<NAME>.md`. THE SYSTEM SHALL NOT make the skill active until the operator approves it via `voidrift skills approve`.
  - *Rationale:* Raw content from community repos uses formats and philosophies inconsistent with VoidRift's skill structure. Synthesis produces a skill that matches VoidRift's format and strips implementation recipes in favor of north-star guidance for the domain. The pending step ensures the operator reviews synthesized content before it influences agent behavior.
  - Given `synthesis_model` is configured and repos are configured, When `voidrift skills install fastapi` is run, Then a synthesized `FASTAPI.md` is written to the pending directory and not yet active.
  - Given a pending skill exists, When `voidrift skills approve fastapi` is run, Then `FASTAPI.md` is moved to `~/.voidrift/domain-skills/` and becomes available to `get_skill()`.

- **REQ-SKL-6:** Each configured skills repo SHALL provide a `skills-manifest.yml` at its root listing available skills with at minimum: `name`, `description`, `tags`, and `file_path`. `voidrift skills search` SHALL query only the manifest — full skill content SHALL NOT be fetched until `install` is invoked.
  - *Rationale:* Fetching full skill content for every search would be slow and wasteful. The manifest is a lightweight index that enables discovery without downloading the full corpus.

- **REQ-SKL-7:** `resources/templates/` SHALL include a `DOMAIN-SKILL-TEMPLATE.md` that defines the required structure, format, and authoring philosophy for domain skills. The synthesis agent SHALL use this template as the output format guideline when synthesizing skills from external sources. The template SHALL specify: what to include (domain-specific north-star principles, key constraints, common failure modes), what to exclude (implementation recipes, version-specific syntax, content better suited to task context), and length/tone guidance.

- **REQ-SKL-8:** WHEN `voidrift skills list` is called, THE SYSTEM SHALL display all skills grouped by layer with their source location, indicating which are active and which are pending approval.
  - Given skills exist at all three layers, When `voidrift skills list` is run, Then output groups skills as: North Star, Domain (active), Domain (pending), Project.

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
| V-MCP-8 | REQ-MCP-11 | Test | `test_server_tools.py` — duplicate `write_source_file`/`write_framework_file` returns error, file unchanged |
| V-MCP-9 | REQ-MCP-16 | Test | `test_server_tools.py` — `list_prompts` returns sections per phase |
| V-RES-1 | REQ-RES-6 | Test | `test_phases.py` — format variable substitution in prompt templates |
| V-ARCH-1 | REQ-ARCH-2 | Test | `test_phases.py::TestCLICommands` — subcommands exist |
| V-ARCH-2 | REQ-ARCH-4 | Test | `test_agent.py` — agent loop sends/receives messages |
| V-ARCH-3 | REQ-ARCH-6 | Test | `test_agent.py::TestBuildMcpTools` — tools present, no direct reads |
| V-ARCH-4 | REQ-ARCH-8 | Test | `test_agent.py` — think tags stripped from response, logged as `[THINKING]` |
| V-ARCH-5 | REQ-ARCH-9 | Test | `test_agent.py::TestBuildMcpTools` — phase filtering returns correct tool subsets |
| V-G-1 | REQ-G-1 | Test | `test_phases.py::TestGatherPreflightChecks` |
| V-G-2 | REQ-G-11 | Test | `test_agent.py` — context length error detection |
| V-G-3 | REQ-G-12 | Inspection | `gather.py` — all gather agents use `stream=False` |
| V-P-1 | REQ-P-1 | Test | `test_phases.py::TestPlanPreflightChecks` — artifact production and retry |
| V-P-2 | REQ-P-3 | Test | `test_phases.py` — fresh-start deletes existing artifacts |
| V-SKL-1 | REQ-SKL-2 | Test | `test_server_tools.py` — project skill overrides domain; domain overrides north-star |
| V-SKL-2 | REQ-SKL-2 | Test | `test_server_tools.py` — missing skill returns empty result and logs warning |
| V-SKL-3 | REQ-SKL-5 | Inspection | `voidrift skills install` writes to pending, not active domain-skills |
| V-SKL-4 | REQ-SKL-8 | Test | `voidrift skills list` groups output by layer |
| V-P-3 | REQ-P-6 | Analysis | Code review of generated TASKS.md for file ownership |
| V-P-4 | REQ-P-9 | Test | `test_phases.py` — invalid skill tags stripped, valid tags preserved |
| V-P-5 | REQ-P-11 | Test | `test_phases.py` — update mode requires existing artifacts |
| V-D-1 | REQ-D-1 | Test | `test_phases.py::TestDevelopPreflightChecks::test_missing_tasks` |
| V-D-2 | REQ-D-2 | Test | `test_phases.py::TestDevelopPreflightChecks::test_all_tasks_complete` |
| V-D-3 | REQ-D-3 | Test | `test_phases.py::TestDevelopPreflightChecks::test_lock_file_stale` |
| V-D-4 | REQ-D-5 | Test | `test_phases.py` — no writes triggers retry, then escalation |
| V-D-5 | REQ-D-7 | Test | `test_phases.py` — max escalations blocks task and continues |
| V-D-5 | REQ-D-10 | Test | `test_phases.py::TestDevelopPreflightChecks::test_workers_without_modules` |
| V-D-6 | REQ-D-12 | Test | `test_phases.py` — workers without module headers falls back to single |
| V-D-7 | REQ-D-4 | Inspection | `develop.py::_develop_module` — task loop calls `get_next_task()`, prompt includes task text only (no pre-loaded system context or skills); agent loads arch, spec, and skills via tool calls |
| V-D-8 | REQ-D-6 | Inspection | `develop.py::_consult_architect` — escalation prompt via `get_prompt("develop", "ESCALATION")` |
| V-D-9 | REQ-D-8 | Inspection | `develop.py::_consult_architect` — provides reqs + arch + task, no source files |
| V-D-10 | REQ-D-9 | Test | `test_mcp.py` — `complete_task()` marks `[x]` and writes through to disk |
| V-D-11 | REQ-D-11 | Inspection | `develop.py::run_develop` — `threading.Lock` passed to all `_develop_module` calls, acquired around git ops |
| V-D-12 | REQ-D-13 | Inspection | `develop.py::run_develop` — SIGTERM/SIGINT set interrupted flag, lock cleaned in finally block |
| V-U-1 | REQ-U-1 | Test | `test_phases.py::TestCLICommands::test_status_command` |
| V-U-2 | REQ-U-2 | Test | `test_phases.py` — chat session loads skill, prompt, and --doc context |
| V-LOG-1 | REQ-LOG-4 | Test | `test_cli.py::test_system_log_created` — system log file exists after startup |
| V-ARCH-6 | REQ-ARCH-3 | Test | `test_cli.py::test_interactive_default_uses_active_model` — no hardcoded alias |
| V-MC-1 | REQ-MC-1 | Test | `test_models.py::TestWorkerModelDiscovery` — alias from worker-models.yml resolves without models.yml entry |
| V-MC-2 | REQ-MC-3 | Test | `test_models.py::TestMaxContext` — max_context from models.yml used when API returns no max_model_len |
| V-CFG-1 | REQ-CFG-6 | Test | `test_config.py` — get_max_tokens returns min(phase_default, model_cap); missing limits section uses defaults |
| V-CFG-2 | REQ-CFG-7 | Test | `test_config.py` — per-phase defaults: analysis=2000, task=4000, consolidation=8192 |
| V-G-4 | REQ-G-13 | Test | `test_phases.py` — local model large file chunked (not truncated); single chunk skips consolidation; cloud model not chunked |
| V-G-5 | REQ-G-14 | Inspection | `resources/prompts/gather.md` ANALYSIS section contains conciseness instruction |
| V-G-6 | REQ-G-15 | *(retired)* | Tool call output eliminated; JSON truncation no longer possible |
| V-G-7 | REQ-G-16 | *(retired)* | Superseded by REQ-G-8 direct response design |
| V-G-8 | REQ-G-8 | Test | `test_phases.py` — context build produces one summary per non-source category; source analysis injects context; final pass receives all requirements |
| V-G-9 | REQ-G-17 | Test | `test_phases.py` — context summary capped at 10 items; source agent user message contains "Project Context" section |
| V-ARCH-7 | REQ-ARCH-9 | Inspection | `agent.py` — develop per-task tool set excludes load_tasks/get_next_task/complete_task/get_task_status |
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
| V-WK-11 | REQ-WK-6b | Test | `test_worker.py::TestModelsRemove` — retires alias and deletes cached weights |
| V-WK-12 | REQ-WK-6c | Test | `test_worker.py::TestModelsCheck` — audits cache, downloads missing, reports unconfigured, prunes with --prune |
| V-WK-13 | REQ-WK-9 | Test | `test_worker.py::TestGateway` — kiro start/stop/status and credential validation |
| V-WK-14 | REQ-WK-12 | Test | `test_worker.py::TestWorkerInfo` — reports GPU/disk/memory via SSH |
| V-WK-15 | REQ-WK-13 | Test | `test_worker.py::TestImagesAdd`, `TestImagesRemove`, `TestImagesList` — image source CRUD |
| V-WK-16 | REQ-WK-14 | Test | `test_worker.py::TestCacheClear` — clears flashinfer and vllm caches over SSH |
| V-WK-17 | REQ-WK-17 | Test | `test_worker.py::TestCompletions` — bash/zsh/fish scripts generated, invalid shell rejected |

---

## Appendix A: Project Artifact Structure

```
.voidrift/
├── REQUIREMENTS.md           # Project requirements
├── ARCHITECTURE.md           # Architecture reference
├── STATE.md                  # Project state summary
├── TASKS.md                  # Task list (single file, module headers for multi-module)
├── arch/                     # Module architecture (produced by Plan)
│   └── <module>.md
├── spec/                     # Module requirements (produced by Gather)
│   └── <module>.md
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
| `qwen35` | `Qwen/Qwen3.5-35B-A3B-FP8` | Local |
| `qwen25` | `Qwen/Qwen2.5-VL-72B-Instruct-FP8` | Local |
| `qwen3-coder` | `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | Local |
| `claude` | `anthropic/claude-opus-4-6` | Cloud |
| `haiku` | `anthropic/claude-haiku-4-5` | Cloud |
| `gemini` | `gemini/gemini-2.5-pro` | Cloud |
| `gemini-flash` | `gemini/gemini-2.5-flash` | Cloud |
| `kiro-sonnet` | `claude-sonnet-4-5` | Kiro Gateway |
| `kiro-haiku` | `claude-haiku-4-5` | Kiro Gateway |
| `kiro-deepseek` | `deepseek-v3-2` | Kiro Gateway |
| `kiro-minimax` | `minimax-m2-1` | Kiro Gateway |
| `kiro-qwen` | `qwen3-coder-next` | Kiro Gateway |
