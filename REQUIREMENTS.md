# Requirements: VoidRift — The Agentic Software Engineering Framework

## 1. Introduction

- **Purpose:** An agentic software engineering framework composed of independent framework commands — Gather, Plan, Develop, Deploy, Verify, Chat — each of which reads and writes artifacts in a project's `.voidrift/` directory. AI agents reverse-engineer requirements from existing codebases, generate architecture and task breakdowns, implement code, produce infrastructure-as-code, and validate the result against acceptance criteria. They are not a pipeline: each command's input is a file and its output is a file. Operators run the commands they need, skip the ones they don't, and can provide hand-authored artifacts to any command that accepts them.
- **Project Scope:** VoidRift provides the CLI framework command layer and framework reference files. AI models are external (local vLLM containers, cloud APIs, or gateway endpoints). Worker node management is provided by the external `worker-cli` project. Hosting, CI/CD infrastructure, and runtime environments for generated projects are the operator's responsibility.

## 2. User Stories

- **As an** Operator, **I want to** run `voidrift gather <model> <path>` to reverse-engineer requirements from an existing codebase, **so that** I can onboard projects into the framework without writing requirements manually.
- **As an** Operator, **I want to** run `voidrift chat <model>` to interactively review and refine requirements, architecture, and tasks, **so that** I can iterate on framework artifacts through conversation.
- **As an** Operator, **I want to** run `voidrift plan` to generate architecture and task breakdowns, **so that** implementation work is pre-planned with atomic, ordered tasks.
- **As an** Operator, **I want to** run `voidrift develop` to have an AI execute tasks automatically, **so that** code is written, tested, and committed without manual intervention.
- **As an** Operator, **I want to** use concurrency configuration to process multiple modules in parallel, **so that** large projects complete faster.
- **As an** Operator, **I want to** use local models for bulk implementation and cloud models for escalation, **so that** I minimize API costs while maintaining quality on hard problems.
- **As an** Operator, **I want to** run `voidrift deploy` to generate infrastructure-as-code, **so that** my project is deployable without manual IaC authoring.
- **As an** Operator, **I want to** run `voidrift verify` to validate the implementation against requirements, **so that** I have confidence the project meets its acceptance criteria.
- **As a** model executing tasks, **I want to** receive one task at a time, **so that** my context window stays small and focused.
- **As a** model consulted during escalation, **I want to** receive only the problem description and architecture docs, **so that** I provide design guidance without implementation bias.

## 3. External Interfaces (IEEE 29148)

- **User Interfaces:** Terminal CLI (`voidrift` command). Interactive chat via `voidrift chat`. Progress indicators (spinners, elapsed time) for automated framework commands. Rich terminal output via the `rich` library.
- **Hardware Interfaces:** GPU worker node (NVIDIA GB10 or compatible) accessed via SSH for local model inference. Optional — cloud models require no hardware.
- **Software/API Interfaces:**
  - OpenAI-compatible chat completions API (local vLLM, Kiro Gateway)
  - Anthropic native API (Claude models)
  - Google Generative AI API (Gemini models)
- **Communication Protocols:** HTTPS (cloud APIs), HTTP (local vLLM API, Kiro Gateway)

## 4. Functional Requirements (EARS Notation)

*Use: WHEN [trigger], THE SYSTEM SHALL [result]*

### 4.1 System Architecture

- **REQ-ARCH-1:** The system SHALL consist of two components: a Python CLI (`cli/`) and framework reference files (`resources/`). Worker node management is provided by the external `worker-cli` project.
  - *Rationale:* Separating worker node management from command orchestration makes the CLI model-agnostic. Every model — local, cloud, or gateway — is just a base URL to the CLI.
- **REQ-ARCH-2:** The CLI SHALL provide subcommands: `gather`, `plan`, `develop`, `deploy`, `verify`, `chat`, `status`, `log`, `unlock`, `prune`, `completions`, `skills`. WHEN an unknown command is given, THE SYSTEM SHALL display the error and full help text (no tracebacks). No CLI command SHALL ever display a Python traceback to the user.
- **REQ-ARCH-3:** WHEN `voidrift` is run with no arguments, THE SYSTEM SHALL launch an interactive guided flow presenting available actions, model selection, and command-specific options. WHEN presenting the model selection prompt, THE SYSTEM SHALL default to the active local model alias (read from `~/.worker-cli/.active-container`) if one is running, or the first alias in the configured model list otherwise. No hardcoded model alias SHALL appear as a default in any user-facing prompt or interactive flow.
  - Given a local model with alias `qwen3-coder` is active (recorded in `.active-container`), When the interactive model prompt is shown, Then the default is `qwen3-coder`.
  - Given no local model is active, When the interactive model prompt is shown, Then the default is the first alias from the configured model list.
  - Given the configured model list is empty, When the interactive model prompt is shown, Then no default is set.
- **REQ-ARCH-4:** The CLI SHALL implement an agent loop that sends messages to model APIs (OpenAI-compatible for local/kiro, native for cloud), handles tool calls, and returns responses. The agent loop SHALL support a configurable `tool_choice` parameter with two modes: `"required"` (default) and `"auto"`. Automated commands (gather, plan, develop) SHALL use `tool_choice: "required"` — WHEN agent tools are provided, the agent SHALL set `tool_choice: "required"` on every call, and a `done` agent tool SHALL be included automatically. WHEN the model calls `done()`, the agent SHALL make one final call with no agent tools to get the text summary. Interactive commands (chat) SHALL use `tool_choice: "auto"` — agent tools are available but the model decides when to call them; no `done` agent tool is injected. Automated commands SHALL use non-streaming mode (`stream=False`) for reliable tool call parsing. Interactive commands (chat) SHALL use streaming mode for token-by-token display and interruptibility. The agent loop SHALL detect stalls: IF the model makes the same tool call (same name and arguments) on consecutive iterations, the agent SHALL inject a user message instructing the model to stop repeating and proceed to write output, resetting the stall signature. IF the model stalls again after 2 nudges, the agent SHALL force a final text-only call. The stalled call signature and nudge count SHALL be logged. WHILE waiting for any model response (initial or after tool calls), THE SYSTEM SHALL display a "Thinking..." spinner that clears when the response arrives. In the chat command, the spinner SHALL be rendered via a Rich `Live` block on stdout; in automated commands, the spinner SHALL use stderr. The agent loop SHALL log all interactions to the active command log file: system prompts, user messages, model responses, tool calls (name + arguments), and tool results.
  - *Rationale:* `tool_choice: "required"` ensures automated commands use agent tools rather than generating text about what they would do. `tool_choice: "auto"` is necessary for interactive chat — forcing tool calls on every conversational turn causes models to loop or emit malformed tool calls as text. Streaming in chat provides responsive UX and allows the operator to interrupt generation. Non-streaming in automated commands ensures reliable tool call parsing — vLLM's streaming parser does not reliably separate text from tool calls. Stall nudging preserves tool access so the model can deliver output — stripping tools on stall causes models to emit tool calls as text (XML/JSON) which are never executed. Comprehensive logging enables post-run debugging without reproducing the full agent session.
  - Given an agent with `tool_choice="required"` and tools, When the API is called, Then `tool_choice: "required"` and the `done` tool are included.
  - Given an agent with `tool_choice="auto"` and tools, When the API is called, Then `tool_choice: "auto"` is set and no `done` tool is injected.
  - Given a chat session, When the operator sends a message, Then the model may respond with text only or call tools as needed.
  - Given a model repeats the same tool call on consecutive iterations, When stall is detected, Then a nudge message is injected and tools remain available.
  - Given 2 nudges have been sent and the model stalls again, When the 3rd stall is detected, Then tools are stripped to only write tools (`write_source_file`, `write_framework_file`) and `done`, and a final call is forced.
- **REQ-ARCH-5:** The CLI SHALL be model-agnostic. It SHALL resolve model aliases to `(base_url, api_key, model_id)` tuples from a models config file and connect to the endpoint directly. It SHALL NOT manage containers, SSH connections, or gateway processes.
  - *Rationale:* The worker node already exposes an OpenAI-compatible endpoint. Cloud APIs expose endpoints. Kiro Gateway exposes an endpoint. The CLI treats all three identically — the only variable is the URL.
- **REQ-ARCH-6:** The CLI SHALL load all framework resource content (skills, templates, prompts) directly from disk at command init time. Skills required by a structured framework command SHALL be resolved via `find_skill()` and pre-injected into the system prompt — models receive skill content in context, not as callable agent tools. The `get_skill` callable tool SHALL remain available in the chat command only, where skill discovery is dynamic.
  - *Rationale:* Pre-injection eliminates per-turn tool call overhead and prevents skill content from accumulating in message history across turns. Chat retains on-demand skill access because the model cannot know in advance which skills it will need in a free-form conversation.
- **REQ-ARCH-7:** Multi-stage commands SHALL use separate agent instances per unit of work to prevent context accumulation. Each agent starts with a clean message history. Shared state between agents SHALL be passed as Python data (strings, dicts) by the command orchestrator — not through tool calls or message history.
  - *Rationale:* A single agent reading multiple files accumulates raw content in its message history until the context window fills. Separate agents per file keep each context small and focused — the same pattern used by the develop command (one agent per task). Passing state as Python data eliminates the ephemeral store entirely.
- **REQ-ARCH-8:** The agent loop SHALL strip `<think>...</think>` blocks (including content) from all model response text before returning it to the caller or appending it to message history. Stripped thinking content SHALL be logged to the command log file (prefixed `[THINKING]`) before removal. This is model-agnostic: models that do not emit thinking tokens are unaffected. WHEN streaming, the agent SHALL buffer tokens and filter think blocks in real-time — thinking content SHALL NOT be displayed to the terminal. The agent SHALL also handle orphaned `</think>` tags (closing tag without opening `<think>`): all content before the orphaned `</think>` SHALL be treated as thinking content, logged, and suppressed. WHEN streaming and the response begins with thinking content (no opening `<think>` tag), the agent SHALL buffer up to 200 characters; IF `</think>` arrives within that buffer, the content is discarded as thinking. IF 200 characters accumulate without `</think>`, the buffer SHALL be flushed as real content.
  - *Rationale:* Some models emit chain-of-thought reasoning wrapped in `<think>` tags. This internal reasoning is valuable for debugging (logged) but should not leak into user-facing output or pollute message history for subsequent turns. Models frequently omit the opening `<think>` tag, emitting only `</think>` to close their reasoning — the orphaned tag handler catches this. The 200-character streaming buffer balances latency (short buffer) against reliable detection (enough text to see `</think>`).
  - Given a model response containing `<think>reasoning</think>Hello`, When the agent processes the response, Then the returned text is `Hello` and the log contains `[THINKING] reasoning`.
  - Given a model response containing no `<think>` tags, When the agent processes the response, Then the text is returned unchanged and no `[THINKING]` entry is logged.
  - Given a streaming response starting with `reasoning</think>Hello`, When tokens arrive, Then `reasoning` is buffered and logged as `[THINKING]`, and only `Hello` is displayed.
  - Given a streaming response with no think tags, When 200 characters accumulate without `</think>`, Then the buffer is flushed to the terminal as real content.
- **REQ-ARCH-10:** The agent loop SHALL retry API calls that fail due to transient errors using exponential backoff. Retryable errors: connection errors, HTTP 5xx responses, rate limit responses (HTTP 429). Non-retryable errors: HTTP 4xx (except 429), authentication errors, and context length errors. The retry policy SHALL use a base delay of 1 second, multiplier of 2, maximum delay of 30 seconds, and a maximum of 3 attempts. Each retry attempt SHALL be logged to the command log. WHEN all retry attempts are exhausted, the agent SHALL raise the original exception to the caller.
  - *Rationale:* Transient network errors and rate limits are common against cloud APIs and local vLLM. Without retry logic, a single dropped packet or momentary rate limit terminates a command run that may have taken minutes of work to reach. Exponential backoff avoids thundering-herd against rate-limited endpoints.
  - Given a connection error occurs on attempt 1, When the agent retries with backoff, Then up to 3 attempts are made and each retry is logged.
  - Given an HTTP 429 response is returned, When the agent retries, Then it waits before retrying and logs the rate limit event.
  - Given an HTTP 401 response is returned, When the agent encounters the error, Then no retry is attempted and the error is raised immediately.
  - Given a context length error occurs, When the agent encounters the error, Then no retry is attempted and the error is raised immediately.
  - Given all 3 retry attempts fail, When exhausted, Then the original exception is raised.
- **REQ-ARCH-11:** The agent loop SHALL detect output truncation by checking `finish_reason == "length"` on every API response. WHEN a text-only response (no tool calls) is truncated, the agent SHALL inject a continuation user message (loaded from `resources/prompts/system.md` section `MAX-TOKENS-RESUME`) and retry, concatenating the partial text with the continuation. Up to 2 continuation attempts SHALL be made. Each continuation SHALL be logged as `[MAX_TOKENS_RECOVERY]` with the attempt number. WHEN tool calls are present in a truncated response, the agent SHALL log a warning (`[MAX_TOKENS_TOOL_TRUNCATION]`) but process the tool calls normally — tool call JSON may be incomplete and will fail at parse time, which is the existing error path. WHEN 2 continuation attempts are exhausted, the agent SHALL return the concatenated partial text and log `[MAX_TOKENS_EXHAUSTED]`.
  - *Rationale:* Truncated architecture docs cascade into bad task breakdowns cascade into bad develop output. Recovery via continuation preserves the full response without requiring the operator to manually increase `max_tokens` or switch models. Tool call truncation is rare (tool JSON is small) and already handled by the JSON parse error path.
  - Given a text response with `finish_reason: "length"`, When the agent detects truncation, Then a continuation message is injected and the agent retries.
  - Given 2 continuation attempts have been made and the response is still truncated, When the 3rd truncation is detected, Then the concatenated partial text is returned and `[MAX_TOKENS_EXHAUSTED]` is logged.
  - Given a response with tool calls and `finish_reason: "length"`, When the agent detects truncation, Then `[MAX_TOKENS_TOOL_TRUNCATION]` is logged and tool calls are processed normally.
- **REQ-ARCH-9:** `build_local_tools()` SHALL accept an optional `cmd` parameter. WHEN a command name is specified, THE SYSTEM SHALL return only the agent tools relevant to that command. WHEN cmd is empty or omitted, all agent tools SHALL be returned. Each framework command SHALL pass its name as the `cmd` parameter: `gather`, `plan`, `develop`, `chat`. Agent tools SHALL enforce domain separation by name: `write_source_file` and `read_source_file` operate on the project source tree, `write_framework_file` and `read_framework_file` operate on `.voidrift/` artifacts. Per-command agent tool sets:
  - **Gather:** `read_source_file`, `write_framework_file`, `read_framework_file`. No analysis store agent tools — gather state is passed as Python data between agents by the orchestrator.
  - **Plan:** `read_framework_file`, `write_framework_file`. No skill agent tools — skills pre-injected at command init.
  - **Develop (per-task agent):** `read_source_file`, `write_source_file`, `read_framework_file`. No skill agent tools — pre-injected per-task. No task orchestration agent tools — called directly by framework Python code.
  - **Chat:** `read_source_file`, `write_source_file`, `read_framework_file`, `write_framework_file`, `list_project_artifacts`, `get_skill`, `list_skills`, `web_fetch`.
  - *Rationale:* Models waste context and iterations calling agent tools irrelevant to their command. Restricting the visible agent tool set keeps the model focused and prevents cross-command agent tool misuse. Separating source and framework filesystem agent tools by name makes the domain boundary structural — no runtime guards needed. Removing dead analysis-store agent tools from gather recovers ~1000 tokens of schema context per gather agent.
  - Given cmd="plan", When `build_local_tools()` is called, Then `write_framework_file` and `read_framework_file` are included but `write_source_file` and `read_source_file` are not.
  - Given cmd="develop", When `build_local_tools()` is called, Then `write_source_file`, `read_source_file`, and `read_framework_file` are included but `write_framework_file` is not.
  - Given cmd="gather", When `build_local_tools()` is called, Then `read_source_file`, `write_framework_file`, and `read_framework_file` are included but `write_source_file` is not.
  - Given cmd="", When `build_local_tools()` is called, Then all tools are returned.

### 4.2 CLI-Native Context Management

- **REQ-CTX-1:** `cli/src/voidrift_cli/skills.py` SHALL provide `find_skill(name, project_dir)` implementing 3-layer resolution: project (`.voidrift/skills/`) → domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`). First match wins, returning the file content as a string. Missing skill returns `None`. YAML frontmatter SHALL be stripped from returned content.
  - *Rationale:* Three-layer resolution lets project-specific skills override domain knowledge without polluting global state. The caller receives content directly — no tool call round-trip, no message history accumulation.
  - Given a project skill `QUALITY-QA.md` exists in `.voidrift/skills/`, When `find_skill("QUALITY-QA", project_dir)` is called, Then the project skill content is returned and the north-star version is not read.
  - Given no project skill exists for `BACKEND-ENG` but a north-star one does, When `find_skill("BACKEND-ENG", project_dir)` is called, Then the north-star content is returned.
  - Given no skill exists at any layer for `UNKNOWN`, When `find_skill("UNKNOWN", project_dir)` is called, Then `None` is returned.
- **REQ-CTX-2:** WHEN a structured framework command (gather, plan, develop) runs, THE SYSTEM SHALL resolve required skills via `find_skill()` and pre-inject their content into the system prompt. Skills SHALL appear in the system prompt before any task instructions. Skills referenced in task tags SHALL be resolved and injected into the per-task system prompt at task-init time. IF a referenced skill does not exist, THE SYSTEM SHALL log a warning and continue.
  - *Rationale:* Pre-injection delivers skill content at turn 0 with no tool call overhead. Content is paid for once per agent, not accumulated across turns as tool results.
- **REQ-CTX-3:** *(Replaced by REQ-TM-1 through REQ-TM-7. Task management moved from TaskStore/TASKS.md to ManifestManager + individual task files.)*
- **REQ-CTX-4:** ALL command runs SHALL be scoped to a run ID. The run ID SHALL be the log filename stem (e.g. `gather-20260318-101048`). The log file serves as the run's canonical record.
- **REQ-CTX-5:** WHEN a gather command run completes file analysis for a source file, THE SYSTEM SHALL write the result to `.voidrift/analysis/<filepath>.md` with YAML frontmatter containing `file`, `hash` (SHA-256 content hash), and `timestamp`. On subsequent gather runs, THE SYSTEM SHALL read the analysis file by path and compare the frontmatter `hash` against the current file's content hash. If they match, the cached analysis is used and model inference is skipped.
  - *Rationale:* Large codebases have many stable files unchanged between gather runs. Caching skips expensive model calls for those files, making iterative gather on large projects practical. Storing the cache as frontmatter in the analysis file eliminates a separate cache layer — one file serves both as readable artifact and cache entry.
  - Given `src/utils.py` was analyzed in a prior run and its content is unchanged, When gather runs again, Then the cached analysis is used and no model call is made for that file.
  - Given `src/utils.py` has been modified since the last run, When gather runs, Then the cache entry is ignored and the file is re-analyzed.
- **REQ-CTX-6:** Framework resource content (loaded skills, loaded prompts) SHALL be cached in process memory for the duration of a command run. Repeated access to the same resource within a run SHALL NOT re-read the file from disk.
  - *Rationale:* Prompts and skills are read-only during a run. Memory caching avoids redundant disk reads when multiple agents or stages use the same resource.

### 4.3 Framework Reference Files

- **REQ-RES-1:** Each command prompt file (`resources/prompts/<command>.md`) SHALL contain stage-specific instructions as H2 sections. The shared methodology for a command SHALL be a skill file (e.g. ANALYSIS-REQS for gather) loaded once and prepended to every stage prompt.
- **REQ-RES-2:** Global (north-star) skill files SHALL live in `resources/skills/` with uppercase filenames and serve as universal orientation guidance — they answer *what good looks like*, not *how to implement*. Available skills SHALL be determined dynamically from the directory contents. Domain and project skills follow the same filename convention but live in their respective layer directories (per REQ-SKL-1).
- **REQ-RES-3:** WHILE the plan command is active, required skill files SHALL be resolved via `find_skill()` and pre-injected into the system prompt at command init (per REQ-ARCH-6, REQ-CTX-2).
- **REQ-RES-4:** WHILE the develop command is active, skill files SHALL be resolved via `find_skill()` and pre-injected into the per-task system prompt based on `[tag, ...]` annotations at task-init time (per REQ-ARCH-6, REQ-CTX-2).
- **REQ-RES-5:** IF a skill file referenced in a task tag does not exist, THE SYSTEM SHALL print a warning and continue without loading it.
- **REQ-RES-6:** Command prompt files SHALL live in `resources/prompts/<command>.md` with H2 sections for each stage/step. The CLI SHALL load prompts directly from disk at command init, indexed by H2 heading. ALL text sent to a model — system prompts, user messages, retry messages, nudge messages — SHALL be loaded from resource files. The CLI SHALL NOT contain hardcoded prompt strings. Prompts MAY contain Python format variables (e.g. `{spec_path}`, `{group_name}`) which the CLI resolves via `.format()` before passing to the agent. A missing variable SHALL raise a `KeyError` — no silent substitution.
  - Given a prompt containing `{group_name}`, When the CLI calls `.format(group_name="backend")`, Then `{group_name}` is replaced with `backend`.
  - Given a prompt containing `{missing_var}`, When the CLI calls `.format(group_name="backend")`, Then a `KeyError` is raised for `missing_var`.
- **REQ-RES-7:** The CLI SHALL construct each agent's system prompt by concatenating four layers: (1) the shared framework context (`get_prompt("system", "CONTEXT")`) — command inventory and artifact ownership boundaries, loaded once per process; (2) the command's methodology skill (loaded once via `get_skill()`) — how to think; (3) the stage-specific prompt (`get_prompt("<command>", "<stage>")`) — what to do for this invocation; (4) any injected context (analyses, specs, task details) — what to work with. The system context and skill are loaded once per command run and reused across all agent invocations in that run. `resources/prompts/system.md` contains the shared framework context. Command prompt files (`resources/prompts/<command>.md`) contain only command-specific instructions — they SHALL NOT duplicate the framework context from `system.md`.
  - *Rationale:* `system.md` ensures every agent — regardless of command — understands the artifact table, command boundaries, and what it must not do. Without it, each command prompt would need to embed this context, creating duplication and drift. The four layers have distinct responsibilities: **system context** establishes *where in the framework this agent operates*, the **skill** defines *how to think*, the **prompt** defines *what to do*, and the **injected context** provides *what to work with*. Each layer is independently editable without touching the others. This replaced the former per-role agent files (ANALYST.md, ARCHITECT.md, DEVELOPER.md) — a single command can have multiple agent invocations, each shaped by its specific prompt rather than a static role assignment.
  - Given any framework command runs, When an agent is invoked, Then the system prompt opens with the `system/CONTEXT` section before command-specific content.
  - Given `system.md` is updated, When the next command runs, Then all agents across all framework commands see the updated framework context without changes to command prompt files.

### 4.4 Command: Gather

- **REQ-G-1:** `voidrift gather` SHALL require one of two modes: `--path <path>` (reverse-engineer requirements from a codebase) or `--idea <id>` (generate requirements from a refined idea). WHEN neither is provided, THE SYSTEM SHALL exit with a help message listing both options. WHEN `--path` is specified, THE SYSTEM SHALL validate that `<path>` exists and is a directory before performing any model calls. IF `<path>` does not exist or is not a directory, THE SYSTEM SHALL exit with a clear error. The `--path` mode reverse-engineers requirements from the codebase using the four-stage pipeline (REQ-G-8). WHEN `--idea <id>` is specified, THE SYSTEM SHALL read the idea file, use the ANALYSIS-REQS skill and REQUIREMENTS-TEMPLATE to generate or update requirements in REQUIREMENTS.md, and record the affected requirement IDs (`reqs:` field) in the idea file along with a diff of the changes. WHEN `.voidrift/REQUIREMENTS.md` already exists AND `--overwrite` is not specified, both modes SHALL run in update mode: the existing REQUIREMENTS.md is provided as context to produce a merged, updated version. `--overwrite` removes files from the previous gather run (per STATE.md manifest) before starting a fresh analysis.
  - *Rationale:* Codebases evolve. Re-running gather after adding source files should refine existing requirements, not replace them wholesale. The `--idea` mode ensures requirements generated from ideas follow the same format and quality standards as requirements generated from code — the ANALYSIS-REQS skill and template enforce EARS notation, rationale, and BDD acceptance criteria. Recording affected REQ IDs in the idea file creates traceability from idea to requirements to tasks.
  - Given `voidrift gather model` is run with no flags, Then the command exits with a help message listing `--path` and `--idea` options.
  - Given `--path ./nonexistent`, When gather runs, Then the command exits with an error identifying the invalid path — no model call is made.
  - Given `--idea 3` and IDEA-3.md exists, When gather completes, Then REQUIREMENTS.md is updated and IDEA-3.md contains `reqs: [REQ-XX, ...]` and a diff of the changes.
  - Given `--idea 99` and IDEA-99.md does not exist, When gather runs, Then the command exits with an error.
  - Given no `.voidrift/REQUIREMENTS.md` exists and `--path ./src`, When gather completes, Then `.voidrift/REQUIREMENTS.md` exists with content.
  - Given `.voidrift/REQUIREMENTS.md` exists and `--overwrite` is not specified, When gather runs in either mode, Then the final pass prompt includes the existing REQUIREMENTS.md as context and the output merges old and new.
- **REQ-G-8:** THE SYSTEM SHALL reverse-engineer requirements in four stages, each using separate agent instances (per REQ-ARCH-7). Source code is the primary requirements source — non-source files (tests, config, infrastructure, documentation, assets) are treated as context that informs source analysis. All agent outputs are returned as direct response text; the CLI captures responses and handles all persistence in memory and on filesystem. No stage uses tool calls for output. All stage instructions SHALL live in `resources/prompts/gather.md`.
  - *Rationale:* Source code is the ground truth of what the system does. Tests reveal behavioral contracts, docs reveal intent, config reveals constraints — but only source defines what the system actually implements. Treating non-source as context ensures requirements are grounded in implementation, not documentation aspirations. Direct response output eliminates tool call JSON overhead: for the same `max_tokens` budget, direct text provides ~15-20% more usable content with no risk of mid-JSON truncation. The CLI owning persistence keeps each agent context minimal — agents process one message and return one response, never accumulating state.
  1. **Triage:** Agent receives the complete file tree and returns a JSON object with files sorted into predefined categories — `source` (application code), `tests` (test files), `config` (build/project configuration), `infrastructure` (deployment, CI/CD, IaC), `documentation` (READMEs, ADRs, guides), `assets` (static resources, migrations, seeds). All categories are flat file lists. The file tree SHALL respect `.gitignore`: IF a `.gitignore` file exists in the target directory, the CLI SHALL exclude all paths matched by its patterns. Dot-prefixed files and directories (e.g. `.git/`, `.env`, `.voidrift/`) SHALL always be excluded regardless of `.gitignore`. The agent infers category membership from its knowledge of the project's language and toolchain; the CLI SHALL NOT hardcode language-specific rules. A second validation pass SHALL review the triage output and remove any files that were incorrectly included (e.g. build output, lock files, binary assets).
  2. **Context Build:** One agent per non-source category (tests, config, infrastructure, documentation, assets). The CLI reads all files in the category and passes their contents in the user message. Each agent returns a concise context summary as direct response text — behavioral contracts from tests, design intent from docs, deployment constraints from infrastructure, toolchain constraints from config, data requirements from assets. The CLI stores each summary in memory and writes `.voidrift/analysis/context-<category>.md`. Context summaries SHALL be concise per REQ-G-17.
  3. **Source Analysis:** One agent per source file, run concurrently. Each agent receives the full context summary (all categories concatenated) in its user message alongside the instruction to analyze the file. The only tool available is `read_source_file()` (to read the file content). The agent returns requirements-focused analysis as direct response text — what the file implements, expressed as EARS requirements. The CLI stores each response in memory and writes `.voidrift/analysis/<filepath>.md`. Large source files SHALL be chunked per REQ-G-13. Previously-cached analyses SHALL be used for files whose content hash matches a `.voidrift/cache/analyses/` entry (per REQ-CTX-5).
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
- **REQ-G-12:** All gather agents SHALL use streaming mode (`stream=True`) with usage capture for live token telemetry. Source analysis agents use `read_source_file()` tool calls; all other stages return direct response text. Think-tag stripping (REQ-ARCH-8) handles `<think>` blocks in streamed responses.
  - *Rationale:* Streaming enables per-call token telemetry (prompt tokens, completion tokens, context %) across all gather stages, driving the spinner stats display (REQ-UI-10). Think-tag stripping resolves the original concern about formatting in streamed responses.
- **REQ-G-13:** WHEN a source file's character count exceeds the model's `max_input_chars` limit, THE SYSTEM SHALL split the file into overlapping chunks of that size (200-character overlap) and analyze each chunk with a separate agent. IF the file produces more than one chunk, THE SYSTEM SHALL run a consolidation agent to merge the partial analyses into a single unified analysis before storing. IF chunking is triggered, the fact and chunk count SHALL be logged.
  - *Rationale:* Truncation loses the portion of the file beyond the limit. Chunking ensures every line is analyzed, at the cost of additional API calls per large file.
  - Given a model with `max_input_chars: 8000` and a source file of 20,000 characters, When source analysis runs, Then the file is split into chunks and each chunk is analyzed separately.
  - Given a model with `max_input_chars: 0` (unlimited), When source analysis runs on a 20,000 character file, Then no chunking occurs and the full file is passed in one agent call.
- **REQ-G-14:** The gather ANALYSIS prompt SHALL include an explicit conciseness instruction: bullet points only, maximum 15 items per analysis. The instruction SHALL appear after the analysis lens.
  - *Rationale:* Without an explicit output constraint, models produce exhaustive analyses that exceed token budgets for local models. Bullet-point format and an item cap force proportionate output without sacrificing signal.
  - Given an analysis agent prompt is constructed, When reviewed, Then it contains a conciseness instruction specifying bullet points and a maximum item count.
- **REQ-G-15:** *(Retired — tool call output eliminated from gather pipeline. JSON truncation errors are no longer possible. `_is_truncated_json_error` retained as a utility.)*

- **REQ-G-16:** *(Retired — superseded by REQ-G-8 Stage 4 direct response design.)*

- **REQ-G-17:** Context summaries produced in Stage 2 SHALL be concise: bullet points only, maximum 10 items per category. The CLI SHALL inject all category summaries concatenated as a single "Project Context" block into each source analysis agent's user message.
  - *Rationale:* Context summaries are injected into every concurrent source analysis agent. Unbounded summaries would multiply context cost across all source files. 10 items per category caps total injected context at ~300 tokens regardless of how many non-source files exist.
  - Given 12 documentation files, When context build runs, Then the documentation summary contains no more than 10 bullet points.
  - Given 3 non-source categories with files, When source analysis runs, Then each source agent's user message contains a "Project Context" section with summaries from all 3 categories.

### 4.5 Command: Plan

- **REQ-P-1:** Plan SHALL execute in five stages, each using one or more scoped agent instances. Each stage's required artifact(s) SHALL be verified before the next stage begins. IF a stage's required artifact is missing after one retry, THE SYSTEM SHALL exit with code 1 and no subsequent stages SHALL run. Each stage agent starts with a clean message history. All stage instructions SHALL live in `resources/prompts/plan.md` as H2 sections. The CLI builds `tasks/manifest.yml` from the completed task files after Stage 5.
  - **Stage 1 — Architecture** (`PLAN-ARCH`, one agent): receives REQUIREMENTS.md and specs. Produces `ARCHITECTURE.md` only. ARCHITECTURE.md SHALL contain system-level context only: introduction, constraints, context diagram, module inventory, cross-module API contracts, and cross-cutting concerns. Verified before Stage 2.
  - **Stage 2 — Module arch** (`PLAN-MODULE`, one agent per module): receives `ARCHITECTURE.md` and the module name. Produces `arch/<module>.md` for that module. Module arch files SHALL contain module-specific design detail (component internals, data models, internal interfaces, error handling patterns, and cross-module interfaces this module exposes or consumes). Module arch files SHALL be concise — interfaces and data models as signatures only, no inline code examples longer than 5 lines. Each module agent is dispatched and verified independently before Stage 3.
  - **Stage 3 — Task outline** (`PLAN-OUTLINE`, one agent per module): receives `ARCHITECTURE.md` and `arch/<module>.md` for that module only. Produces a lightweight task outline for that module written to `tasks/outline/<module>.md` (per REQ-P-14). Intra-module `depends:` only — no cross-module dependency knowledge at this stage.
  - **Stage 4 — Dependency resolution** (`PLAN-DEPS`, one agent): receives all `tasks/outline/<module>.md` files. Resolves cross-module `depends:` and writes the resolved dependency map to `tasks/outline/deps.yml`. Skipped for single-module projects — deps.yml is not written.
  - **Stage 5 — Task files** (`PLAN-TASK`, one agent per task): receives the task's outline entry, `arch/<module>.md` for that task's module, and the valid skill list injected fresh (per REQ-P-15). Produces `tasks/active/TASK-N.md`. Module filenames in `arch/` SHALL match module names in task frontmatter (lowercased, spaces to hyphens).
  - *Rationale:* A single agent writing all architecture and task artifacts loses coherence over long generations — constraints stated early in the prompt (skill list, module boundaries) are not attended to by the time the model is generating task 5+. Scoped agents with verified milestones keep each generation short, focused, and independently recoverable. Skills injected per-task agent ensure the constraint is fresh at the exact moment the model writes task frontmatter.
  - Given REQUIREMENTS.md exists, When `voidrift plan <model>` completes for a multi-module project, Then ARCHITECTURE.md, `arch/<module>.md` for each module, and task files exist in `.voidrift/`.
  - Given Stage 1 produces ARCHITECTURE.md, When Stage 2 begins, Then each module arch agent receives only ARCHITECTURE.md and its module name — not other modules' arch files.
  - Given Stage 1 fails to produce ARCHITECTURE.md after one retry, When the failure is detected, Then the command exits with code 1 and no further stages run.
  - Given Stage 3 completes all module outlines, When Stage 4 begins for a multi-module project, Then the dependency agent reads all outline files and writes deps.yml before any task file agents are dispatched.
  - Given a Stage 5 task agent is dispatched, When its system prompt is constructed, Then it contains the task outline and module arch before the valid skill list.
  - Given ARCHITECTURE.md is produced, When reviewed, Then it contains system-level context only and no module-internal component design.

- **REQ-P-14:** Task outline files (`tasks/outline/<module>.md`) SHALL use YAML frontmatter with `module` and a `tasks:` list. Each task entry SHALL contain: `id` (integer), `title` (string), `files` (list of relative paths with create/modify annotation), and `depends` (list of integer task IDs within the same module only). The outline body below the frontmatter SHALL contain a brief (1-3 sentence) description per task of what it builds — no implementation detail, no acceptance criteria, no code examples. Outline files are intermediate artifacts consumed by Stage 4 and Stage 5 — they are not user-facing and SHALL be removed after `tasks/manifest.yml` is built.
  - *Rationale:* Separating the outline pass from the full task file pass keeps Stage 3 agents fast and scoped. Stage 5 agents receive a bounded brief to expand rather than generating structure and content simultaneously, which reduces drift in long generations.
  - Given a three-module project, When Stage 3 completes, Then three outline files exist in `tasks/outline/` — one per module.
  - Given a task outline entry, When a Stage 5 agent produces the task file, Then the task file contains the full implementation brief expanded from the outline entry.

- **REQ-P-15:** WHEN a Stage 5 task file agent is dispatched, THE SYSTEM SHALL inject the valid skill list (name + description per REQ-P-9 format) directly into that agent's system prompt. The skill list SHALL appear after the task outline and module arch context — task-specific content takes priority in the prompt. The skill list SHALL NOT be loaded globally at plan command init for Stage 5 use — it SHALL be resolved and injected at per-agent dispatch time.
  - *Rationale:* Front-loading the skill list into a monolithic prompt places it thousands of tokens from the model's current generation position by task 5+. Per-agent injection ensures the skill constraint is at position 0 of context for every task file agent, eliminating the attention decay that causes local models to invent skill names.
  - Given a Stage 5 agent is dispatched for any task, When its system prompt is examined, Then the valid skill list appears after the task outline entry.
  - Given the plan command runs, When Stage 5 agents are dispatched, Then each agent's skill list is resolved at dispatch time from the current skill directories — not from a value computed at command start.
- **REQ-P-2:** Planner output SHALL be fully hidden from the terminal. Only a spinner and status line SHALL be shown.
- **REQ-P-3:** WHEN `--overwrite` is specified, THE SYSTEM SHALL remove all plan-produced directories (`tasks/`, `arch/`) and `ARCHITECTURE.md` before planning. Gather-produced artifacts (REQUIREMENTS.md, analysis/) SHALL be preserved.
  - Given a previous plan created ARCHITECTURE.md and populated arch/ and tasks/, When `voidrift plan <model> --overwrite` is run, Then ARCHITECTURE.md is deleted and the arch/ and tasks/ directories are removed entirely before the planning agent starts.
- **REQ-P-4:** `auto-commits: false` SHALL be set for the plan command.
- **REQ-P-5:** *(Replaced by REQ-TM-4. Tasks are individual files in `tasks/active/TASK-{id}.md` with YAML frontmatter. TASKS.md is an intermediate artifact parsed by the CLI into task files.)*
- **REQ-P-6:** In multi-module projects, each file path SHALL appear in exactly one module's task group. No file SHALL be created or modified by tasks in more than one module.
- **REQ-P-7:** Each task SHALL be a multi-line block: `- [ ] <summary>` on the first line, followed by indented metadata lines (`file:`, `skills:`, `reqs:`), followed by a free-form description. The `file:` line specifies the target file path relative to the project root; tasks without a target file omit this line. The description SHALL include enough context for a developer agent to implement without cross-referencing requirements — acceptance criteria, expected inputs/outputs, error cases, and the *why* behind the task. Tasks that say only "implement X" without specifying behavior are insufficient. The task format SHALL be defined in `resources/templates/TASK-FORMAT.md` and loaded via `get_template("TASK-FORMAT")`.
  - *Rationale:* The developer agent processes one task at a time with limited context. Front-loading implementation detail and rationale into the task description reduces the developer's dependence on loading full requirements, decreasing context window usage and improving output quality. Structured metadata on dedicated lines eliminates false matches from code examples or JSON in descriptions.
  - Given a task for creating an API endpoint, When the planner writes the task, Then the task includes the route, method, request/response shape, error cases, and the user story it satisfies.
  - Given a task for creating a UI component, When the planner writes the task, Then the task includes props, behavior, accessibility requirements, and which requirement it addresses.
  - Given a task creates test files, When the planner writes the task description, Then the description identifies the AC identifier(s) the tests must validate (e.g. "validates AC-ARCH-4 and AC-ARCH-8").
- **REQ-P-8:** Tasks SHALL NOT contain shell commands. Tasks describe file content only.
- **REQ-P-9:** WHEN the architect writes task files, THE SYSTEM SHALL parse all skill tags (`skills:` frontmatter) and validate them against available skill files. IF invalid tags are found, THE SYSTEM SHALL attempt to resolve each by word-overlap scoring: split the invalid name and each valid skill name on hyphens, count shared words, and substitute the valid skill with the most overlap (any overlap qualifies); IF no valid skill shares any word, THE SYSTEM SHALL strip the tag. Substitutions SHALL be logged at info level; strips SHALL be logged as warnings. The plan prompt SHALL list valid skills in `- NAME: description` format so the model can select by semantic match rather than name pattern.
  - *Rationale:* Descriptions give local models enough signal to select correctly rather than pattern-matching on names alone. Resolution before strip recovers skill context that would otherwise be silently lost — a task running with no skill context is worse than one running with an approximate match.
  - Given the plan prompt is constructed, When the system prompt is formatted, Then it contains each valid skill as `- NAME: description`.
  - Given a task contains `skills: [BACKEND-ENGINEERING]` and `BACKEND-ENG` is valid (shared word: BACKEND), When validation runs, Then `BACKEND-ENGINEERING` is replaced with `BACKEND-ENG` and an info message is logged.
  - Given a task file contains `skills: [WEB-ENG, documentation]` and `documentation` shares no words with any valid skill, When validation runs, Then `documentation` is stripped and a warning is logged.
- **REQ-P-10:** `.voidrift/ARCHITECTURE.md` SHALL follow the structure defined in `ARCHITECTURE-TEMPLATE` (loaded via `get_template("ARCHITECTURE-TEMPLATE")`). The template follows the arc42 documentation standard with C4 model diagrams (Mermaid). The model SHALL populate each section with project-specific content.
  - *Rationale:* arc42 is an industry-standard architecture documentation framework providing a proven section structure. C4 (Context, Container, Component, Code) provides consistent diagram levels. Together they ensure architecture documents are complete, navigable, and familiar to engineers.
- **REQ-P-11:** WHEN `voidrift plan <model>` is run AND `.voidrift/ARCHITECTURE.md` and `.voidrift/tasks/manifest.yml` already exist AND `--overwrite` is not specified, THE SYSTEM SHALL run in update mode. Update mode adds a pre-pipeline delta analysis stage: a single agent receives REQUIREMENTS.md, ARCHITECTURE.md, and a file listing of the project source tree (filenames only, not content), and returns a structured delta summary identifying which requirements appear satisfied by existing files and which have no corresponding implementation. The delta summary is injected as context into Stage 1 (architecture) and Stage 3 (task outlines) so the pipeline focuses on unimplemented work. The five-stage pipeline then runs normally — architecture is updated in place, and task outlines reflect the delta. WHEN `--overwrite` is specified, THE SYSTEM SHALL remove all plan-produced directories (`tasks/`, `arch/`) and `ARCHITECTURE.md` before starting the pipeline with no delta analysis. WHEN no plan artifacts exist, THE SYSTEM SHALL run the full pipeline without delta analysis (fresh plan).
  - *Rationale:* Re-running plan after partial implementation should produce tasks for remaining work, not re-plan everything. The delta agent uses filenames (not content) to keep context small — file existence and naming is a strong signal of implementation status. The existing 5-stage pipeline is unchanged; delta context is additive.
  - Given ARCHITECTURE.md and manifest.yml exist and `--overwrite` is not specified, When `voidrift plan <model>` is run, Then a delta analysis runs before the pipeline and its summary is injected into Stage 1 and Stage 3.
  - Given ARCHITECTURE.md and manifest.yml do not exist, When `voidrift plan <model>` is run, Then the full five-stage pipeline runs without delta analysis (fresh plan).
  - Given `--overwrite` is specified, When `voidrift plan <model>` is run, Then existing plan artifacts are removed and the pipeline runs without delta analysis.
  - Given a project with `src/api.py` and `src/models.py` already implemented, When the delta agent analyzes, Then the summary identifies requirements covered by those files and requirements with no corresponding source files.
- **REQ-P-12:** Tasks SHALL NOT target `.voidrift/` paths. The `.voidrift/` directory contains framework artifacts (requirements, architecture, specs, logs) produced by gather and plan — not the develop command. Dot-prefixed project files (`.github/`, `.dockerignore`, `.eslintrc`, etc.) are valid develop targets.
  - *Rationale:* `.voidrift/` contains framework artifacts produced by gather and plan. Develop tasks that target `.voidrift/` paths overwrite planning artifacts or create redundant specs. However, many projects legitimately require dot-prefixed config files (CI workflows, linter configs, Docker ignore files) that the develop command must create.
  - Given TASKS.md contains a task targeting `.voidrift/analysis/backend.md`, When the plan is reviewed, Then the task is invalid — analysis files are gather artifacts.
  - Given TASKS.md contains a task targeting `.github/workflows/ci.yml`, When the plan is reviewed, Then the task is valid — CI config is a project source file.
  - Given TASKS.md contains a task targeting `src/main.py`, When the plan is reviewed, Then the task is valid.
- **REQ-P-13:** WHEN `voidrift plan <model>` is run, THE SYSTEM SHALL validate that `.voidrift/REQUIREMENTS.md` exists before performing any model calls. IF `.voidrift/REQUIREMENTS.md` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift gather`.
  - Given no `.voidrift/REQUIREMENTS.md` exists, When `voidrift plan <model>` is run, Then the command exits with an error containing "Run 'voidrift gather'" — no model call is made.
  - Given `.voidrift/REQUIREMENTS.md` exists and no plan artifacts exist, When `voidrift plan <model>` runs, Then fresh-plan mode runs.
  - Given `.voidrift/REQUIREMENTS.md` exists and `.voidrift/ARCHITECTURE.md` and `.voidrift/tasks/manifest.yml` exist, When `voidrift plan <model>` runs without `--overwrite`, Then update mode runs with delta analysis before the pipeline.
- **REQ-VF-1:** WHEN the Plan command generates ARCHITECTURE.md for a project with a runnable entry point, THE SYSTEM SHALL include a `startup_command:` field.
  - *Rationale:* Verify needs to start the system under test. The startup command must be captured during planning when the project type and entry point are known — not inferred at verify time.
  - Given a web API project, When Plan generates ARCHITECTURE.md, Then `startup_command:` is present with the command to start the server.
  - Given a CLI-only project with no runnable server, When Plan generates ARCHITECTURE.md, Then `startup_command:` is omitted or empty.
- **REQ-VF-2:** WHEN the Plan command detects authentication requirements in REQUIREMENTS.md, THE SYSTEM SHALL include `test_bootstrap:` in ARCHITECTURE.md AND add a test harness implementation task in TASKS.md.
  - *Rationale:* Verify sub-agents need seeded credentials to test auth flows. The bootstrap script must be produced by Develop so it is available before Verify runs.
  - Given an auth system is present in REQUIREMENTS.md, When Plan generates TASKS.md, Then a test harness task targeting a bootstrap script exists.
  - Given no authentication requirements, When Plan generates ARCHITECTURE.md, Then `test_bootstrap:` is omitted.

### 4.6 Command: Develop

- **REQ-D-1:** WHEN `.voidrift/tasks/manifest.yml` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift plan`.
  - Given no `.voidrift/tasks/manifest.yml` exists, When `voidrift develop <model>` is run, Then the command exits with an error containing "Run 'voidrift plan'".
- **REQ-D-2:** WHEN the manifest contains no dispatchable tasks (all `verified`, `blocked`, or empty), THE SYSTEM SHALL exit with "all tasks complete" and return 0.
  - Given all tasks in the manifest are `verified`, When `voidrift develop <model>` is run, Then the command exits with code 0 and prints "All tasks complete."
- **REQ-D-3:** WHEN a develop session starts, THE SYSTEM SHALL create `.voidrift/.develop.lock` with PID and timestamp. IF the lock exists with a live PID, THE SYSTEM SHALL exit with error.
  - Given no lock file exists, When a develop session starts, Then `.develop.lock` is created with the current PID.
  - Given a lock file exists with a live PID, When `voidrift develop <model>` is run, Then the command exits with an error containing the PID.
  - Given a lock file exists with a dead PID, When `voidrift develop <model>` is run, Then the stale lock is removed and the session starts.
- **REQ-D-4:** WHILE the develop loop is active, THE SYSTEM SHALL read the manifest, find all tasks where status=`planned` and all dependencies are `implemented` or `verified`, and dispatch them as sub-agents up to the model's `concurrency` limit. Each sub-agent receives the task file content as its prompt and uses the narrowed per-task tool set (REQ-ARCH-9). WHEN a sub-agent completes with writes, the CLI sets the task to `implemented`. WHEN no dispatchable tasks remain, the loop exits. Skills referenced in task frontmatter SHALL be resolved and injected into the sub-agent's system prompt. All instructions SHALL live in `resources/prompts/develop.md`.
  - *Rationale:* Self-contained task files eliminate context-loading tool calls. The CLI dispatches at the task level, not the module level — if 4 tasks across 3 modules are all ready, all 4 dispatch concurrently (within the concurrency limit). Fresh agents per task (REQ-ARCH-7) prevent context accumulation.
  - Given the manifest has 3 dispatchable tasks and concurrency is 3, When develop runs, Then all 3 are dispatched concurrently.
  - Given a task file contains a user story, context, and ACs, When the sub-agent receives it, Then the agent writes code without making context-loading tool calls.
  - Given a task has skills `[BACKEND-ENG]` in frontmatter, When the sub-agent is created, Then the BACKEND-ENG skill content is in the system prompt.
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
- **REQ-D-9:** Task completion SHALL be managed by the develop command framework code, which updates the manifest status to `implemented` after verifying writes occurred. The model SHALL NOT manage task status — the develop prompt SHALL instruct the model to write code and call `done()`.
  - *Rationale:* CLI ownership of status transitions prevents agents from corrupting the manifest. The CLI verifies writes before marking implemented.
  - Given a task is `in-progress`, When the framework verifies writes occurred, Then the manifest status is set to `implemented`.
  - Given the develop prompt, When the model reads its instructions, Then the prompt contains no task completion tools.
- **REQ-D-10:** THE SYSTEM SHALL dispatch ready tasks concurrently using `ThreadPoolExecutor` with the model's `concurrency` field (REQ-MC-3). Tasks are dispatched at the task level, not the module level — ready tasks from any module are dispatched together. WHEN concurrency is 1, tasks SHALL be processed sequentially. WHEN concurrency is 0, all ready tasks SHALL be dispatched simultaneously.
  - *Rationale:* Task-level concurrency is more efficient than module-level — if 4 tasks across 3 modules are all ready, all 4 dispatch concurrently instead of waiting for module boundaries.
  - Given 4 ready tasks across 3 modules and concurrency is 3, When develop runs, Then 3 tasks are dispatched concurrently regardless of module.
  - Given concurrency is 1, When develop runs, Then tasks are processed one at a time.
- **REQ-D-11:** WHEN multiple workers are active, git operations SHALL be serialized through a `threading.Lock` to prevent index conflicts.
  - *Rationale:* Concurrent `git diff` or future `git commit` calls from parallel task workers can corrupt the git index. A shared lock serializes access.
  - Given 3 tasks running concurrently, When two workers trigger git diff simultaneously, Then only one executes at a time (the other blocks until the lock is released).
- **REQ-D-12:** *(Removed — module-level dispatch replaced by task-level dispatch per REQ-D-10.)*
- **REQ-D-13:** WHEN Ctrl+C or SIGTERM is received, THE SYSTEM SHALL set an interrupted flag and stop after the current task completes. The lock file SHALL be cleaned up in all cases. WHEN multiple workers are active (REQ-D-10), THE SYSTEM SHALL send SIGTERM to active workers, allow a 2-second grace period, then SIGKILL.
  - Given a develop session is running a task, When Ctrl+C is pressed, Then the current task finishes and the session exits with the lock file removed.

- **REQ-D-14:** *(Replaced by REQ-TM-5 and REQ-TM-6. Task completion tracked in manifest; archival moves files to `archived/` and appends to history.log.)*

### 4.7 Command: Deploy

Deploy prepares verified code for release: version management, changelog generation, git tagging, and optional IaC generation.

- **REQ-DPL-1:** WHEN `voidrift deploy <model>` is run, THE SYSTEM SHALL determine the version bump type (major, minor, or patch) from verified tasks since the last release tag. The model reads task files and requirements to classify: new features = minor, breaking changes = major, bug fixes = patch. The operator SHALL be prompted to confirm or override the suggested bump before it is applied. The version SHALL follow Semantic Versioning (SemVer).
  - *Rationale:* Automated classification from task content prevents version drift. Operator confirmation prevents incorrect bumps from propagating.
  - Given 3 verified feature tasks since the last tag, When deploy runs, Then the model suggests a minor bump and the operator confirms.
  - Given a verified task that modifies a public API contract, When deploy runs, Then the model suggests a major bump.
- **REQ-DPL-2:** Deploy SHALL generate a changelog entry from `.voidrift/tasks/history.log` listing verified tasks since the last release tag, grouped by module, with task summaries. The changelog SHALL be appended to the project's CHANGELOG.md (or created if absent).
  - *Rationale:* history.log is the canonical record of completed work. Generating the changelog from it ensures accuracy and eliminates manual changelog maintenance.
  - Given 5 tasks verified since the last tag, When deploy generates the changelog, Then all 5 appear grouped by module with summaries.
- **REQ-DPL-3:** Deploy SHALL create a git tag (`v{version}`) marking the release candidate. The tag SHALL be annotated with the changelog entry as the tag message.
  - *Rationale:* A git tag locks the changeset. The annotated message provides release context without requiring a separate file lookup.
  - Given version 1.2.0 is confirmed, When deploy tags, Then `v1.2.0` is created as an annotated tag.
- **REQ-DPL-4:** WHEN ARCHITECTURE.md indicates infrastructure requirements (IaC sections present), deploy SHALL generate or update infrastructure-as-code per REQ-A-1 through REQ-A-4. WHEN no infrastructure sections exist in ARCHITECTURE.md, IaC generation SHALL be skipped.
  - *Rationale:* Not all projects need IaC. Skipping when unnecessary avoids generating empty or irrelevant infrastructure files.
- **REQ-DPL-5:** WHEN a `post_deploy` field exists in ARCHITECTURE.md, deploy SHALL execute it as a shell command after tagging. The command receives the new version as `$VERSION`. IF the command fails, deploy SHALL warn but NOT roll back the tag.
  - *Rationale:* Post-deploy hooks let the operator trigger project-specific actions (CI pipelines, registry pushes, notifications) without deploy prescribing a deployment strategy.
  - Given `post_deploy: ./scripts/release.sh`, When deploy completes tagging v1.2.0, Then `./scripts/release.sh` is executed with `VERSION=1.2.0` in the environment.
  - Given the post-deploy script exits non-zero, When deploy checks the result, Then a warning is printed but the tag remains.
- **REQ-A-1:** WHEN no IaC files are detected, THE SYSTEM SHALL generate infrastructure-as-code based on REQUIREMENTS.md and ARCHITECTURE.md.
- **REQ-A-2:** WHEN IaC files exist, THE SYSTEM SHALL review them for consistency and reconcile gaps without deleting existing files.
- **REQ-A-3:** Generated IaC SHALL NOT contain hardcoded secrets. All sensitive values SHALL be parameterized.
- **REQ-A-4:** Every generated cloud resource SHALL be tagged with project name and environment.
- **REQ-A-5:** WHEN `voidrift deploy <model>` is run, THE SYSTEM SHALL validate that both `.voidrift/REQUIREMENTS.md` and `.voidrift/ARCHITECTURE.md` exist before performing any model calls. IF either file is missing, THE SYSTEM SHALL exit with a clear error identifying which artifact is missing and which command produces it.
  - Given no `.voidrift/REQUIREMENTS.md` exists, When `voidrift deploy <model>` is run, Then the command exits with an error containing "Run 'voidrift gather'" — no model call is made.
  - Given `.voidrift/REQUIREMENTS.md` exists but `.voidrift/ARCHITECTURE.md` does not, When `voidrift deploy <model>` is run, Then the command exits with an error containing "Run 'voidrift plan'" — no model call is made.
  - Given both `.voidrift/REQUIREMENTS.md` and `.voidrift/ARCHITECTURE.md` exist, When `voidrift deploy <model>` runs, Then deployment proceeds normally.

### 4.8 Command: Verify

Verify is a two-stage requirements-driven acceptance testing command. Stage 1 produces a test plan; Stage 2 executes each test case in a dedicated sub-agent. Verify never modifies source code.

- **REQ-VF-P:** WHEN `voidrift verify <model>` is run, THE SYSTEM SHALL validate that `.voidrift/REQUIREMENTS.md` exists before performing any model calls. IF `.voidrift/REQUIREMENTS.md` does not exist, THE SYSTEM SHALL exit with an error prompting `voidrift gather`.
  - Given no `.voidrift/REQUIREMENTS.md` exists, When `voidrift verify <model>` is run, Then the command exits with an error containing "Run 'voidrift gather'" — no model call is made.
  - Given `.voidrift/REQUIREMENTS.md` exists, When `voidrift verify <model>` runs, Then verification proceeds normally.

- **REQ-VF-3:** WHEN Stage 1 completes, THE SYSTEM SHALL have written `.voidrift/VERIFY-PLAN.md` containing one self-contained test case per testable scenario. Each test case SHALL be a complete prompt including: requirement text, user story context, system context, test credentials (if applicable), numbered scenario steps, expected result, and evidence collection instructions. Non-testable criteria SHALL appear as SKIP items with reason.
  - *Rationale:* Self-contained test cases eliminate context assembly in the orchestrator. The plan agent does that work once; sub-agents receive ready-to-execute prompts with no further assembly.
  - Given 10 criteria (8 testable, 2 qualitative), When VERIFY-PLAN.md is written, Then 8 test cases and 2 SKIP items are present.

- **REQ-VF-4:** WHEN a sub-agent encounters a failing scenario, THE SYSTEM SHALL write `.voidrift/bugs/<ITEM-ID>.md` containing: timestamp, run ID, requirement reference, scenario steps executed with full request/response detail, expected vs. actual result, process output at time of failure, any stack traces, screenshots (if UI scenario), and agent notes on likely cause.
  - *Rationale:* Bug reports are the primary artifact for Develop and Chat. Full-fidelity evidence in a structured file means no re-running is needed to understand the failure.
  - Given a scenario fails, When the bug report is written, Then it contains all evidence fields.

- **REQ-VF-5:** WHEN Stage 3 completes, THE SYSTEM SHALL have written `.voidrift/VERIFY.md` containing: summary table (total/passed/failed/skipped), per-item result with evidence for passes and bug report link for failures, and a Verdict line.
  - Given 1 failure exists, When VERIFY.md is written, Then the failure entry links to the bug report file.

- **REQ-VF-6:** WHEN Verify completes, THE SYSTEM SHALL write a STATE.md entry: command, run ID, timestamp, verdict, items total/passed/failed/skipped.

- **REQ-VF-7:** Sub-agents SHALL NOT modify source files. The `write_source_file` tool SHALL NOT be included in the `cmd="verify-execute"` tool set.
  - *Rationale:* Verify's responsibility is observation and reporting. Code changes are Develop's responsibility. Structural enforcement via tool set ensures this boundary is never crossed.
  - Given cmd="verify-execute", When build_local_tools() returns the tool list, Then write_source_file and read_source_file are absent.

- **REQ-VF-8:** THE SYSTEM SHALL provide `start_process(cmd, env, cwd)` returning an opaque handle ID with buffered stdout/stderr capture.
  - *Rationale:* Sub-agents need a stable reference to a running process that persists across tool calls. An opaque handle avoids exposing OS PIDs and allows the framework to manage lifecycle centrally.
  - Given a valid shell command, When start_process(cmd) is called, Then a handle_id string is returned and the process is running with stdout/stderr captured.
  - Given a started process, When read_process_output(handle_id) is called, Then buffered output lines are returned without stopping the process.

- **REQ-VF-9:** THE SYSTEM SHALL provide `wait_for_ready(handle_id, strategy, target, timeout)` with strategies `http`, `port`, and `log_pattern`. Timeout SHALL stop the process and raise.
  - *Rationale:* Different server types signal readiness differently. A unified function with pluggable strategies avoids duplicating polling logic in every test case.
  - Given strategy="http" and target="http://localhost:8000/health", When the process starts, Then wait_for_ready polls until 200 is returned or timeout.
  - Given strategy="port" and target="8080", When the process starts, Then wait_for_ready polls until the port accepts connections.
  - Given strategy="log_pattern" and target="Server started", When the process starts, Then wait_for_ready scans buffered output until the pattern appears.

- **REQ-VF-10:** THE SYSTEM SHALL guarantee process cleanup in a `try/finally` block in the orchestrator regardless of sub-agent outcome.
  - *Rationale:* Leaked processes accumulate port bindings and consume resources. Structural enforcement via try/finally ensures cleanup even when sub-agents raise exceptions or are interrupted.
  - Given a started process and a sub-agent that raises an exception, When the orchestrator's try/finally block executes, Then stop_all() is called and the process is terminated.
  - Given a successful verify run, When run_verify() returns 0, Then stop_all() has been called in the finally block.

- **REQ-VF-11:** THE SYSTEM SHALL provide `read_process_output(handle_id)` returning up to 500 buffered lines (newest kept on overflow) and `run_command(cmd, cwd)` returning stdout, stderr, and exit_code synchronously.
  - *Rationale:* Sub-agents need both streaming (ongoing process output) and one-shot (diagnostic commands) access. Separating these into two tools keeps each interface focused.
  - Given a process with more than 500 lines of output, When read_process_output(handle_id) is called, Then the 500 newest lines are returned and no lines beyond 500 are held in memory.
  - Given a shell command, When run_command(cmd) is called, Then stdout, stderr, and exit_code are returned after the command completes.

- **REQ-VF-12:** THE SYSTEM SHALL provide `http_request(method, url, headers, body, session_id)` with per-session cookie and auth header persistence. Multiple named sessions per sub-agent SHALL be supported. Sessions SHALL be discarded when the orchestrator clears them after Stage 2.
  - *Rationale:* Many acceptance criteria involve authenticated flows across multiple requests. Session persistence eliminates the need for sub-agents to manually track cookies and auth tokens between steps.
  - Given a login request that returns a Set-Cookie header with session_id="alice", When a subsequent request uses session_id="alice", Then the cookie is sent automatically.
  - Given multiple sub-agents running concurrently each using session_id="default", When clear_sessions() is called after Stage 2, Then all sessions for all sub-agents are discarded.

- **REQ-VF-13:** THE SYSTEM SHALL construct Stage 1 and Stage 2 system prompts using four-layer construction: `system.md` + QUALITY-QA skill + `resources/prompts/verify.md` + injected context.

- **REQ-VF-14:** The Stage 1 plan agent SHALL cross-reference REQUIREMENTS.md, user stories, ARCHITECTURE.md, TASKS.md, and spec files when deriving test cases. Each test case SHALL embed all context a sub-agent needs to execute without reading any additional documents.
  - *Rationale:* Sub-agents have minimal scope by design. All context assembly happens in Stage 1 so sub-agents stay focused on execution.

- **REQ-VF-15:** Sub-agents SHALL run concurrently up to the configured concurrency limit (shared with Develop command config). Each sub-agent starts with a clean message history.

- **REQ-VF-16:** THE SYSTEM SHALL pass `cmd="verify-plan"` and `cmd="verify-execute"` to `build_local_tools()`. The `cmd="verify-execute"` tool set SHALL include: `read_framework_file`, `write_framework_file`, `read_process_output`, `http_request`, `run_command`, and browser tools. It SHALL NOT include `read_source_file`, `write_source_file`, `start_process`, or `stop_process`.
  - Given cmd="verify-plan", When build_local_tools() is called, Then read_framework_file, read_source_file, and write_framework_file are present.
  - Given cmd="verify-execute", When build_local_tools() is called, Then read_source_file and write_source_file are absent; http_request, run_command, read_process_output, and browser tools are present.

### 4.9 Utility Commands

- **REQ-U-1:** `voidrift status` SHALL print command completion status with emoji indicators (✅, ⬜, 🔄) and task counts.
- **REQ-U-2:** `voidrift chat <model>` SHALL start an interactive session with full chat tool access (per REQ-ARCH-9) — the central command for iterating on any `.voidrift/` artifact. The agent SHALL use `tool_choice: "auto"` (per REQ-ARCH-4) and streaming mode for responsive token-by-token display. The agent's system prompt SHALL be constructed per REQ-RES-7: the ANALYSIS-REQS skill as baseline methodology, the `chat/SYSTEM` prompt for behavioral rules, and optional context. The agent MAY load additional domain skills on demand via `get_skill()` (available in the chat command only). `--doc <path>` SHALL scope the conversation to a specific `.voidrift/` artifact, loading its content into the system prompt context. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt (not exit).
  - Given a valid model alias, When `voidrift chat <model>` is run, Then an interactive session starts with the ANALYSIS-REQS skill and `chat/SYSTEM` prompt loaded.
  - Given `--doc REQUIREMENTS.md` and the file exists, When the session starts, Then the system prompt includes the file's content.
  - Given `--doc new-spec.md` and the file does not exist, When the session starts, Then a warning is printed and the system prompt includes the DOC-NEW section.
  - Given a model API error during a chat turn, When the agent raises a RuntimeError, Then the error is printed and the prompt reappears.
- **REQ-U-3:** `voidrift log <command>` SHALL show the last 200 lines of the most recent log. `--follow` / `-f` SHALL tail the latest log file, streaming new lines as they are written. `--prune` SHALL delete log files.
- **REQ-U-4:** `voidrift unlock` SHALL remove the develop lock file and kill any running develop process.
- **REQ-U-5:** `voidrift completions <shell>` SHALL output shell completion scripts for bash, zsh, and fish. All model, worker, and architect arguments SHALL complete from configured aliases in `models.yml`.
- **REQ-U-6:** `voidrift prune` SHALL remove project-level ephemeral data (`.voidrift/` logs, cache, stale `.develop.lock`) beyond the configured retention limit (`retention.project`, default 5). `--all` SHALL remove the entire `.voidrift/` directory — a clean slate. `--global` SHALL prune global framework logs (`~/.voidrift/logs/`) beyond the configured retention limit (`retention.global`, default 30 days). `--global --all` SHALL remove ALL global framework logs. WHEN `--global` is NOT set AND no `.voidrift/` directory exists in the current project, THE SYSTEM SHALL exit with a friendly error (e.g. "No .voidrift directory found — nothing to prune").
- **REQ-U-8:** WHEN the chat agent calls `web_fetch(url)`, THE SYSTEM SHALL fetch the URL via HTTP GET, strip markup, summarize the content via an isolated sub-agent with its own context window, cache the summary in process memory keyed by URL, and return the summary to the chat agent. Subsequent calls with the same URL within the same session SHALL return the cached summary without re-fetching. The `web_fetch` tool SHALL be available only in the chat command.
  - *Rationale:* Raw page content can be hundreds of KB — inserting it directly into the chat agent's context would consume most of the available window. An isolated sub-agent processes the raw content and returns only a concise summary, keeping the chat agent's context small regardless of page size. Caching eliminates redundant fetches within a session.
  - Given a valid URL, When the chat agent calls `web_fetch(url)`, Then the URL is printed to the terminal and the operator is prompted to allow or deny the request before any HTTP connection is made.
  - Given the operator denies a fetch, When `web_fetch(url)` is called, Then a denial message is returned to the chat agent and no HTTP request is made.
  - Given the operator allows a fetch, When `web_fetch(url)` is called, Then the page is fetched, a sub-agent summarizes it (≤300 words), and the summary is returned to the chat agent.
  - Given `web_fetch(url)` was previously called in the current session, When called again with the same URL, Then the cached summary is returned without prompting the operator or making an HTTP request.
  - Given a URL that fails (HTTP error, timeout, DNS failure), When `web_fetch(url)` is called, Then an error description is returned — no exception propagates to the chat agent.
  - Given raw page content enters the sub-agent, When the sub-agent returns, Then only the summary appears in the chat agent's context — raw HTML/text does not.
  - Given any non-chat command, When `build_local_tools` is called, Then `web_fetch` is not present in the returned tool list.
  - Given the terminal is in raw input mode (ECHO/ICANON disabled per REQ-UI-9), When `web_fetch(url)` is called, Then terminal input is restored to normal mode before the confirmation prompt is displayed and re-disabled after the operator responds.

- **REQ-U-7:** WHEN the operator types `/compact` during a chat session, THE SYSTEM SHALL summarize the conversation history to free context. The agent SHALL send the current message history to the model with a summarization prompt, replace all user/assistant/tool messages with a single system message containing the summary, and preserve the original system prompt. The resulting message history (system prompt + summary) SHALL NOT exceed 10% of the model's context window. The summary SHALL capture key decisions, artifacts discussed, and any pending work. The context window size SHALL be queried from the model's API at session start — no hardcoded limits.
  - *Rationale:* Long chat sessions accumulate context from tool results (file contents, analyses, requirements) until the context window fills. Summarization preserves session continuity without restarting. The 10% ceiling leaves 90% of the context available for the next exchange.
  - Given a chat session with 50K tokens of history, When the operator types `/compact`, Then the history is replaced with a summary and the total message size is ≤10% of the model's max context.
  - Given a chat session with only the system prompt, When the operator types `/compact`, Then the system prints "Nothing to compact." and the history is unchanged.

### 4.10 Model Configuration

- **REQ-MC-1:** WHEN a model alias is used, THE SYSTEM SHALL resolve it to `(base_url, api_key, model_id)`. The CLI SHALL read all model definitions from a single models file. The path to this file SHALL be configurable via `models_file` in `config.yml` (default: `~/.worker-cli/models.yml`). Each model entry SHALL be self-contained: `base_url`, `api_key`, `model_id`, and optional `provider` and `max_context`. IF an alias is not found, THE SYSTEM SHALL exit with an error listing all available aliases.
  - *Rationale:* Voidrift is model-agnostic — it doesn't care how models are provisioned. An external tool (worker-cli) maintains the model registry with full connection details per entry. Voidrift just reads the file and connects. One file, one source of truth, no merging.
  - Given the models file has alias `qwen35`, When `resolve_model("qwen35")` is called, Then a `ModelConfig` with the entry's `base_url`, `api_key`, `model_id`, and `type` is returned.
  - Given the models file does not contain alias `foo`, When `resolve_model("foo")` is called, Then the CLI exits with an error listing available aliases.
  - Given `voidrift gather qwen35` is run, When the alias is resolved, Then the command proceeds using the connection details from the models file.
- **REQ-MC-2:** Cloud models SHALL require no initialization and be accessed directly via API endpoints.
- **REQ-MC-3:** The models file SHALL support a `defaults:` section specifying fallback values for operational limits. Each model entry inherits defaults and MAY override any field. Supported operational fields: `max_tokens` (integer, default 16384), `max_context` (integer, default null — query API), `max_read_lines` (integer, default 2000), `max_input_chars` (integer, default 0 — unlimited), `concurrency` (integer, default 1). The CLI SHALL NOT infer operational behavior from a `type` field. No hardcoded per-type limit tables SHALL exist in the CLI code.
  - *Rationale:* Different models have different capabilities. Making limits explicit per entry — with operator-controlled defaults — eliminates type-based inference and puts the operator in full control. A local model that can handle 32K output tokens gets `max_tokens: 32768`; a constrained model gets `max_tokens: 4096`. No guessing.
  - Given the models file has `max_context: 200000` for `claude`, When `_query_max_context(mc)` is called and the API returns no `max_model_len`, Then `200000` is returned.
  - Given the models file has no `max_context` for a model and the API returns no `max_model_len`, When `_query_max_context(mc)` is called, Then `None` is returned.
  - Given `defaults: {max_tokens: 16384}` and a model entry with no `max_tokens`, When the model is resolved, Then `max_tokens` is `16384`.
  - Given `defaults: {max_tokens: 16384}` and a model entry with `max_tokens: 4096`, When the model is resolved, Then `max_tokens` is `4096`.

### 4.12 Git

- **REQ-GIT-1:** Planning artifacts SHALL be committed in a single commit with message `"docs: add planning artifacts"`.
- **REQ-GIT-2:** WHILE the develop command is active, source code SHALL be committed per task with task-specific messages. WHEN multiple workers are active, commits SHALL be serialized through a lock.
- **REQ-GIT-3:** `auto-commits: false` SHALL be set for the gather and plan commands.

### 4.13 Project Structure

- **REQ-PS-1:** All framework-generated files SHALL be stored in `.voidrift/` within the target project directory.
- **REQ-PS-2:** The `.voidrift/` directory SHALL be created automatically on first command run if it does not exist.
- **REQ-PS-3:** `.voidrift/STATE.md` SHALL be created on the first command run and appended to by every framework command. Each entry records: timestamp, command name, model used, outcome summary, and a file manifest listing every file created or modified during that run. The gather command SHALL additionally record each analyzed file with its triage category. The chat agent SHALL read STATE.md to understand project lifecycle position. STATE.md is append-only — commands add entries, they never rewrite or truncate (except `--undo` which removes the last entry for a command).
  - *Rationale:* A single state file provides lifecycle traceability, enables `--undo` and `--overwrite` by tracking exactly what each command produced, and gives the chat agent awareness of project state without inferring from file existence.
  - Given gather completes, Then STATE.md contains a gather entry with analyzed files (with categories), output summary, and file manifest.
  - Given plan completes, Then STATE.md contains a plan entry listing ARCHITECTURE.md, arch/*.md, and TASKS.md in its file manifest.
  - Given the chat agent starts, Then it reads STATE.md and knows which commands have run, when, with which model, and what they produced.
  - Given no STATE.md exists, Then the project has no command history.
- **REQ-PS-4:** IF `.voidrift/` exists but is missing required files for a framework command, THE SYSTEM SHALL exit with an error suggesting corrective action.

### 4.14 Logging

Two log roots, two intents:
- **`~/.voidrift/logs/`** — framework logs. Record what the framework itself did: CLI invocations, command outcomes, tool operations. Persist across projects. Managed by RotatingFileHandler.
- **`<project-root>/.voidrift/logs/`** — project logs. Record what the framework did *to a specific project*: full agent dialog, tool calls, tool results for each command run. Scoped to the project. Pruned by `voidrift prune`.

- **REQ-LOG-1:** Command run logs SHALL be written to `<project-root>/.voidrift/logs/<command>-YYYYMMDD-HHMMSS.log`. The log filename stem is the run ID (per REQ-CTX-4). Command logs are the canonical verbose record of agent interactions, tool calls, and tool results for a run.
  - Given `voidrift gather qwen3 ./src` is run, When the command starts, Then a log file is created at `<project-root>/.voidrift/logs/gather-<timestamp>.log`.
- **REQ-LOG-2:** Project log files SHALL accumulate until pruned by `voidrift prune`. Framework log files rotate automatically via `RotatingFileHandler`.
- **REQ-LOG-3:** WHEN a command run displays its log path, it SHALL appear immediately after the command title line.
- **REQ-LOG-4:** THE SYSTEM SHALL maintain a persistent system log at `~/.voidrift/logs/voidrift.log` using Python's `logging` module with a `RotatingFileHandler` (max 1 MB per file, 5 backup files, UTF-8 encoding). THE SYSTEM SHALL initialize this log at CLI startup in `main()` before any commands execute. The system log path is always `~/.voidrift/logs/voidrift.log` regardless of the `VOIDRIFT_HOME` environment variable — framework logs are user-global, not project-scoped. The system log SHALL record: CLI invocations (argv), command completion events (command name, exit code, elapsed time), configuration load errors, and unhandled exceptions.
  - *Rationale:* Command logs record agent dialog at depth — they are verbose by design. A separate, compact system log answers the operational question: "what did the CLI do and did it succeed?" without tailing a 10,000-line agent log. Keeping it in `~/.voidrift/logs/` (not the project) means it persists across projects and is always accessible even when no project is active. `VOIDRIFT_HOME` controls config and resource resolution; it must not redirect framework logs into a project directory.
  - Given `main()` is called, When the CLI starts, Then `~/.voidrift/logs/voidrift.log` exists and is writable.
  - Given `VOIDRIFT_HOME` is set to a non-default path, When the CLI starts, Then the system log is still written to `~/.voidrift/logs/voidrift.log` (not `$VOIDRIFT_HOME/logs/`).
  - Given a `voidrift gather qwen3` run completes, When the system log is read, Then it contains an invocation line and a completion line with exit code.
- **REQ-LOG-5:** The `voidrift.log` system log SHALL record CLI invocations, command outcomes, and framework-level tool operations (write path and byte count, tool errors). `voidrift.log` is the single framework observability log — command logs are the per-run verbose record.
  - Given `write_framework_file("TASKS.md", content)` is called, When the write succeeds, Then `voidrift.log` contains an entry recording the path and byte count.
  - Given a tool call raises an exception, When the exception is caught, Then `voidrift.log` contains an error entry with the tool name and exception text.

### 4.15 Interactive Terminal UI

- **REQ-UI-1:** ALL console output SHALL use three distinct visual roles, consistent across every framework command (interactive and automated):
  - **System** (`▸`): dim white. Command titles, stage labels, progress counters, log paths, spinners, stats, errors, warnings. Prefix: `▸` for informational, `✓` green for success, `⚠` yellow for warnings, `✗` red for errors.
  - **Model** (`◆`): light blue (ANSI 256-color 117), indented 2 spaces. All model-generated text — streamed responses, summaries, analysis output. Prefix: `◆ alias` dim italic label on first line.
  - **Operator** (`▶`): bold white. Reprinted user input in interactive sessions. Preceded by a horizontal rule (`console.rule`, `bright_black` style).
  All framework commands SHALL use these roles identically. A shared output module SHALL enforce the convention — commands SHALL NOT use raw `console.print` with ad-hoc styling.
- **REQ-UI-2:** ALL framework commands (gather, plan, develop, deploy, verify) SHALL display progress through their stages. Each command SHALL show: a command title line, stage transitions (e.g. `▸ Stage 1/3: Triaging files...`), per-item progress with elapsed time (e.g. `▸ 3/28 backend/main.py... ✓ 4.8s`), and a final summary line. Automated commands (plan, develop, deploy, verify) SHALL show the same level of progress detail as interactive commands.
- **REQ-UI-3:** The `voidrift chat` command SHALL use a plain-terminal interface with: a dim header block (command name, log path, model label), a `prompt_toolkit` single-line input where Enter submits and `\` + Enter inserts a newline for multi-line messages (backspace/arrows work across lines), streamed model responses via `on_token` callback, and a dim stats line after each response (per REQ-UI-10).
- **REQ-UI-4:** Chat SHALL always have its full tool set available. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt.
  - Given a chat session is active, When the operator sends a message, Then all configured chat tools are available to the agent.
- **REQ-UI-5:** Interactive sessions SHALL handle Ctrl+C gracefully (print dim "Session ended." and exit), handle EOF on input (exit cleanly), and log all operator input and model responses to the session log file.
  - Given a chat session is active, When the operator presses Ctrl+C, Then "Session ended." is printed and the process exits cleanly.
  - Given a chat session with two exchanges, When the session ends, Then the log file contains both operator inputs and both model responses.
- **REQ-UI-6:** WHILE a chat session is active, the input prompt SHALL display the current context window utilization as a percentage: `[25%] >`. The percentage SHALL be calculated from the total message history token count relative to the model's max context window, queried from the model's API at session start. The percentage color SHALL be: white when ≤60%, yellow when >60% and ≤80%, red when >80%. WHEN a chat mode is active (e.g. idea refinement), the prompt SHALL include the mode name: `[25% idea] >` for a new idea, `[25% idea:3] >` when editing an existing idea. The mode indicator SHALL be cyan.
  - *Rationale:* Operators need visibility into context consumption to know when to `/compact` or start a new session. Color thresholds match standard warning/danger conventions. The mode indicator prevents the operator from losing track of what state the chat is in.
  - Given message history using 15K of 65K tokens, When the prompt is displayed, Then it shows `[23%] >` in white.
  - Given message history using 45K of 65K tokens, When the prompt is displayed, Then it shows `[69%] >` in yellow.
  - Given message history using 55K of 65K tokens, When the prompt is displayed, Then it shows `[85%] >` in red.
  - Given an idea flow is active for a new idea, When the prompt is displayed, Then it shows `[23% idea] >`.
  - Given an idea flow is active for IDEA-3, When the prompt is displayed, Then it shows `[23% idea:3] >`.
- **REQ-UI-7:** WHILE a chat agent call is in progress, THE SYSTEM SHALL use a single Rich `Live` block as the display surface with three progressive states: (1) a `Thinking...` spinner while waiting for the first token or tool result, (2) a dim 5-line tail window of accumulated streaming tokens while the response is arriving, (3) a fully rendered final response once the stream completes. A blank line SHALL precede the Live block to separate it from the operator input. Tool call activity SHALL NOT be echoed — the spinner remains visible throughout tool execution. The Live block SHALL exit leaving the final rendered content on screen.
  - *Rationale:* A single display surface eliminates the cursor flash and blank gap between the spinner clearing and the response appearing. The tail window gives the operator a sense of streaming progress without scrolling the terminal. Suppressing tool echo reduces noise — the model's final response is the relevant output.
  - Given the model begins responding, When the first token arrives, Then the Thinking... spinner is replaced by dim streaming text without any visual gap.
  - Given streaming completes, When the Live block exits, Then the fully rendered response is left on screen and the spinner/streaming text is gone.
  - Given the model calls a tool during a response, When the tool executes, Then the Thinking... spinner remains visible and no tool name is printed.
- **REQ-UI-8:** Chat model responses SHALL be rendered using Rich Markdown WHEN the response contains any of: headings (`#`), bold (`**`), fenced code blocks (` ``` `), tables (`|`), bullet/numbered lists (`- `, `* `, `1. `), inline code (`` ` ``), blockquotes (`> `), or links (`[text](`). Plain text responses SHALL render as indented plain text. All rendered responses SHALL be indented 2 spaces. The final markdown render SHALL replace the streaming tail window inside the Live block before it exits.
  - *Rationale:* Local and gateway models frequently respond with markdown. Rendering it produces readable output (formatted tables, syntax-highlighted code, etc.) rather than raw punctuation. Detecting markdown avoids applying the renderer to plain prose where it would have no effect.
  - Given a response containing a markdown table, When the stream completes, Then the table is rendered as a formatted Rich table — not raw pipe characters.
  - Given a response containing only plain prose, When the stream completes, Then it is displayed as indented plain text without markdown processing.
- **REQ-UI-9:** WHILE `agent.send()` is active in a chat session, THE SYSTEM SHALL disable terminal input echo (ECHO) and canonical mode (ICANON) to prevent keystrokes from appearing alongside the Live display. WHEN `agent.send()` returns (success or error), the terminal SHALL be restored to its original mode. WHEN any interactive prompt must be shown during `agent.send()` (e.g., `web_fetch` confirmation per REQ-U-8), the terminal SHALL be temporarily restored to normal mode for the duration of the prompt, then re-disabled before resuming.
  - *Rationale:* Without suppression, keystrokes typed during generation appear inline with the streamed response in the terminal, corrupting the display. Restoring on exit ensures the terminal is never left in raw mode if the agent errors or is interrupted.
  - Given the operator types while the model is streaming, When the response completes, Then no stray characters from the operator's typing appear in the terminal output.
  - Given agent.send() raises an exception, When the exception propagates, Then the terminal is restored to normal mode before the error is displayed.
  - Given web_fetch confirmation is required mid-stream, When the prompt appears, Then the operator can see their keystrokes and the input is handled correctly.
- **REQ-UI-10:** ALL agent stats lines — spinner progress during model calls and completion summaries after — SHALL display: elapsed time, token counts (`tkns: ↓ Nk - ↑ Nk`), context utilization (`ctx N%`), and a status indicator. Format: `(elapsed · tkns: ↓ Nk - ↑ Nk · ctx N% · status)`. Fields with no data from the model response SHALL be omitted. This applies uniformly to automated commands (gather, plan, develop, deploy, verify) and interactive commands (chat).
  - *Rationale:* Token and context telemetry is essential operational feedback. Operators need to see context pressure building before it causes failures. A single consistent format across all commands reduces cognitive load.
  - Given an agent call returns usage data, When the stats line is rendered, Then elapsed, tkns, ctx%, and status are all present.
  - Given an agent call returns no usage data, When the stats line is rendered, Then only elapsed and status are present.

### 4.16 Framework Configuration

- **REQ-CFG-1:** All framework configuration SHALL be read from `~/.voidrift/config.yml`. Config files SHALL support `${VAR}` and `${VAR:-default}` for environment variable expansion, and `${section.key}` for cross-referencing values from config.yml.
- **REQ-CFG-2:** `config.yml` SHALL contain sections for: `models_file` (path to the models registry, default `~/.worker-cli/models.yml`), `api_keys` (anthropic, gemini), `retention`, and `skills`. Connection settings are literal values; secrets use env var references.
- **REQ-CFG-3:** Framework resources (skills, templates, prompts) SHALL be read from `~/.voidrift/`. The repo is the source of truth; `make sync` copies to `~/.voidrift/`. `make sync` SHALL also create `~/.voidrift/domain-skills/` if it does not exist.
- **REQ-CFG-4:** `VOIDRIFT_HOME` env var MAY override `~/.voidrift/` for testing and CI. IF not set, `~/.voidrift/` is used.
- **REQ-CFG-5:** `config.yml` SHALL contain a `retention:` section with `project` (integer, default 5 — number of recent project logs to keep) and `global` (integer, default 30 — days of global framework logs to keep). `voidrift prune` uses these limits.
- **REQ-CFG-6:** Operational limits (`max_tokens`, `max_context`, `max_read_lines`, `max_input_chars`, `concurrency`) SHALL be read from each model's entry in the models file (REQ-MC-3). The models file `defaults:` section provides fallback values. The CLI SHALL NOT maintain per-type limit tables or infer limits from model type.
- **REQ-CFG-8:** WHEN any framework command (`gather`, `plan`, `develop`, `deploy`, `verify`, `chat`) is invoked AND the configured models file (per `models_file` in `config.yml`, default `~/.worker-cli/models.yml`) does not exist, THE SYSTEM SHALL exit with a clear error directing the operator to configure their models. WHEN `VOIDRIFT_HOME` is explicitly set, this check SHALL apply against the overridden config path.
  - *Rationale:* Without the models file, all model resolution fails with a cryptic "Unknown model: X. Available: " error. A direct error identifying the missing file is more actionable than a silent empty list. Utility commands (`status`, `log`, `prune`, `unlock`, `completions`, `skills`) are exempt — they do not perform model resolution and must remain usable even in a partially initialized state.
  - Given the configured models file does not exist, When `voidrift gather claude ./src` is run, Then the command exits with an error identifying the missing path.
  - Given `VOIDRIFT_HOME=/tmp/empty` and no models file at the configured path, When any framework command is run, Then the same error appears.
  - Given the configured models file exists, When any framework command is run, Then no setup check error is raised.

- **REQ-CFG-7:** `get_max_tokens(model, stage)` SHALL apply per-stage default max_tokens, capped by the model's `max_tokens` field. Stage defaults: `triage` 4096, `analysis` 2000, `synthesis` 2000, `consolidation` 8192, `task` 4000, `plan` 32768. The result is `min(stage_default, model.max_tokens)`.
  - *Rationale:* Different internal agent stages have fundamentally different output requirements. Analysis needs a concise bullet list; consolidation needs a full requirements document. Per-stage defaults encode these expectations while the model's cap prevents runaway output on constrained hardware.
  - Given model.max_tokens=4096 and stage="analysis", When get_max_tokens is called, Then it returns min(2000, 4096) = 2000.
  - Given model.max_tokens=4096 and stage="consolidation", When get_max_tokens is called, Then it returns min(8192, 4096) = 4096.

### 4.17 Skills System

- **REQ-SKL-1:** The framework SHALL maintain two distinct skill layers with separate purposes and storage locations:
  - **Global skills** (north star): `~/.voidrift/resources/skills/` — universal principles that orient agents across any project. Shipped with the framework, updated via `make sync`. Answer *what good looks like*, not *how to implement*. Apply to 80-90% of standard work across all project types. North-star skills are language-agnostic — they describe principles, not syntax.
  - **Domain skills**: installed globally at `~/.voidrift/domain-skills/` — specific knowledge for a technology, platform, or API. Reusable across projects. Installed via `voidrift skills install`.
  - **Project skills**: `<project>/.voidrift/skills/` — project-specific overrides. Take precedence over all other layers for this project only. Contain constraints, decisions, and patterns unique to this codebase that may deviate from or extend general domain guidance.
  - *Rationale:* North-star skills are timeless and universal — they keep agents oriented without prescribing implementation. Domain skills are reusable but specific to a technology. Project skills are the highest specificity — they capture what is true for this project that cannot be expressed in general guidance. Separating the layers prevents project-specific constraints from polluting the global domain layer and prevents domain noise from diluting north-star guidance.

- **REQ-SKL-2:** `find_skill(name, project_dir)` SHALL search in order: project skills (`<project>/.voidrift/skills/`) → global domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`). THE SYSTEM SHALL return the first match as a string. A project skill with the same name as a domain or north-star skill SHALL fully replace it for that project — no merging occurs. IF no skill is found at any layer, `find_skill()` SHALL return `None` and the caller SHALL log a warning.
  - *Rationale:* Project skills are intentional overrides. An operator who writes a project-level skill has specific reasons to deviate from global guidance — merging would undermine that intent and produce inconsistent guidance. The caller receives one skill per name, the most specific one wins.
  - Given a project skill `QUALITY-QA.md` exists in `<project>/.voidrift/skills/`, When `find_skill("QUALITY-QA", project_dir)` is called, Then the project skill content is returned and the north-star version is not read.
  - Given no project skill exists for `BACKEND-ENG` but a north-star one does, When `find_skill("BACKEND-ENG", project_dir)` is called, Then the north-star content is returned.
  - Given no skill exists at any layer for `UNKNOWN`, When `find_skill("UNKNOWN", project_dir)` is called, Then `None` is returned.

- **REQ-SKL-3:** `config.yml` SHALL support a `skills:` section with:
  - `repos` — ordered list of GitHub repo URLs to search for domain skills; earlier entries take precedence on name collision.
  - `synthesis_model` — model alias to use for skill synthesis; SHALL be a capable reasoning model with internet access.
  - *Rationale:* Multiple repos allow the operator to combine a private skills repo with community sources. Precedence order gives the operator control over which source wins on conflict. The synthesis model is separate from the command model because skill synthesis is a one-time research task that benefits from a strong reasoning model.

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

### 4.18 File Size Standards

- **REQ-FSZ-1:** `read_source_file` and `read_framework_file` SHALL accept `offset` (integer, default 0) and `limit` (integer, default the model's `max_read_lines`) parameters. WHEN a file is read AND its total line count exceeds `limit` AND no explicit `limit` was provided by the caller, THE SYSTEM SHALL return the first `limit` lines prefixed with a warning header: the total line count, the number of lines returned, and pagination instructions (`use offset=N to read the next chunk`). WHEN an explicit `limit` is provided, THE SYSTEM SHALL return exactly the requested lines with no warning.
  - *Rationale:* A model that reads a 5000-line file in full fills its context with raw code, leaving little room for reasoning and output. Pagination keeps each read within the model's effective working window. The warning header ensures the model knows there is more content and knows how to request it — without this, models assume they have the full file and produce incorrect analyses.
  - Given a 3000-line file is read with no `limit` param and `max_read_lines=2000`, When `read_source_file` is called, Then lines 1–2000 are returned with a header: "WARNING: file has 3000 lines. Returning lines 1–2000. Use offset=2000 to read the next chunk."
  - Given a 3000-line file is read with `limit=500`, When `read_source_file` is called, Then lines 1–500 are returned with no warning.
  - Given a 3000-line file is read with `offset=2000`, When `read_source_file` is called, Then lines 2001–3000 are returned with no warning (explicit offset signals intentional pagination).
  - Given a 500-line file is read with no `limit` param and `max_read_lines=2000`, When `read_source_file` is called, Then the full file is returned with no warning.

- **REQ-FSZ-2:** WHEN `write_source_file` or `write_framework_file` is called AND the content to be written exceeds the model's `max_read_lines` limit, THE SYSTEM SHALL reject the write and return an error. The error SHALL include: the actual line count, the configured limit, and a decomposition directive: "This file exceeds the max_read_lines limit. Decompose into smaller files and write each separately." No data SHALL be written to disk on a rejected write.
  - *Rationale:* A file that exceeds `max_read_lines` cannot be fully read back in a single call by the same model that wrote it. Writing it creates a file the model cannot reason about in subsequent commands. The rejection message is intentionally a design signal — if a write is this large, the architecture needs decomposition, not truncation. Truncation silently destroys content; decomposition produces a better design.
  - Given a model attempts to write 2500 lines to `src/main.py` with `max_read_lines=2000`, When `write_source_file` is called, Then the write is rejected with an error containing "exceeds the max_read_lines limit" and the actual vs limit line counts.
  - Given a model attempts to write 1800 lines to `.voidrift/TASKS.md` with `max_read_lines=2000`, When `write_framework_file` is called, Then the write succeeds.
  - Given a cloud model with `max_read_lines=4000` attempts to write 3500 lines, When `write_source_file` is called, Then the write succeeds.

- **REQ-FSZ-3:** `resources/prompts/system.md` SHALL include a file size guidance section instructing models to: (1) read the pagination warning when present and use `offset`/`limit` to retrieve the remaining content before proceeding; (2) treat a write-rejection error as a design signal and decompose the intended output into multiple smaller, logically cohesive files; (3) never truncate content to fit the limit — decomposition is always the correct response.
  - *Rationale:* Without prompt-level guidance, models will attempt workarounds (truncating, re-requesting the same oversized write, or ignoring the warning). The prompt establishes the expected behavior as a first principle rather than relying on error messages alone to teach it.
  - Given a model receives a pagination warning, When the model proceeds, Then it calls `read_source_file` again with the next `offset` before forming conclusions about the file.
  - Given a model receives a write-rejection error, When the model responds, Then it proposes a decomposed file structure and writes each part separately.

### 4.19 Task Management

- **REQ-TM-1:** `cli/src/voidrift_cli/manifest.py` SHALL provide a `ManifestManager` class that reads and writes `.voidrift/tasks/manifest.yml`. The manifest tracks: task status, module grouping, dependencies, bug references, assignment, and next ID counters (`next_id`, `next_bug_id`). The manifest is owned exclusively by the CLI — no agent tool provides write access to it. The manifest SHALL only contain active work — archived entries are removed from the manifest and recorded in history.log.
  - *Rationale:* Separating orchestration state from task content keeps the manifest small and fast. CLI ownership prevents agents from corrupting the dependency graph or status tracking.
  - Given a manifest with 10 active tasks, When the CLI reads it, Then all task statuses, dependencies, and module groupings are available.
  - Given an agent tool call attempts to write manifest.yml, When the tool executes, Then the write is denied.

- **REQ-TM-2:** Each task SHALL have a lifecycle status: `planned`, `in-progress`, `implemented`, `verified`, `failed`, `blocked`. Status transitions SHALL be:
  - `planned → in-progress`: develop dispatches the task
  - `in-progress → implemented`: agent completes writes successfully
  - `implemented → verified`: verify passes all ACs
  - `implemented → failed`: verify fails ACs
  - `failed → in-progress`: develop re-dispatches with bug context and architect guidance
  - `planned → blocked`: a dependency is set to `failed`
  - `blocked → planned`: all dependencies are `implemented` or `verified`
  - *Rationale:* Explicit lifecycle states make task progress visible and enable the CLI to make correct dispatch decisions without inference.
  - Given a task with status `planned` and all dependencies `verified`, When develop runs, Then the task transitions to `in-progress`.
  - Given a task with status `implemented`, When verify fails its ACs, Then the task transitions to `failed`.
  - Given a task with status `failed`, When develop re-dispatches it, Then the task transitions to `in-progress` with bug context appended.

- **REQ-TM-3:** The CLI SHALL resolve dependencies before dispatching tasks. A task is dispatchable WHEN status=`planned` AND all dependencies are `implemented` or `verified`. WHEN a task is set to `failed`, the CLI SHALL transitively block all dependent tasks. WHEN a failed task is set to `implemented`, the CLI SHALL unblock dependents whose other dependencies are all met.
  - *Rationale:* Dependency resolution prevents dispatching tasks that depend on incomplete or broken work. Transitive blocking prevents cascading failures. Automatic unblocking resumes work as soon as blockers are resolved.
  - Given task 6 depends on tasks 1 and 2, and task 1 is `verified` but task 2 is `planned`, When the CLI checks dispatchability, Then task 6 is not dispatched.
  - Given task 5 is set to `failed` and task 8 depends on task 5, When the CLI updates status, Then task 8 is set to `blocked`.
  - Given task 5 is set to `implemented` and task 8 was `blocked` only by task 5, When the CLI updates status, Then task 8 is set to `planned`.

- **REQ-TM-4:** Each task SHALL be a self-contained markdown file in `.voidrift/tasks/active/` named `TASK-{id}.md` where `id` is a monotonically increasing integer. The file SHALL have YAML frontmatter (`id`, `module`, `skills`, `files`, `depends`) and body sections: title, user story, context (relevant architecture and requirements excerpts), acceptance criteria, and implementation notes. The task file SHALL contain everything a developer agent needs to implement without loading additional context via tool calls.
  - *Rationale:* Self-contained tickets eliminate context-loading tool calls from the develop agent. The agent receives the ticket as its prompt and writes code immediately. The same format supports greenfield tasks (files: create) and change requests (files: modify) with existing code excerpts in the context section.
  - Given a task file for a weather endpoint, When a developer agent receives it, Then the file contains the user story, relevant architecture excerpt, acceptance criteria, and target file paths.
  - Given a change request task, When the task file is created, Then the context section includes excerpts of the existing code that needs modification.

- **REQ-TM-5:** WHEN a task is archived, the CLI SHALL append a one-line event to `.voidrift/tasks/history.log` with timestamp, entity ID, new status, module, and assignment. The history log is append-only and never modified. It is read for reporting, not on the dispatch hot path.
  - *Rationale:* The history log provides an audit trail without bloating the manifest. One line per event keeps it simple and greppable.
  - Given task 1 is archived, When the CLI writes history.log, Then a line like `2026-04-01T10:00:00 TASK-1 verified module=backend assigned=kiro` is appended.

- **REQ-TM-6:** WHEN a task reaches `verified`, the CLI SHALL move the task file from `active/` to `archived/`, remove the task from manifest.yml, and append to history.log. Referenced bug files SHALL move to `archived/` when all tasks referencing that bug are verified.
  - *Rationale:* Moving verified work out of `active/` keeps the working directory lean. Archived files remain available for reference by change requests and reporting.
  - Given task 5 is `verified` and BUG-1 references only task 5, When the CLI archives, Then both TASK-5.md and BUG-1.md move to `archived/`.
  - Given BUG-2 references tasks 5 and 8, and task 5 is `verified` but task 8 is `implemented`, When task 5 is archived, Then BUG-2.md stays in `active/`.

- **REQ-TM-7:** Bugs SHALL be independent entities in `.voidrift/tasks/active/` named `BUG-{id}.md` with their own monotonically increasing ID sequence. The manifest tracks references between bugs and tasks but does not enforce a 1:1 relationship. WHEN a task fails verification, the CLI SHALL create a bug file with failure evidence and link it to the task via manifest refs. WHEN a failed task is re-dispatched, the architect SHALL be consulted first — receiving the task ticket and bug report to diagnose the root cause and append guidance to the task file.
  - *Rationale:* Independent bug tracking allows bugs to exist without originating tasks (operator-reported, discovered during change requests). Architect consultation on failures produces better fixes than blindly re-running the same agent.
  - Given verify fails task 5, When the CLI creates BUG-1.md, Then the manifest links BUG-1 to TASK-5 via refs.
  - Given task 5 is `failed` with BUG-1 linked, When develop re-dispatches, Then the architect is consulted with the task ticket + BUG-1.md before the developer agent runs.
  - Given an operator reports a bug not tied to any task, When BUG-2.md is created, Then it exists in `active/` with no task refs in the manifest.

### 4.20 Idea Refinement

- **REQ-IDEA-1:** WHEN the operator types `/idea` during a chat session, THE SYSTEM SHALL start a guided idea refinement flow. `/idea` with no argument SHALL prompt the operator to create a new idea or load an existing one. `/idea <id>` SHALL load `IDEA-<id>.md` from `.voidrift/ideas/` and resume refinement. The idea flow operates within the existing chat session — all chat tools remain available.
  - *Rationale:* Ideas are rough user stories that need structured conversation to become actionable. A guided flow inside chat formalizes the natural pattern of iterative refinement — the agent drives the conversation through stages rather than waiting for the operator to direct it.
  - Given a chat session is active, When the operator types `/idea`, Then the system prompts "Create new or load existing?"
  - Given a chat session is active, When the operator types `/idea 3`, Then IDEA-3.md is loaded and the agent summarizes the current state and asks what to refine.
  - Given `/idea 99` is typed and IDEA-99.md does not exist, When the system checks, Then an error is displayed and the chat prompt returns.

- **REQ-IDEA-2:** WHEN a new idea is created, THE SYSTEM SHALL guide the conversation through stages: (1) **Intake** — ask the operator to describe the idea at a high level; (2) **Exploration** — ask clarifying questions, reference existing requirements and architecture, challenge scope and assumptions; (3) **Shaping** — propose a structured user story, acceptance criteria, affected modules and files; (4) **Summary** — present the complete structured idea for operator review. The agent SHALL drive the conversation — it knows which stage it is in and what to ask next. The agent's system prompt SHALL include an idea-refinement overlay loaded from `resources/prompts/chat.md` section `IDEA`.
  - *Rationale:* Unguided conversations produce unstructured output. The staged flow ensures every idea reaches a consistent level of detail before it becomes a planning input. The agent driving the conversation prevents the operator from having to remember what comes next.
  - Given a new idea flow starts, When the agent responds, Then it asks the operator to describe the idea at a high level.
  - Given the operator has described the idea, When the agent responds, Then it asks clarifying questions referencing existing project artifacts.
  - Given exploration is complete, When the agent responds, Then it proposes a structured user story with acceptance criteria.

- **REQ-IDEA-3:** Ideas SHALL be stored as `IDEA-{id}.md` in `.voidrift/ideas/` with their own monotonically increasing ID sequence (`next_idea_id` in manifest). The manifest SHALL track ideas in an `ideas` section with status: `draft` (in progress), `now` (refined, high priority), `next` (refined, upcoming), `later` (parked), `done` (all derived tasks verified). The idea file SHALL contain: title, user story, context (references to requirements and architecture), acceptance criteria, affected modules, and affected files (when modifying existing behavior). WHEN `voidrift gather --idea <id>` completes, the idea file SHALL be updated with a `reqs:` field listing the requirement IDs created or modified, and a diff showing the changes to REQUIREMENTS.md. WHEN `/done` is typed during an idea flow, the agent SHALL ask the operator to categorize the idea as `now`, `next`, or `later`, write the final structured content to the idea file, register it in the manifest with the chosen category, and return to normal chat.
  - *Rationale:* Ideas are the operator's backlog. The now/next/later categorization gives the operator control over prioritization without a numeric priority field. Affected files are captured during exploration when the idea modifies existing behavior — this context helps the operator produce targeted requirements updates.
  - Given an idea flow completes, When the operator types `/done`, Then the agent asks "Is this now, next, or later?" and the idea is saved with the chosen category.
  - Given an idea flow is interrupted (operator types something else or `/quit`), When the session ends, Then the idea file contains whatever was last saved as `draft`.

- **REQ-IDEA-4:** Ideas are a backlog. They do NOT automatically feed into `voidrift plan`. WHEN the operator wants to act on an idea, they load it in chat via `/idea <id>` and use the conversation to create requirements (via `write_framework_file`) and task tickets manually. The now/next/later categorization is for the operator's own prioritization — the CLI does not consume ideas programmatically.
  - *Rationale:* Ideas are a lightweight way to track a backlog without overcomplicating the planning pipeline. The operator decides when and how to act on them through chat, keeping full control over what enters the planning and development workflow.
  - Given two `now` ideas exist, When `voidrift plan` runs, Then neither idea is included — plan reads only REQUIREMENTS.md and existing architecture.
  - Given the operator loads IDEA-3 in chat, When they refine it, Then they can use `write_framework_file` to create task tickets or update requirements directly.

- **REQ-IDEA-5:** WHEN `voidrift plan <model> --idea <id>` is run, THE SYSTEM SHALL read the idea file and include its content as planning context alongside REQUIREMENTS.md. Tasks produced by this plan run SHALL include `idea: <id>` in their frontmatter. The manifest SHALL record the idea reference on each task entry. WHEN all tasks with `idea: <id>` reach `verified` status, the CLI SHALL set the idea status to `done`, move the idea file from `ideas/` to `ideas/archived/`, and append to history.log. WHEN the idea file does not contain a `reqs:` field (requirements have not been generated via `voidrift gather --idea <id>`), THE SYSTEM SHALL exit with an error: "No requirements found for IDEA-<id>. Run 'voidrift gather <model> --idea <id>' first."
  - *Rationale:* Scoping plan to a single idea produces targeted tasks instead of re-planning the entire project. The idea reference on tasks closes the loop — the operator can trace from idea to requirements to tasks to implementation. Automatic archival when all derived tasks are verified keeps the active idea list clean.
  - Given IDEA-3 exists with status `now`, When `voidrift plan <model> --idea 3` runs, Then the planning agent receives IDEA-3 content in its context.
  - Given plan produces TASK-7 and TASK-8 from `--idea 3`, When the tasks are created, Then both task files have `idea: 3` in frontmatter and the manifest records the link.
  - Given TASK-7 and TASK-8 both reach `verified`, When the CLI checks idea status, Then IDEA-3 is set to `done` and moved to `ideas/archived/`.
  - Given TASK-7 is `verified` but TASK-8 is `implemented`, When the CLI checks, Then IDEA-3 remains active.

## 5. Non-Functional Requirements

- **Reliability:** Framework file writes SHALL be write-through (written to disk immediately, not buffered). The develop command SHALL use a lock file to prevent concurrent sessions. SIGTERM SHALL trigger graceful shutdown with cleanup.
- **Performance:** Local models SHALL be served via vLLM with FlashInfer backend. Framework resources (skills, prompts) SHALL be cached in process memory for sub-millisecond repeated access. Agents SHALL receive one task at a time to minimize context window usage.
- **Security:** The CLI SHALL NOT hardcode secrets. File operations SHALL be sandboxed to the project directory (path traversal denied).
- **Portability:** The framework SHALL run on Linux, macOS, and WSL2. Local model support requires an NVIDIA GPU worker node accessible via SSH and the Worker CLI. Cloud-only mode requires no special hardware or Worker CLI.
- **Maintainability:** All packages SHALL use `pyproject.toml` with hatchling, a shared `VERSION` file, and editable installs. Google-style docstrings and type hints SHALL be used throughout. Tests SHALL use pytest. `uv` SHALL be the package manager for all development operations (install, test, build); developers SHALL NOT need pip or python3 directly for project setup.

## 6. Verification Plan

| ID | Requirement | Method | Evidence Required |
|----|-------------|--------|-------------------|
| V-CTX-3 | REQ-TM-1 | Test | `test_manifest.py` — ManifestManager load, save, task registration |
| V-CTX-4 | REQ-TM-3 | Test | `test_manifest.py::TestDispatch` — dispatchable returns ready tasks |
| V-CTX-5 | REQ-TM-2 | Test | `test_manifest.py::TestStatusTransitions` — status changes and side effects |
| V-RES-1 | REQ-RES-6 | Test | `test_commands.py` — format variable substitution in prompt templates |
| V-ARCH-1 | REQ-ARCH-2 | Test | `test_commands.py::TestCLICommands` — subcommands exist |
| V-ARCH-2 | REQ-ARCH-4 | Test | `test_agent.py` — agent loop sends/receives messages |
| V-ARCH-3 | REQ-ARCH-6 | Test | `test_agent.py::TestBuildLocalTools` — tools present, skills pre-injected |
| V-ARCH-4 | REQ-ARCH-8 | Test | `test_agent.py` — think tags stripped from response, logged as `[THINKING]` |
| V-ARCH-5 | REQ-ARCH-9 | Test | `test_agent.py::TestBuildLocalTools` — command filtering returns correct tool subsets |
| V-ARCH-6a | REQ-ARCH-11 | Test | `test_agent.py::TestMaxTokensRecovery` — text truncation triggers continuation; tool truncation logged; exhaustion returns partial |
| V-G-1 | REQ-G-1 | Test | `test_commands.py::TestGatherPreflightChecks` |
| V-G-2 | REQ-G-11 | Test | `test_agent.py` — context length error detection |
| V-G-3 | REQ-G-12 | Inspection | `gather.py` — all gather agents use `stream=True` |
| V-P-1 | REQ-P-1 | Test | `test_commands.py::TestPlanPreflightChecks` — artifact production and retry |
| V-P-2 | REQ-P-3 | Test | `test_commands.py` — fresh-start deletes existing artifacts |
| V-SKL-1 | REQ-SKL-2 | Test | `test_skills.py` — project skill overrides domain; domain overrides north-star |
| V-SKL-2 | REQ-SKL-2 | Test | `test_skills.py` — missing skill returns None |
| V-CTX-1 | REQ-CTX-1 | Test | `test_skills.py` — find_skill 3-layer resolution, YAML frontmatter stripped |
| V-CTX-2 | REQ-CTX-5 | Test | `test_gather.py` — cached analysis used on hash match; re-analyzed on hash mismatch |
| V-SKL-3 | REQ-SKL-5 | Inspection | `voidrift skills install` writes to pending, not active domain-skills |
| V-SKL-4 | REQ-SKL-8 | Test | `voidrift skills list` groups output by layer |
| V-P-3 | REQ-P-6 | Analysis | Code review of generated TASKS.md for file ownership |
| V-P-4 | REQ-P-9 | Test | `test_commands.py` — invalid tags resolved by word-overlap or stripped; valid skills prompt includes descriptions |
| V-P-5 | REQ-P-11 | Test | `test_commands.py` — delta analysis runs when artifacts exist without `--overwrite`; fresh plan when absent; `--overwrite` clears artifacts before pipeline |
| V-G-10 | REQ-G-1 | Test | `test_commands.py` — gather update mode: existing REQUIREMENTS.md provided as context in final pass |
| V-D-1 | REQ-D-1 | Test | `test_commands.py::TestDevelopPreflightChecks::test_missing_tasks` |
| V-D-2 | REQ-D-2 | Test | `test_commands.py::TestDevelopPreflightChecks::test_all_tasks_complete` |
| V-D-3 | REQ-D-3 | Test | `test_commands.py::TestDevelopPreflightChecks::test_lock_file_stale` |
| V-D-4 | REQ-D-5 | Test | `test_commands.py` — no writes triggers retry, then escalation |
| V-D-5 | REQ-D-7 | Test | `test_commands.py` — max escalations blocks task and continues |
| V-D-5 | REQ-D-10 | Test | `test_commands.py::TestDevelopPreflightChecks::test_workers_without_modules` |
| V-D-6 | REQ-D-12 | Test | `test_commands.py` — workers without module headers falls back to single |
| V-D-7 | REQ-D-4 | Inspection | `develop.py::_develop_module` — task loop calls `task_store.get_next()`, skills pre-injected into system prompt at task-init time |
| V-D-8 | REQ-D-6 | Inspection | `develop.py::_consult_architect` — escalation prompt loaded directly from disk |
| V-D-9 | REQ-D-8 | Inspection | `develop.py::_consult_architect` — provides reqs + arch + task, no source files |
| V-D-10 | REQ-D-9 | Test | `test_manifest.py` — `set_status("implemented")` updates manifest after write verification |
| V-D-13 | REQ-TM-5 | Test | `test_manifest.py::TestArchive` — archived task moved to `archived/`, removed from manifest, history.log appended |
| V-D-11 | REQ-D-11 | Inspection | `develop.py::run_develop` — `threading.Lock` passed to all `_develop_module` calls, acquired around git ops |
| V-D-12 | REQ-D-13 | Inspection | `develop.py::run_develop` — SIGTERM/SIGINT set interrupted flag, lock cleaned in finally block |
| V-U-1 | REQ-U-1 | Test | `test_commands.py::TestCLICommands::test_status_command` |
| V-U-2 | REQ-U-2 | Test | `test_commands.py` — chat session loads skill, prompt, and --doc context |
| V-LOG-1 | REQ-LOG-4 | Test | `test_cli.py::test_system_log_created` — system log file exists after startup |
| V-ARCH-6 | REQ-ARCH-3 | Test | `test_cli.py::test_interactive_default_uses_active_model` — no hardcoded alias |
| V-MC-1 | REQ-MC-1 | Test | `test_models.py::TestResolveModel` — alias resolution from configured models file |
| V-MC-2 | REQ-MC-3 | Test | `test_models.py::TestMaxContext` — max_context from models file used when API returns no max_model_len |
| V-CFG-1 | REQ-CFG-6 | Test | `test_config.py` — get_max_tokens returns min(stage_default, model_cap); missing limits section uses defaults |
| V-CFG-2 | REQ-CFG-7 | Test | `test_config.py` — per-stage defaults: analysis=2000, task=4000, consolidation=8192 |
| V-CFG-3 | REQ-CFG-8 | Test | `test_cli.py::TestSetupCheck` — framework commands exit with setup error when models.yml missing; utility commands unaffected |
| V-G-4 | REQ-G-13 | Test | `test_commands.py` — local model large file chunked (not truncated); single chunk skips consolidation; cloud model not chunked |
| V-G-5 | REQ-G-14 | Inspection | `resources/prompts/gather.md` ANALYSIS section contains conciseness instruction |
| V-G-6 | REQ-G-15 | *(retired)* | Tool call output eliminated; JSON truncation no longer possible |
| V-G-7 | REQ-G-16 | *(retired)* | Superseded by REQ-G-8 direct response design |
| V-G-8 | REQ-G-8 | Test | `test_commands.py` — context build produces one summary per non-source category; source analysis injects context; final pass receives all requirements |
| V-G-9 | REQ-G-17 | Test | `test_commands.py` — context summary capped at 10 items; source agent user message contains "Project Context" section |
| V-ARCH-7 | REQ-ARCH-9 | Inspection | `agent.py` — develop per-task tool set excludes task orchestration tools; gather excludes dead analysis-store tools |
| V-U-3 | REQ-U-3 | Test | `test_commands.py::TestCLICommands::test_log_view` |
| V-U-4 | REQ-U-4 | Test | `test_commands.py::TestCLICommands::test_unlock_no_lock` |
| V-UI-1 | REQ-UI-4 | Test | `test_commands.py` — chat tools available on every turn |
| V-UI-2 | REQ-UI-5 | Test | `test_commands.py` — session log contains operator input and model responses |
| V-UI-3 | REQ-UI-10 | Inspection | `ui.py::stats_str` — all fields present when usage data available; no gating |
| V-MC-1 | REQ-MC-1 | Test | `test_models.py::TestResolveModel` — alias resolution from config |
| V-MC-2 | REQ-MC-2 | Test | `test_models.py::TestResolveModel::test_cloud_models` |
| V-U-8 | REQ-U-8 | Test | `test_commands.py::TestChatWebFetch` — cache hit skips HTTP, HTTP error returns message, summary cached after fetch, tool absent from non-chat commands |
| V-FSZ-1 | REQ-FSZ-1 | Test | `test_tools.py::TestReadGuard` — pagination warning returned when file exceeds limit; explicit limit/offset suppresses warning |
| V-FSZ-2 | REQ-FSZ-2 | Test | `test_tools.py::TestWriteGuard` — write rejected with error when content exceeds max_read_lines; write succeeds when within limit |
| V-FSZ-3 | REQ-FSZ-3 | Inspection | `resources/prompts/system.md` — contains file size guidance section covering pagination and decomposition |
| V-CFG-6a | REQ-CFG-6 | Test | `test_config.py::TestModelConfigDefaults` — ModelConfig carries operational limits with correct defaults |
| V-IDEA-5 | REQ-IDEA-5 | Test | `test_commands.py::TestPlanIdea` — idea content injected into planning context; missing reqs gates; tasks get idea frontmatter; manifest records idea; idea archived when all tasks verified |

---

## Appendix A: Project Artifact Structure

```
.voidrift/
├── REQUIREMENTS.md           # Project requirements
├── ARCHITECTURE.md           # Architecture reference
├── STATE.md                  # Project state summary
├── TASKS.md                  # Intermediate task list (parsed into task files by CLI)
├── ideas/                    # Operator-owned idea backlog
│   ├── IDEA-{id}.md
│   └── archived/             # Completed ideas (all derived tasks verified)
├── tasks/                    # System-owned work items
│   ├── manifest.yml          # Task status, dependencies, modules, idea tracking
│   ├── active/               # Task and bug tickets in progress
│   │   ├── TASK-{id}.md
│   │   └── BUG-{id}.md
│   ├── archived/             # Verified tasks and resolved bugs
│   └── history.log           # Lifecycle event log (append-only)
├── arch/                     # Module architecture (produced by Plan)
│   └── <module>.md
├── analysis/                 # Per-file source analysis (produced by Gather)
│   └── <filepath>.md
├── logs/                     # Command run logs
│   └── <command>-<timestamp>.log
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
| `haiku` | `anthropic/claude-haiku-4.5-20251001` | Cloud |
| `gemini` | `gemini/gemini-2.5-pro` | Cloud |
| `gemini-flash` | `gemini/gemini-2.5-flash` | Cloud |
| `kiro` | `auto` | Kiro Gateway — task-optimized model selector (default) |
| `kiro-opus` | `claude-opus-4.6` | Kiro Gateway — 1M context |
| `kiro-sonnet` | `claude-sonnet-4.6` | Kiro Gateway — 1M context |
| `kiro-opus-4.5` | `claude-opus-4.5` | Kiro Gateway |
| `kiro-sonnet-4.5` | `claude-sonnet-4.5` | Kiro Gateway |
| `kiro-sonnet-4` | `claude-sonnet-4` | Kiro Gateway — hybrid reasoning |
| `kiro-haiku` | `claude-haiku-4.5` | Kiro Gateway |
| `kiro-deepseek` | `deepseek-3.2` | Kiro Gateway |
| `kiro-minimax` | `minimax-m2.5` | Kiro Gateway |
| `kiro-minimax-2.1` | `minimax-m2.1` | Kiro Gateway |
| `kiro-qwen` | `qwen3-coder-next` | Kiro Gateway |
