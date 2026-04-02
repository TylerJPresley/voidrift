# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Project split:** Worker CLI extracted to separate project (`~/Projects/worker-cli/`). VoidRift no longer contains worker code, tests, or config. The only touchpoint is a single models file at a configurable path (`models_file` in config.yml, default `~/.worker-cli/models.yml`).
- **REQ-MC-1:** Model resolution reads from one external models file. No merging of multiple sources. Each entry is self-contained with `base_url`, `api_key`, `model_id`, and operational limits.
- **REQ-MC-3:** Models file supports a `defaults:` section. Each model entry inherits defaults and may override `max_tokens`, `max_context`, `max_read_lines`, `max_input_chars`, `concurrency`. No per-type inference.
- **REQ-CFG-6/7:** Operational limits read from model entries, not config.yml. `limits:` and `concurrency:` sections removed from config.yml. `get_max_tokens()` takes `ModelConfig` instead of `model_type`.
- **REQ-ARCH-1:** Two components (CLI + resources). Worker CLI is an external project.
- **REQ-CFG-2:** Config drops `worker:` and `kiro:` sections. Adds `models_file` key.
- **REQ-UI-10:** Agent stats lines (spinner progress and completion summaries) display elapsed time, token counts (`tkns: ↓ Nk - ↑ Nk`), context utilization (`ctx N%`), and status on every agent call across all commands. Fields omitted when the model response contains no usage data.
- **REQ-P-1:** Plan executes in two stages with separate agent instances. Stage 1 produces ARCHITECTURE.md and `arch/<module>.md` files. Stage 2 receives the architecture as input context and produces TASKS.md. Each stage starts with a clean message history. Stage prompts enumerate explicit numbered steps with upsert logic: read existing artifacts if present, update rather than regenerate, create if absent.
- **REQ-P-7:** Tasks are multi-line blocks: `- [ ] <summary>` header, indented `skills:` and `reqs:` metadata lines, followed by free-form description. Format defined in `resources/templates/TASK-FORMAT.md`. Eliminates false skill tag matches from code examples and JSON in task descriptions.
- **REQ-CTX-3:** Task store parses multi-line blocks with structured metadata extraction (`skills:`, `reqs:`). Block boundaries determined by unindented task markers or module headers.
- **REQ-P-9:** Skill tag validation parses `skills:` metadata lines instead of bracket regex. Case-insensitive. Invalid tags stripped per-line; entire line removed when all tags invalid.

### Added
- **REQ-ARCH-11:** Max output token recovery in the agent loop. Detects `finish_reason == "length"` on API responses. Text-only truncations trigger up to 2 continuation attempts with a resume prompt, concatenating partial responses. Tool call truncations are logged as warnings and processed normally. Logged as `[MAX_TOKENS_RECOVERY]`, `[MAX_TOKENS_TOOL_TRUNCATION]`, and `[MAX_TOKENS_EXHAUSTED]`.
- **Verify command — full rewrite (REQ-VF-3 through REQ-VF-16):** Two-stage requirements-driven acceptance testing. Stage 1: plan agent reads all project docs, writes `.voidrift/VERIFY-PLAN.md` with one self-contained test case per testable requirement. Stage 2: concurrent sub-agents (ThreadPoolExecutor, `get_concurrency()` limit) execute scenarios; failures write `.voidrift/bugs/<ITEM-ID>.md` with full evidence. Stage 3: orchestrator writes `VERIFY.md` summary table + verdict + STATE.md entry. `try/finally` guarantees cleanup of all processes, HTTP sessions, and browser sessions regardless of outcome.
- **`tools/process_manager.py` (REQ-VF-8 through REQ-VF-11):** Subprocess lifecycle management — `start_process(cmd, env, cwd)` returns opaque UUID handle; ring-buffered deque(maxlen=500) for stdout/stderr; `stop_process(handle)` SIGTERM→SIGKILL fallback after 5s; `wait_for_ready(handle, strategy, target, timeout)` with `http`, `port`, and `log_pattern` strategies; `read_process_output(handle)` returns up to 500 buffered lines; `run_command(cmd, cwd)` synchronous with stdout/stderr/exit_code JSON; `stop_all()` clears entire registry.
- **`tools/http_client.py` (REQ-VF-12):** Stateful HTTP client — per-session `_Session` with CookieJar and auth header persistence; `http_request(method, url, headers, body, session_id)` auto-persists `Authorization` header to session for subsequent calls; multiple named sessions per agent; `clear_sessions()` for cleanup.
- **`tools/browser.py`:** Playwright-based browser automation — `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_get_text`; lazy import with informative error when Playwright is not installed; session-scoped cleanup via `close_all_sessions()` and `close_session(session_id)`.
- **`cmd="verify-plan"` and `cmd="verify-execute"` tool sets (REQ-VF-16):** `build_local_tools(cmd="verify-plan")` exposes `{read_source_file, read_framework_file, write_framework_file}`; `build_local_tools(cmd="verify-execute")` exposes `{read_framework_file, write_framework_file, read_process_output, http_request, run_command, browser_navigate, browser_screenshot, browser_click, browser_get_text}` — no source file writes, no process lifecycle tools.
- **`resources/prompts/verify.md`:** PLAN section — 7-step plan agent process with ITEM format spec and SKIP classification rules. EXECUTE section — evidence collection instructions and full bug report format specification (Date, Run, Requirement, Steps, Expected/Actual, Process Output, Stack Trace, Screenshots, Timestamps, Notes).
- **REQ-VF-1/REQ-VF-2 (Plan integration):** Plan prompt updated to populate `startup_command:` (runnable projects) and `test_bootstrap:` (auth-required projects) in ARCHITECTURE.md, and to generate a test harness task in TASKS.md when auth is detected.
- **`resources/templates/ARCHITECTURE-TEMPLATE.md`:** Added `startup_command:` and `test_bootstrap:` fields with inline documentation comments.
- **Verify preflight guard (REQ-VF-P):** `voidrift verify` exits with clear error if `.voidrift/REQUIREMENTS.md` does not exist — no model call is made.
- **Test coverage for verify rewrite:** `test_commands.py` — `TestVerifyPreflight` (2), `TestVerifyPlanParsing` (3), `TestVerifyOrchestrator` (7); `test_verify_tools.py` — `TestProcessManager` (14), `TestHTTPSessionManager` (5), `TestBrowserTools` (3). Total: 256 tests passing.

### Changed
- **`cli/src/voidrift_cli/tools/` (package refactor):** `tools.py` moved to `tools/__init__.py` to allow `tools/process_manager.py`, `tools/http_client.py`, and `tools/browser.py` to coexist as a proper sub-package. All relative imports updated (`from . import x` → `from .. import x`).
- **Verify command signature:** `voidrift verify <model> [<architect>]` → `voidrift verify <model>` — architect argument removed; verify no longer consults a planning agent for fixes, it only reports.
- **Upsert pattern for `gather` and `plan` (REQ-G-1, REQ-P-11, REQ-P-13):** Commands no longer block when output artifacts already exist. `gather` re-runs the full four-stage pipeline and passes the existing `REQUIREMENTS.md` as context to the final consolidation pass, producing a merged update. `plan` auto-detects existing `ARCHITECTURE.md` + `TASKS.md` and switches to update mode automatically — completed tasks preserved, stale tasks removed, new tasks added. `--overwrite` is the explicit "start fresh" flag for both commands. `plan --update` flag removed; auto-detection replaces it.
- **`plan` max_tokens config compliance (REQ-CFG-7):** `plan.py` was using hardcoded `max_tokens=32768`; changed to `get_max_tokens(model.model_type, "plan")` so local model caps from `config.yml` are respected.
- **TASKS-DONE.md log (REQ-D-14):** Completed tasks are removed from `TASKS.md` and appended to `TASKS-DONE.md` with an ISO 8601 timestamp. `TaskStore.complete()` handles the move. `TASKS.md` is a pure pending/blocked work queue; `TASKS-DONE.md` is an append-only CLI-written log. Plan update reads source code to determine delta — it does not read `TASKS-DONE.md`. 13 new `test_task_store.py` tests cover removal, append, timestamp, multi-task, and multi-module scenarios.

### Changed
- **Terminology overhaul (docs, prompts, and code):** "phases" → "framework commands" and "tools" (when referring to CLI subcommands) → "agent tools" throughout all `.md` files, all `.py` source files, and all test files. "Phase flow" table in system.md relabeled "Framework commands". OpenAI API terms (`tool_choice`, tool calls) preserved as-is. Python parameter `phase=` renamed to `cmd=` in `build_local_tools()`; `phase=` renamed to `stage=` in `get_max_tokens()`. `phases/` directory renamed to `commands/`; `test_phases.py` renamed to `test_commands.py`.
- **MCP Context Server removed:** All MCP server references cleaned from code docstrings, docs, skills, ARCHITECTURE.md, START.md, README.md, CHANGELOG.md, pyproject.toml. `build_mcp_tools()` references updated to `build_local_tools()`. Agent tools are CLI-native (in-process) — no subprocess server. `pyproject.toml` testpaths/pythonpath no longer reference `mcp-context-server/tests/`.
- **REQ-LOG-4 (updated):** Framework system log path (`~/.voidrift/logs/voidrift.log`) is now hardcoded — `VOIDRIFT_HOME` does not affect it. Framework logs are user-global, not project-scoped.
- **REQ-CFG-7:** Per-phase default terminology → "per-stage defaults" (these are internal agent stages — triage, analysis, synthesis, consolidation, task, plan — not CLI commands). Section 4.16 rationale and acceptance criteria updated.
- **REQ-V-4:** Verify command no longer produces `TASKS-fixes.md` or consults an architect — it reports issues only. VERIFY.md is the sole output artifact.

### Added
- **REQ-G-1 (updated):** Gather preflight guard — validates `<path>` exists and is a directory before any model call; exits with error on invalid path.
- **REQ-P-13 (new):** Plan preflight guard — requires `.voidrift/REQUIREMENTS.md` to exist; exits with error if ARCHITECTURE.md or TASKS.md already exist without `--overwrite` or `--update`.
- **REQ-A-5 (new):** Automate preflight guard — requires both `.voidrift/REQUIREMENTS.md` and `.voidrift/ARCHITECTURE.md` before any model call.
- **REQ-V-5 (new):** Verify preflight guard — requires `.voidrift/REQUIREMENTS.md` before any model call.

### Added (existing)
- **REQ-CTX-5:** Gather command now caches per-file source analyses in `.voidrift/cache/analyses/<sha256>.json`. On subsequent runs, unchanged files (same content hash) are skipped — no model call made. Cache is written after successful analysis (including post-consolidation for chunked files). Plain `voidrift prune` does not clear the cache; only `prune --all` does (wipes entire `.voidrift/`). REQ-U-6 updated accordingly. 8 new tests in `test_gather.py` (V-CTX-2).

### Changed
- **REQ-ARCH-6/REQ-ARCH-9 (plan):** Architecture template is now pre-injected into the plan agent's system prompt at command init instead of being served as `get_template`/`list_templates` callable tools. Removes both tools from the plan toolset. Fixes a stall pattern where the model confused `list_templates` with `list_skills`, went off-script exploring templates, hit the stall detector, and failed to write TASKS.md. Template content is always in context — no tool round-trip needed.

### Changed
- **REQ-UI-10:** Stats display is now verbose-gated. Without `--verbose`, spinner and summary lines show only elapsed and status. `--verbose` (`-v`) flag on the top-level `voidrift` command reveals `tkns: ↓ Nk - ↑ Nk` and `ctx N%`. Exception: `ctx N%` is always shown when ctx ≥ 80% regardless of verbose mode (context pressure warning). Applies to all framework commands and chat.
- **REQ-G-12:** All gather agents switched to `stream=True`. `<think>` stripping (REQ-ARCH-8) and the streaming think-buffer handler resolve the original formatting concern. Streaming enables live token telemetry (REQ-UI-10) for triage, context build, and consolidation stages which were previously dark.
- **REQ-UI-10:** `_Spinner.__exit__` now flushes a final `update(done=True)` before closing so token data captured at response end persists in the terminal. Final persisted line omits the "thinking" suffix; shows "prepping" when no data is available yet.

### Added
- **REQ-UI-10:** Spinner telemetry — all model API calls (streaming and non-streaming, all framework commands including chat) show elapsed time, prompt token count (↓), completion token count (↑), and context window utilization (ctx N%) in the spinner while waiting. Format: `Label... (1m 3s · ↓ 1.1k tokens · ↑ 42 tokens · ctx 23% · thinking)`. Display driven by a 250ms background timer in `AgentLoop` via an `on_progress` callback; all command spinners (`spinner()`) and the chat `Live` block wire to this callback. Stats reset per spinner block (per task in develop, per call in plan/automate/verify). `_Spinner` context manager added to `ui.py`; `elapsed_str()` and `token_str()` helpers added.

### Added
- **REQ-UI-7:** Chat streaming uses a single Rich `Live` block with three progressive states: `Thinking...` spinner → dim 5-line streaming tail window → full Rich Markdown final render. Blank line precedes the block. Tool call names are suppressed.
- **REQ-UI-8:** Chat responses are auto-detected for markdown content (headings, bold, fences, tables, bullets, numbered lists, inline code, blockquotes, links) and rendered via Rich Markdown. Plain text falls through to indented plain text.
- **REQ-UI-9:** Terminal ECHO + ICANON disabled during `agent.send()` to prevent keystrokes appearing in the Live display. Restored on exit (success or error). Temporarily restored for `web_fetch` confirmation prompt (REQ-U-8) so the operator can see and type their response.
- **REQ-U-7 / REQ-UI-6:** Context window auto-compact at 95% — fires automatically before sending to the model, prints "Context window at 95% — auto-compacting..." (no operator action needed). Compact nudge threshold changed from 80% → 70%. Nudge resets after any compact so it can fire again if context refills. `/compact` handler extracted to `_do_compact()` helper shared with auto-compact.
- **REQ-ARCH-4 / REQ-UI-7:** Spinner labels randomized from `~/.voidrift/spinner-labels.txt` (100 playful gerunds across genuine, nerdy, chaotic, and dev-culture categories). `make sync` installs default file; user edits are preserved. All framework command agent loops now use `show_spinner=False` to suppress the internal stderr spinner when a `Status` block already owns the display — eliminates double-spinner artifact. All gather/plan/develop/verify/automate command agent calls wrapped in `Status` so cursor never blinks unattended. `voidrift log chat` added to log command.
- **REQ-FSZ-4:** Duplicate write guard now compares content rather than tracking path alone.
- **REQ-P-10:** Plan command no longer injects the full ARCHITECTURE-TEMPLATE into the system prompt. ARCHITECTURE.md is now guided by a concise four-section structure (overview, module map, cross-cutting concerns, decision log) inline in the plan prompt. Per-module detail remains in `arch/<module>.md`. Eliminates 10+ minute plan runs caused by local models filling in all 14 arc42 sections. A second write to the same path is only rejected when the new content is byte-for-byte identical to what's on disk — allowing stub corrections and incremental updates while still blocking true model loops.

### Changed
- **REQ-UI-3:** Chat multiline input changed from "blank line to submit" to `\` + Enter for line continuation; Enter always submits.
- **REQ-ARCH-4:** `Thinking...` spinner in chat command now uses Rich `Live` on stdout; automated framework commands continue to use stderr spinner.
- **REQ-U-8:** `web_fetch` confirmation prompt temporarily restores terminal to normal input mode before displaying, then re-disables after operator responds.

### Changed
- Makefile `test` and `install` targets now use `uv` instead of `python3`/`pip`; `cli/README.md` install instructions updated to `uv pip install -e .`
- `make setup` target added — runs `install` then `sync` as a single onboarding command
- Default config assets (`config.yml`, `models.yml`, `worker-models.yml`) moved from repo root to `defaults/`; `make sync` updated accordingly
- `make sync` now also creates `~/.voidrift/domain-skills/` (REQ-CFG-3) — previously omitted, causing skills system to reference a non-existent directory
- Test suite `VOIDRIFT_HOME` fixture updated to use `~/.voidrift` (the actual runtime location per REQ-CFG-4) instead of the repo root; CI environments must set `VOIDRIFT_HOME` explicitly

### Added
- Framework commands (`gather`, `plan`, `develop`, `automate`, `verify`, `chat`) now check for `~/.voidrift/models.yml` at startup and exit with a clear "Run 'make setup'" error if missing (REQ-CFG-8); utility commands (`status`, `log`, `prune`, `unlock`, `completions`, `skills`) are unaffected

### Added
- `web_fetch(url)` tool for `voidrift chat` (REQ-U-8) — fetches a URL, strips HTML markup, summarises content via an isolated sub-agent (raw page content never enters the chat context window), caches the summary in memory for the session. HTTP/DNS/timeout errors return a message rather than raising. Available in the chat command only.
- `WEB-RESEARCH` north-star skill (`resources/skills/WEB-RESEARCH.md`) — guidelines for effective web research using `web_fetch`: DuckDuckGo HTML search URL construction, direct documentation URL patterns (PyPI, Python docs, MDN, GitHub), two-step search-then-fetch navigation, source priority, and caching behaviour.
- Chat SYSTEM prompt now lists `web_fetch(url)` in available tools and instructs the model to load `WEB-RESEARCH` skill before searching.

### Changed
- **Gather pipeline redesigned** (REQ-G-8): source code is now the primary requirements source; non-source files (tests, config, infrastructure, docs, assets) are treated as context. Four-stage pipeline: (1) Triage — unchanged; (2) Context Build — one agent per non-source category, direct response ≤10 bullet items, stored in `context_summaries` dict; (3) Source Analysis — one agent per source file, `read_source_file()` only tool, "Project Context" block injected from Stage 2, direct response stored in `source_requirements` dict; (4) Final Pass — CLI pre-fetches REQUIREMENTS template, sends all source requirements + context in user message to a tool-less agent, model returns markdown directly, CLI strips preamble and writes `REQUIREMENTS.md`. Eliminates synthesis loop and all tool-call-embedded output — JSON truncation failure mode is no longer possible.
- Gather `ANALYSIS.md` now indexes only source file analyses (not all categories); context summaries appended as a dedicated section.
- Gather prompts: added `## CONTEXT-BUILD` section; rewrote `## ANALYSIS` (direct response, source only); removed `## SYNTHESIS`; updated `## CONSOLIDATION` (direct response, no tools, source takes precedence).

### Added
- `voidrift skills` command group with six subcommands: `list`, `search`, `review`, `install`, `remove`, `approve` (REQ-SKL-1 through REQ-SKL-5) — manages skills across north-star, domain, and project layers from the CLI; `install` runs synthesis pipeline when `skills.repos` and `skills.synthesis_model` are configured, otherwise copies from local layer; `search` queries repo manifests in addition to local layers (REQ-SKL-6); `review` lists pending skills when no name given
- `resources/skills/BACKEND-ENG.md` — north-star skill for VoidRift framework development (Python/Click/agent tools/pytest/AgentLoop conventions); use `[backend-eng]` tag on framework development tasks
- Per-stage `max_tokens` budget via `get_max_tokens(model_type, stage)` (REQ-CFG-6, REQ-CFG-7) — analysis=2000, synthesis=2000, consolidation=8192, task=4000, triage=4096, plan=32768; configurable per model type in `limits:` section of config.yml
- Gather operator analysis output: `.voidrift/ANALYSIS.md` (index — categories, file counts, links) + `.voidrift/analysis/<source-path>.md` (one file per analyzed source file, mirroring source tree structure); path printed on completion for immediate access
- Per-model input chunking via `get_max_input_chars(model_type)` — local models split files into 8000-char overlapping chunks (200-char overlap) instead of truncating; each chunk analyzed separately, multi-chunk results consolidated before storage; cloud/gateway unlimited (REQ-G-13)
- REQ-G-16: Stage 4 consolidation agent now receives extracted requirements in the user message instead of the system prompt — keeps system prompt small and maximises output budget for the generated REQUIREMENTS.md

### Fixed
- Gather Stage 4 consolidation: extended REQ-G-15 truncated JSON retry to cover consolidation in addition to per-file analysis; on 400 "Invalid JSON / EOF" the consolidation retries with halved `max_tokens` and a conciseness hint
- Gather auto-retry on truncated JSON: detects "Invalid JSON / EOF while parsing" 400 errors, retries with `max_tokens // 2` and a 5-bullet brief prompt (REQ-G-15)
- Config helper tests (`cli/tests/test_config.py`) — 14 tests covering `get_max_tokens` and `get_max_input_chars` across all model types, stages, and config overrides

### Fixed
- Gather: replaced `"gitwildmatch"` with `"gitignore"` in `_build_file_tree()` — suppresses pathspec DeprecationWarning
- Gather: analysis/synthesis agents now use lens-only system prompts (not full ANALYSIS-REQS + system_context blob) — reduces context usage for local models per REQ-G-8
- Gather: conciseness constraint added to ANALYSIS prompt — max 15 bullet points, requirements-relevant only (REQ-G-14)
- Develop: removed `load_tasks`, `get_next_task`, `complete_task`, `get_task_status` from per-task developer agent tool set — these are called via Python API by the outer loop, not by the agent; narrows agent surface per REQ-ARCH-9
- Develop: removed `system_context` pre-load prepended to `dev_prompt_tpl` — agents fetch context on demand via agent tools per REQ-D-4
- Develop: removed skill pre-loading from `_develop_module` — skills are now fetched on demand via `get_skill()` when the agent reads the task prompt step; updated TASK prompt to explicit step 3 (`get_skill("name")` on demand)
- Develop: added explicit "Do NOT call complete_task()" instruction to TASK prompt (REQ-D-9 AC)
- Gather: promoted `_is_truncated_json_error` to module level for testability (REQ-G-15)
- Tests: added V-G-4 (input truncation) and V-G-6 (retry on 400) test classes — 8 new tests covering REQ-G-13 and REQ-G-15

### Changed
- `get_skill()` now searches three layers in order: project (`.voidrift/skills/`) → domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`) per REQ-SKL-2; project skills fully replace lower-layer skills with same name
- `list_skills()` now returns all skills grouped by layer (North Star, Domain, Domain pending, Project) per REQ-SKL-8
- All 16 north-star skill files in `resources/skills/` now include YAML frontmatter (`name`, `description` fields)

### Added
- `DOMAIN-SKILL-TEMPLATE.md` — authoring guide and format definition for domain skills; used by synthesis agent during `voidrift skills install` (REQ-SKL-7)
- Skills system requirements (REQ-SKL-1 through REQ-SKL-8) — two-layer skill architecture (north-star global + domain/project), three-layer `get_skill()` search order with project overrides, `voidrift skills` subcommand group, synthesis pipeline via configured model and repos, pending/approve workflow, `DOMAIN-SKILL-TEMPLATE.md`
- Agent loop retry logic with exponential backoff (REQ-ARCH-10) — retries on connection errors, HTTP 5xx, and 429 rate limits; 3 attempts, 1s base delay, 2× multiplier, 30s cap; no retry on auth errors or context length errors; each retry logged to command log
- `ARCHITECTURE.md` at repo root — documents bounded contexts, component responsibilities, data flows, key design decisions, and state/persistence summary; referenced from README.md and START.md documentation checklist

### Fixed
- Develop: removed dead reads of `ARCHITECTURE.md` and `REQUIREMENTS.md` in `_develop_module` — variables were passed as unused kwargs to `.format()` since the TASK template has no `{architecture}` or `{requirements}` placeholders; model loads context on demand via `read_framework_file()` per REQ-D-4
- Gather synthesis: expanded to all categories (was source-only) — tests, config, infrastructure, documentation, and assets now produce structured EARS requirements via `store_requirements()` before consolidation; consolidation receives uniform structured input instead of a source/raw-analysis split
- Gather synthesis: replaced hardcoded source lens string with `_ANALYSIS_LENS.get(cat)` — each category now gets its full category-specific analysis lens matching the analysis stage
- Plan: extracted duplicate task format block to `_TASK_FORMAT` constant in plan.py — single source of truth injected into both PLAN and PLAN-UPDATE via `{task_format}` format variable
- Chat SYSTEM: rephrased "STOP" directive to positive instruction — "wait for the operator's response before continuing"
- Chat DOC: expanded from 3 lines to include editing guidance — targeted changes, structural preservation, requirements alignment, full-file write instruction, confirm-before-write

### Added
- Develop command writes STATE.md entry on completion (REQ-PS-3) — session-level file tracking via `_session_files` in tools.py, aggregated across per-task resets; `append_state` called at run_develop exit
- Static context window fallback table for cloud models (Anthropic 200K, Gemini 1M) — enables context% display and `/compact` 10% ceiling when model endpoint doesn't expose `max_model_len`
- `VERIFY.md` and corrected `STATE.md` entries in system.md artifact table — STATE.md is produced by Gather, Plan, and Develop; ARCHITECTURE.md consumed by Develop

### Changed
- Interactive mode (`voidrift` with no args) now prompts for path when gather is selected (REQ-ARCH-3) — was crashing with missing argument error
- Log truncation increased from 500 to 2000 chars for system prompt, user messages, and tool results — improves post-run debugging of synthesis and complex prompts

### Added
- Image source management for worker-cli (REQ-WK-13, REQ-WK-13a)
  - `worker-images.yml` config with `git` and `docker` source types
  - `worker images list` — show sources and Docker images on worker
  - `worker images add <alias> <url>` — auto-detect type, clone+build or pull
  - `worker images remove <alias> [--force]` — delete all assets from worker
  - `worker images update <alias>` — git pull+rebuild or docker pull
  - `worker images build <alias>` — explicit rebuild for git sources
- Recipe-based model launching (REQ-WK-8) — `worker start` uses `run-recipe.sh` for git image sources with recipes
- Active container state tracking (`~/.voidrift/.active-container`) — `bench`, `status`, `stop`, `logs` work with any container name
- `--served-model-name` and `vllm_args` forwarded to recipes as extra args via `--`
- `image_source` and `recipe` fields on `ModelConfig`
- Per-command agent tool filtering in `build_local_tools()` (REQ-ARCH-9) — each command sees only relevant agent tools
- Domain-separated filesystem tools — `write_source_file`/`read_source_file` for project tree, `write_framework_file`/`read_framework_file` for `.voidrift/` artifacts. Structural separation replaces runtime path guards.
- Module architecture files (REQ-P-1) — Plan produces `arch/<module>.md` with component internals, data models, interfaces (exposed and consumed). Module names match TASKS.md headers.
- Developer on-demand context loading (REQ-D-4) — developer agent loads `arch/<module>.md` and `spec/<module>.md` via `read_framework_file` tool calls during execution, not pre-loaded in system prompt
- Stall nudge mechanism (REQ-ARCH-4) — model gets 2 nudges before write tools are kept and read tools stripped
- Direct skill tag stripping in plan command (REQ-P-9) — invalid tags removed deterministically
- Valid skill names injected into plan prompt (REQ-P-9) — model can't invent nonexistent tags
- `/compact` command in chat (REQ-U-7) — summarizes conversation history to free context, result ≤10% of context window
- Context window percentage in chat prompt (REQ-UI-6) — `[25%] >` with white/yellow/red color thresholds
- Log file access blocked from model — `read_source_file` rejects `.voidrift/logs/` paths, `list_project_artifacts` excludes logs
- Placeholder content rejection — `write_source_file`/`write_framework_file` reject `"..."`, `"TODO"`, empty content
- Duplicate write guard — both write tools prevent overwriting files already written this run
- Shared framework context via `system.md` (REQ-RES-7) — command lifecycle, artifact manifest with producer/consumer/role, prepended to all command prompts
- Plan prompt produces `arch/<module>.md` for multi-module projects — module design detail with cross-module interface contracts

### Changed
- `write_file` split into `write_source_file` + `write_framework_file` — domain boundary is structural, no runtime path guards
- `read_framework_file` added for `.voidrift/` artifact access
- `--fresh-start` clears `arch/` instead of `spec/` (REQ-P-3) — gather-produced specs preserved
- Plan prompt step sequence reordered — `get_template` fetched right before architecture write, `list_skills` fetched right before task write, prevents context burial
- All prompt files use positive instructions only — no "NEVER", "do NOT", "don't"
- Prompt role lines standardized — `**Role:** <title> — <one-line description>` format across all framework commands
- Chat tool results show only tool name (`✓ get_requirements`) instead of full content
- Chat token stats print after response, not before
- Chat spinner runs continuously — starts on submit, restarts after tool results, stops before render
- Chat model responses use default terminal color (was blue) — visual distinction from `◆` label and padding
- Tool descriptions reference discovery tools (`list_skills()`, `list_templates()`, `list_prompts()`) instead of hardcoded examples
- Recipe launches use `Popen` (non-blocking) instead of `ssh_stream` — recipes run vLLM in foreground
- Recipe SSH output redirected to DEVNULL — no log bleed into terminal after startup
- Container stop adds `docker rm -f` and 3s wait for GPU memory release
- Streaming think-tag filter variables initialized before `try` block — fixes `UnboundLocalError` on API failure
- `get_requirements` removed from plan command agent tools — requirements already injected in system prompt
- REQ-P-12 narrowed — tasks SHALL NOT target `.voidrift/` paths; dot-prefixed project config files (`.github/`, `.dockerignore`) are valid develop targets
- qwen35 tool call parser changed from `qwen3_coder` to `qwen3_xml` to match unsloth chat template format
- README: Available Models updated (qwen35, qwen25 replace retired models), Per-Command Prompt Architecture replaces Three-Role System, agent tools table updated (20 tools with signatures), retired models section added, per-command agent tool filtering table added

### Removed
- `on_token` partial tool call text leak — handler changed to no-op in chat
- Duplicate tool display in chat — removed `tool_start()` call, only `✓` line on completion
- Hardcoded examples from tool parameter descriptions (`e.g. 'backend'` etc.)
- Dead code: unused `_token_handler = ui.make_token_handler()` in chat loop
- Three-role system (analyst/architect/developer) references from README and docs

### Added
- `tool_choice` parameter on AgentLoop — `"required"` (default) for automated framework commands, `"auto"` for chat (REQ-ARCH-4)
- Streaming think-tag filter — buffers tokens inside `<think>` blocks, handles orphaned `</think>` with 200-char flush threshold (REQ-ARCH-8)
- REQ-P-12: tasks must target project source files only — no dot-prefixed paths (`.voidrift/`, `.git/`, etc.)
- `.gitignore` support in gather file tree — excludes gitignored paths before triage sees them (REQ-G-8)
- `pathspec` dependency for `.gitignore` pattern matching
- Write prefix guard on `write_file()` — gather, plan, and chat auto-correct paths to `.voidrift/`
- `model_text()` in `ui.py` for printing complete non-streamed responses in light blue with 2-space indent

### Changed
- Chat uses `tool_choice: "auto"` and streaming — model decides when to call tools, tokens display as they arrive (REQ-U-2)
- Task completion managed by framework, not model — develop prompt says "Do NOT call complete_task()" (REQ-D-9)
- Chat system prompt constrains writes to `.voidrift/` paths only
- REQ-G-8 triage: dot-filtering now covers files and directories (was directories only)
- REQ-G-8 synthesis: specs must be derived exclusively from analyses — no invented paths or behaviors
- Plan and plan-update prompts: task file paths must not start with `.`

### Added
- Three-layer prompt architecture across all framework commands (REQ-RES-7): skill + prompt + context
  - `resources/prompts/chat.md` — interactive session prompts (SYSTEM, DOC, DOC-NEW)
  - `resources/prompts/plan.md` — architecture planning prompts (PLAN, PLAN-UPDATE)
  - `resources/prompts/develop.md` — task execution and escalation prompts (TASK, ESCALATION)
- Skill tag validation after plan (REQ-P-9): invalid tags sent back to model for one fix attempt
- Architecture template to arc42 standard with C4 diagram placeholders (REQ-P-10)
- Standard references in templates: arc42+C4 for architecture, IEEE 29148+EARS+BDD for requirements
- Write verification in develop (REQ-D-5): write_file() call counter + git diff advisory
- Graceful shutdown in develop (REQ-D-13): SIGTERM/SIGINT set interrupted flag, clean exit
- Concurrent multi-module develop via ThreadPoolExecutor + get_concurrency() (REQ-D-10)
- Git operation lock for concurrent workers (REQ-D-11)
- Full ARCHITECTURE.md injected into developer task prompt (REQ-D-4)
- BDD acceptance criteria on all develop, plan, chat, and worker CLI requirements
- Non-streaming mode for gather synthesis stages (REQ-G-12) — reliable tool call parsing
- Non-streaming mode for all framework commands (REQ-ARCH-4) — vLLM streaming parser unreliable for tool calls
- Think tag stripping from model responses (REQ-ARCH-8) — `<think>` content logged, not displayed
- Qwen 3.5 model configs: qwen35 (35B-A3B, 262K context), qwen35-perf (122B-A10B, 65K context)

### Changed
- Develop concurrency from config, not CLI flag — `get_concurrency()` used by both gather and develop
- Gather analysis max_tokens bumped from 4096 to 16384 — prevents truncated tool call JSON on large files
- Gather analysis prompt tightened — explicit tool call sequence, no redundant skill lookups
- Gather analysis tools reduced to read_source_file + store_file_analysis only — skill already in system prompt
- All framework commands use `stream=False` — streaming retained in code for future use
- Worker bench command uses `vllm bench serve` with `random` dataset
- Chat prompt generalized — not analyst-specific, model self-serves domain skills via `get_skill()`
- Four-stage gather `--from` pipeline with auto-detected logical boundaries (REQ-G-8)
  - Triage detects groups (e.g. frontend, backend) from directory structure
  - Per-group synthesis agents write focused spec files to `.voidrift/spec/<group>.md`
  - Overview agent writes project-level REQUIREMENTS.md referencing specs
  - Single-group codebases collapse to one thorough REQUIREMENTS.md
- `voidrift prune` command — clean ephemeral data with configurable retention (REQ-U-6)
  - `prune` — project logs beyond retention limit (default: keep 5)
  - `prune --all` — all project ephemeral data (escalations, architect_responses, logs, stale lock)
  - `prune --global` — framework SessionStore beyond retention limit (default: 30 days)
  - `prune --global --all` — all framework session data
- `retention:` config section with `project` and `global` limits (REQ-CFG-5)
- Run ID correlation for all framework commands — log filename stem serves as run ID
- `boot_run()` utility returns `(log_path, run_id)` for all framework commands
- Shared interactive terminal UI for gather and chat commands (REQ-UI-1–4)
  - Light blue indented model responses, dim model label with `◆` marker
  - `prompt_toolkit` multi-line input (Enter for newlines, blank line to submit)
  - Dim stats line (token count, tok/s, elapsed) after each response
  - Horizontal rule between turns
  - `/write` command in gather to enable file tools for one turn

### Changed
- Ephemeral data (analyses, escalations) now memory-only — no disk write-through
- Analyses (file summaries from gather --from) are memory-only — no disk write-through
- Gather and chat use plain terminal flow instead of Textual TUI — no alternate screen buffer
- Replaced `textual` dependency with `prompt_toolkit`
- Tools disabled by default in gather to prevent model thinking-token overhead

### Removed
- `tui.py` — Textual TUI module (replaced by shared `_interactive_loop`)
- `textual` dependency
- Retired qwen3-8b, qwen3-coder, qwen3-coder-next, qwen3-instruct, qwen3-instruct-think models — replaced by qwen35 series

- `worker-cli/` package — manages local model containers and Kiro Gateway (`worker` command)
- `models.yml` — unified model endpoint config (alias → base_url, api_key, model_id)
- Worker CLI commands: `worker start`, `stop`, `status`, `check`, `logs`, `info`, `models list/add/remove/check`, `images pull/list`, `cache clear`, `bench`, `kiro start/stop/status`
- `worker completions <shell>` and `voidrift completions <shell>` — tab completion for bash/zsh/fish
- Model alias tab completion on all model/worker/architect arguments in both CLIs
- Thinking spinner while waiting for model responses (clears on first token)
- Interactive gather: bold blue operator text, multi-line input (trailing `\`), line editing via readline
- Command log path displayed after title in all framework commands
- `TaskStore` — parses single TASKS.md with `## Module:` headers into per-module queues with write-through to disk
- Agent tools: `load_tasks`, `get_next_task`, `complete_task`, `get_task_status` for task management
- Agent tools: `get_agent(role, topic)`, `get_template(name)` for targeted resource retrieval
- Write-through `ArtifactStore` — stores to memory and disk simultaneously, disk fallback on cache miss
- IEEE 29148 rationale annotations on key requirements (replaces ADRs)

### Changed
- CLI is now model-agnostic — resolves aliases to endpoint URLs, no SSH/docker/gateway management
- `models.py` rewritten: pure alias→URL resolution from `models.yml` (was: SSH, docker, container lifecycle)
- Worker model commands simplified: `list`, `add`, `remove`, `check` (was 8 commands)
- `worker stop` accepts optional alias argument (ignored — always stops active container)
- `worker logs [-f]` always shows interactive container picker with status
- `gather --from` loads REQUIREMENTS-TEMPLATE and skills (PROD-STRATEGY, QUALITY-QA) into system prompt
- Interactive gather loads existing requirements into system prompt (was: user message causing tool-call loops)
- Interactive gather limited to `write_file` tool only (was: all 16 agent tools causing infinite loops)
- Analyst prompt instructs concise responses — few questions per turn
- Interactive gather capped at 4096 max_tokens to prevent multi-minute responses
- Analyst prompt instructs concise responses — few questions per turn
- Docker run command includes `vllm serve` and `-e HF_TOKEN` for gated models
- Command logs moved to `.voidrift/logs/` subdirectory
- `huggingface-cli` references updated to `uvx --from huggingface_hub hf`
- Kiro model IDs fixed: dots not dashes (`claude-sonnet-4.5` not `claude-sonnet-4-5`)
- `bench` command moved from `voidrift` to `worker` CLI
- `--refresh` flag moved from framework commands to `worker start --refresh`
- REQUIREMENTS.md migrated to IEEE 29148 / EARS notation (1027 → 248 lines)
- Architecture: three components (cli, worker-cli, resources)
- Single `TASKS.md` with `## Module:` headers replaces multiple `TASKS-<module>.md` files
- CLI delegates all task management via Python API (`get_next_task`, `complete_task`, `block`)
- `check_task_files()` returns `tuple[Path | None, bool]` instead of list of paths
- `ArtifactStore` takes `voidrift_dir` parameter for disk persistence
- Module system generalized — no hardcoded module names, file ownership constraint
- "subproject" terminology replaced with "module" throughout
- Resources reorganized: `resources/agents/`, `resources/skills/`, `resources/templates/`

### Fixed
- Both CLIs catch all exceptions — no Python tracebacks ever shown to user
- Unknown commands show error + help text instead of traceback
- Connection errors in interactive gather return to prompt instead of killing session
- Spinner always stops on error (try/finally cleanup)
- Newline between streamed text chunks before tool call handling
- Empty `KIRO_API_KEY` caught before request with clean error message
- Gateway health check catches `ReadError` during startup
- `gather --from` reads files from source codebase (was: resolving relative to project dir)
- Removed stale env var references from README (`$WORKER_USR`, `$WORKER_IP`, etc.)
- Removed `VOIDRIFT_PROJECT_DIR` — always uses `Path.cwd()`

### Removed
- `ensure_model_ready()` / `cleanup_model()` from CLI and all command files — worker-cli handles this
- `bench` command from VoidRift CLI — moved to worker-cli
- `--refresh` flag from all framework commands — use `worker start --refresh` instead
- ADR directory and ADR-TEMPLATE.md — rationale lives inline in REQUIREMENTS.md
- `get_next_task()` and `mark_task()` from CLI utils — now called via Python API by outer loop
- `get_framework_resource()` agent tool — replaced by `get_agent()` and `get_template()`
- `get_conventions()` agent tool — CONVENTIONS.md deleted from resources
- `--parallel`, `--retry`, `--overwrite` CLI flags — replaced by config-based concurrency
- `_develop_parallel()`, `_develop_loop()`, `_develop_sequential()` — replaced by `_develop_module()`
- Worktree-based parallel execution (AC-D36 through AC-D53)
- Multiple `TASKS-<module>.md` file pattern

## [0.1.0] - 2026-03-15

### Added
- CLI package (`voidrift-cli`) with Click-based command interface
- MCP Context Server (`voidrift-mcp-context-server`) with FastMCP
- Five framework commands: gather, plan, develop, automate, verify
- Utility commands: status, chat, bench, log, unlock
- Agent loop with OpenAI and Anthropic API support
- MCP tool integration for context-aware model interactions
- Markdown parser with section-level indexing for framework resources
- Artifact store for in-memory session state
- Session store with SQLite persistence
- Pydantic models throughout (ModelConfig, Message, AgentLoop, etc.)
- Google-style docstrings on all public functions
- Sub-package READMEs for CLI and MCP server
- Test suite: 179 tests across both packages
- Shared VERSION file for synchronized package versioning
- CHANGELOG.md with Keep a Changelog format
- Makefile with test, install, build, and release targets
