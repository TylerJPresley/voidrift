# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
