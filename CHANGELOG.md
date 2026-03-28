# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `voidrift skills` command group with six subcommands: `list`, `search`, `review`, `install`, `remove`, `approve` (REQ-SKL-1 through REQ-SKL-5) — manages skills across north-star, domain, and project layers from the CLI; `install` runs synthesis pipeline when `skills.repos` and `skills.synthesis_model` are configured, otherwise copies from local layer; `search` queries repo manifests in addition to local layers (REQ-SKL-6); `review` lists pending skills when no name given
- `resources/skills/BACKEND-ENG.md` — north-star skill for VoidRift framework development (Python/Click/FastMCP/pytest/AgentLoop conventions); use `[backend-eng]` tag on framework development tasks
- Per-phase `max_tokens` budget via `get_max_tokens(model_type, phase)` (REQ-CFG-6, REQ-CFG-7) — analysis=2000, synthesis=2000, consolidation=8192, task=4000, triage=4096, plan=32768; configurable per model type in `limits:` section of config.yml
- Gather operator analysis output: `.voidrift/ANALYSIS.md` (index — categories, file counts, links) + `.voidrift/analysis/<source-path>.md` (one file per analyzed source file, mirroring source tree structure); path printed on completion for immediate access
- Per-model input chunking via `get_max_input_chars(model_type)` — local models split files into 8000-char overlapping chunks (200-char overlap) instead of truncating; each chunk analyzed separately, multi-chunk results consolidated before storage; cloud/gateway unlimited (REQ-G-13)
- Gather auto-retry on truncated JSON: detects "Invalid JSON / EOF while parsing" 400 errors, retries with `max_tokens // 2` and a 5-bullet brief prompt (REQ-G-15)
- Config helper tests (`cli/tests/test_config.py`) — 14 tests covering `get_max_tokens` and `get_max_input_chars` across all model types, phases, and config overrides

### Fixed
- Gather: replaced `"gitwildmatch"` with `"gitignore"` in `_build_file_tree()` — suppresses pathspec DeprecationWarning
- Gather: analysis/synthesis agents now use lens-only system prompts (not full ANALYSIS-REQS + system_context blob) — reduces context usage for local models per REQ-G-8
- Gather: conciseness constraint added to ANALYSIS prompt — max 15 bullet points, requirements-relevant only (REQ-G-14)
- Develop: removed `load_tasks`, `get_next_task`, `complete_task`, `get_task_status` from per-task developer agent tool set — these are called via Python API by the outer loop, not by the agent; narrows agent surface per REQ-ARCH-9
- Develop: removed `system_context` pre-load prepended to `dev_prompt_tpl` — agents fetch context on demand via MCP tools per REQ-D-4
- Develop: removed skill pre-loading from `_develop_module` — skills are now fetched on demand via `get_skill()` when the agent reads the task prompt step; updated TASK prompt to explicit step 3 (`get_skill("name")` on demand)
- Develop: added explicit "Do NOT call complete_task()" instruction to TASK prompt (REQ-D-9 AC)
- Gather: promoted `_is_truncated_json_error` to module level for testability (REQ-G-15)
- Tests: added V-G-4 (input truncation) and V-G-6 (retry on 400) test classes — 8 new tests covering REQ-G-13 and REQ-G-15

### Changed
- MCP context server migrated from `mcp[cli]` bundled FastMCP to standalone `fastmcp>=3.1.1` (PrefectHQ) — REQ-MCP-1; industry-standard package following MCP spec independently of Anthropic SDK release cycle
- `get_skill()` now searches three layers in order: project (`.voidrift/skills/`) → domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`) per REQ-SKL-2; project skills fully replace lower-layer skills with same name
- `list_skills()` now returns all skills grouped by layer (North Star, Domain, Domain pending, Project) per REQ-MCP-12 and REQ-SKL-8
- All 16 north-star skill files in `resources/skills/` now include YAML frontmatter (`name`, `description` fields) compatible with standalone fastmcp skill discovery

### Added
- `DOMAIN-SKILL-TEMPLATE.md` — authoring guide and format definition for domain skills; used by synthesis agent during `voidrift skills install` (REQ-SKL-7)
- Skills system requirements (REQ-SKL-1 through REQ-SKL-8) — two-layer skill architecture (north-star global + domain/project), three-layer `get_skill()` search order with project overrides, `voidrift skills` subcommand group, synthesis pipeline via configured model and repos, pending/approve workflow, `DOMAIN-SKILL-TEMPLATE.md`
- MCP server log at `~/.voidrift/logs/mcp.log` (REQ-LOG-5) — RotatingFileHandler 1MB/5 backups, logs boot events (run ID, project dir), `write_file()` calls (path, byte count); separate intent from `voidrift.log` (CLI invocations vs. MCP server internals)
- Agent loop retry logic with exponential backoff (REQ-ARCH-10) — retries on connection errors, HTTP 5xx, and 429 rate limits; 3 attempts, 1s base delay, 2× multiplier, 30s cap; no retry on auth errors or context length errors; each retry logged to phase log
- `ARCHITECTURE.md` at repo root — documents bounded contexts, component responsibilities, data flows, key design decisions, and state/persistence summary; referenced from README.md and START.md documentation checklist

### Fixed
- Develop: removed dead reads of `ARCHITECTURE.md` and `REQUIREMENTS.md` in `_develop_module` — variables were passed as unused kwargs to `.format()` since the TASK template has no `{architecture}` or `{requirements}` placeholders; model loads context on demand via `read_framework_file()` per REQ-D-4
- Gather synthesis: expanded to all categories (was source-only) — tests, config, infrastructure, documentation, and assets now produce structured EARS requirements via `store_requirements()` before consolidation; consolidation receives uniform structured input instead of a source/raw-analysis split
- Gather synthesis: replaced hardcoded source lens string with `_ANALYSIS_LENS.get(cat)` — each category now gets its full category-specific analysis lens matching the analysis stage
- Plan: extracted duplicate task format block to `_TASK_FORMAT` constant in plan.py — single source of truth injected into both PLAN and PLAN-UPDATE via `{task_format}` format variable
- Chat SYSTEM: rephrased "STOP" directive to positive instruction — "wait for the operator's response before continuing"
- Chat DOC: expanded from 3 lines to include editing guidance — targeted changes, structural preservation, requirements alignment, full-file write instruction, confirm-before-write

### Added
- Develop phase writes STATE.md entry on completion (REQ-PS-3) — session-level file tracking via `_session_files` in tools.py, aggregated across per-task resets; `append_state` called at run_develop exit
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
- Per-phase tool filtering in `build_mcp_tools()` (REQ-ARCH-9) — each phase sees only relevant tools
- Domain-separated filesystem tools (REQ-MCP-4a) — `write_source_file`/`read_source_file` for project tree, `write_framework_file`/`read_framework_file` for `.voidrift/` artifacts. Structural separation replaces runtime path guards.
- Module architecture files (REQ-P-1) — Plan produces `arch/<module>.md` with component internals, data models, interfaces (exposed and consumed). Module names match TASKS.md headers.
- Developer on-demand context loading (REQ-D-4) — developer agent loads `arch/<module>.md` and `spec/<module>.md` via `read_framework_file` tool calls during execution, not pre-loaded in system prompt
- Stall nudge mechanism (REQ-ARCH-4) — model gets 2 nudges before write tools are kept and read tools stripped
- Direct skill tag stripping in plan phase (REQ-P-9) — invalid tags removed deterministically
- Valid skill names injected into plan prompt (REQ-P-9) — model can't invent nonexistent tags
- `/compact` command in chat (REQ-U-7) — summarizes conversation history to free context, result ≤10% of context window
- Context window percentage in chat prompt (REQ-UI-6) — `[25%] >` with white/yellow/red color thresholds
- Log file access blocked from model — `read_source_file` rejects `.voidrift/logs/` paths, `list_project_artifacts` excludes logs
- Placeholder content rejection — `write_source_file`/`write_framework_file` reject `"..."`, `"TODO"`, empty content
- Duplicate write guard (REQ-MCP-11) — both write tools prevent overwriting files already written this run
- Shared framework context via `system.md` (REQ-RES-7) — phase lifecycle, artifact manifest with producer/consumer/role, prepended to all phase prompts
- Plan prompt produces `arch/<module>.md` for multi-module projects — module design detail with cross-module interface contracts

### Changed
- `write_file` split into `write_source_file` + `write_framework_file` (REQ-MCP-4a) — domain boundary is structural, no runtime path guards
- `read_framework_file` added for `.voidrift/` artifact access (REQ-MCP-4a)
- `--fresh-start` clears `arch/` instead of `spec/` (REQ-P-3) — gather-produced specs preserved
- Plan prompt step sequence reordered — `get_template` fetched right before architecture write, `list_skills` fetched right before task write, prevents context burial
- All prompt files use positive instructions only — no "NEVER", "do NOT", "don't"
- Prompt role lines standardized — `**Role:** <title> — <one-line description>` format across all phases
- Chat tool results show only tool name (`✓ get_requirements`) instead of full content
- Chat token stats print after response, not before
- Chat spinner runs continuously — starts on submit, restarts after tool results, stops before render
- Chat model responses use default terminal color (was blue) — visual distinction from `◆` label and padding
- Tool descriptions reference discovery tools (`list_skills()`, `list_templates()`, `list_prompts()`) instead of hardcoded examples
- Recipe launches use `Popen` (non-blocking) instead of `ssh_stream` — recipes run vLLM in foreground
- Recipe SSH output redirected to DEVNULL — no log bleed into terminal after startup
- Container stop adds `docker rm -f` and 3s wait for GPU memory release
- Streaming think-tag filter variables initialized before `try` block — fixes `UnboundLocalError` on API failure
- `get_requirements` removed from plan phase tools — requirements already injected in system prompt
- REQ-P-12 narrowed — tasks SHALL NOT target `.voidrift/` paths; dot-prefixed project config files (`.github/`, `.dockerignore`) are valid develop targets
- qwen35 tool call parser changed from `qwen3_coder` to `qwen3_xml` to match unsloth chat template format
- README: Available Models updated (qwen35, qwen25 replace retired models), Per-Phase Prompt Architecture replaces Three-Role System, MCP tools table updated (20 tools with signatures), retired models section added, per-phase tool filtering table added

### Removed
- `on_token` partial tool call text leak — handler changed to no-op in chat
- Duplicate tool display in chat — removed `tool_start()` call, only `✓` line on completion
- Hardcoded examples from tool parameter descriptions (`e.g. 'backend'` etc.)
- Dead code: unused `_token_handler = ui.make_token_handler()` in chat loop
- Three-role system (analyst/architect/developer) references from README and docs

### Added
- `tool_choice` parameter on AgentLoop — `"required"` (default) for automated phases, `"auto"` for chat (REQ-ARCH-4)
- Streaming think-tag filter — buffers tokens inside `<think>` blocks, handles orphaned `</think>` with 200-char flush threshold (REQ-ARCH-8)
- REQ-P-12: tasks must target project source files only — no dot-prefixed paths (`.voidrift/`, `.git/`, etc.)
- `.gitignore` support in gather file tree — excludes gitignored paths before triage sees them (REQ-G-8)
- `pathspec` dependency for `.gitignore` pattern matching
- Write prefix guard on `write_file()` — gather, plan, and chat auto-correct paths to `.voidrift/` (REQ-MCP-4a)
- `model_text()` in `ui.py` for printing complete non-streamed responses in light blue with 2-space indent

### Changed
- Chat uses `tool_choice: "auto"` and streaming — model decides when to call tools, tokens display as they arrive (REQ-U-2)
- Task completion managed by framework, not model — develop prompt says "Do NOT call complete_task()" (REQ-D-9)
- Chat system prompt constrains writes to `.voidrift/` paths only
- REQ-G-8 triage: dot-filtering now covers files and directories (was directories only)
- REQ-G-8 synthesis: specs must be derived exclusively from analyses — no invented paths or behaviors
- Plan and plan-update prompts: task file paths must not start with `.`

### Added
- Three-layer prompt architecture across all phases (REQ-RES-7): skill + prompt + context
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
- Non-streaming mode for all phases (REQ-ARCH-4) — vLLM streaming parser unreliable for tool calls
- Think tag stripping from model responses (REQ-ARCH-8) — `<think>` content logged, not displayed
- Qwen 3.5 model configs: qwen35 (35B-A3B, 262K context), qwen35-perf (122B-A10B, 65K context)

### Changed
- Develop concurrency from config, not CLI flag — `get_concurrency()` used by both gather and develop
- Gather analysis max_tokens bumped from 4096 to 16384 — prevents truncated tool call JSON on large files
- Gather analysis prompt tightened — explicit tool call sequence, no redundant skill lookups
- Gather analysis tools reduced to read_source_file + store_file_analysis only — skill already in system prompt
- All phases use `stream=False` — streaming retained in code for future use
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
- Run ID correlation for all phases — log filename stem serves as run ID (REQ-MCP-3a)
- `boot_run()` utility returns `(log_path, run_id)` for all phases
- Shared interactive terminal UI for gather and chat phases (REQ-UI-1–4)
  - Light blue indented model responses, dim model label with `◆` marker
  - `prompt_toolkit` multi-line input (Enter for newlines, blank line to submit)
  - Dim stats line (token count, tok/s, elapsed) after each response
  - Horizontal rule between turns
  - `/write` command in gather to enable file tools for one turn

### Changed
- Ephemeral data (analyses, escalations) stored in MCP SessionStore SQLite (`~/.voidrift/sessions.db`), keyed by run_id (REQ-MCP-3, REQ-MCP-3a)
- Analyses (file summaries from gather --from) are now memory-only — no disk write-through (REQ-MCP-3)
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
- Phase log path displayed after title in all phase commands
- `TaskStore` — parses single TASKS.md with `## Module:` headers into per-module queues with write-through to disk
- MCP tools: `load_tasks`, `get_next_task`, `complete_task`, `get_task_status` for task management
- MCP tools: `get_agent(role, topic)`, `get_template(name)` for targeted resource retrieval
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
- Interactive gather limited to `write_file` tool only (was: all 16 MCP tools causing infinite loops)
- Analyst prompt instructs concise responses — few questions per turn
- Interactive gather capped at 4096 max_tokens to prevent multi-minute responses
- Analyst prompt instructs concise responses — few questions per turn
- Docker run command includes `vllm serve` and `-e HF_TOKEN` for gated models
- Phase logs moved to `.voidrift/logs/` subdirectory
- `huggingface-cli` references updated to `uvx --from huggingface_hub hf`
- Kiro model IDs fixed: dots not dashes (`claude-sonnet-4.5` not `claude-sonnet-4-5`)
- `bench` command moved from `voidrift` to `worker` CLI
- `--refresh` flag moved from phase commands to `worker start --refresh`
- REQUIREMENTS.md migrated to IEEE 29148 / EARS notation (1027 → 248 lines)
- Architecture: four components (cli, mcp-context-server, worker-cli, resources) replaces three
- Single `TASKS.md` with `## Module:` headers replaces multiple `TASKS-<module>.md` files
- CLI delegates all task management to MCP server (`get_next_task`, `complete_task`, `block`)
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
- Removed `VOIDRIFT_PROJECT_DIR` from MCP server — always uses `Path.cwd()`

### Removed
- `ensure_model_ready()` / `cleanup_model()` from CLI and all phase files — worker-cli handles this
- `bench` command from VoidRift CLI — moved to worker-cli
- `--refresh` flag from all phase commands — use `worker start --refresh` instead
- ADR directory and ADR-TEMPLATE.md — rationale lives inline in REQUIREMENTS.md
- `get_next_task()` and `mark_task()` from CLI utils — MCP server handles these
- `get_framework_resource()` MCP tool — replaced by `get_agent()` and `get_template()`
- `get_conventions()` MCP tool — CONVENTIONS.md deleted from resources
- `--parallel`, `--retry`, `--overwrite` CLI flags — replaced by config-based concurrency
- `_develop_parallel()`, `_develop_loop()`, `_develop_sequential()` — replaced by `_develop_module()`
- Worktree-based parallel execution (AC-D36 through AC-D53)
- Multiple `TASKS-<module>.md` file pattern

## [0.1.0] - 2026-03-15

### Added
- CLI package (`voidrift-cli`) with Click-based command interface
- MCP Context Server (`voidrift-mcp-context-server`) with FastMCP
- Five-phase commands: gather, plan, develop, automate, verify
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
