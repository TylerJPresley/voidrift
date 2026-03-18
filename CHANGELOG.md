# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Run ID correlation for all phases — log filename stem serves as run ID (REQ-MCP-3a)
- `boot_run()` utility returns `(log_path, run_id)` for all phases
- Shared interactive terminal UI for gather and chat phases (REQ-UI-1–4)
  - Light blue indented model responses, dim model label with `◆` marker
  - `prompt_toolkit` multi-line input (Enter for newlines, blank line to submit)
  - Dim stats line (token count, tok/s, elapsed) after each response
  - Horizontal rule between turns
  - `/write` command in gather to enable file tools for one turn

### Changed
- Gather and chat use plain terminal flow instead of Textual TUI — no alternate screen buffer
- Replaced `textual` dependency with `prompt_toolkit`
- Tools disabled by default in gather to prevent model thinking-token overhead

### Removed
- `tui.py` — Textual TUI module (replaced by shared `_interactive_loop`)
- `textual` dependency

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
- `--workers N` CLI flag (default 1, 0 = one per module)
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
- `--parallel`, `--retry`, `--overwrite` CLI flags — replaced by `--workers N`
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
