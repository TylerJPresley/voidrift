# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `worker-cli/` package — manages local model containers and Kiro Gateway (`worker` command)
- `models.yml` — unified model endpoint config (alias → base_url, api_key, model_id)
- Worker CLI commands: `worker start`, `stop`, `status`, `models`, `bench`, `gateway start/stop/status`
- `TaskStore` — parses single TASKS.md with `## Module:` headers into per-module queues with write-through to disk
- MCP tools: `load_tasks`, `get_next_task`, `complete_task`, `get_task_status` for task management
- MCP tools: `get_agent(role, topic)`, `get_template(name)` for targeted resource retrieval
- Write-through `ArtifactStore` — stores to memory and disk simultaneously, disk fallback on cache miss
- `--workers N` CLI flag (default 1, 0 = one per module)
- IEEE 29148 rationale annotations on key requirements (replaces ADRs)

### Changed
- CLI is now model-agnostic — resolves aliases to endpoint URLs, no SSH/docker/gateway management
- `models.py` rewritten: pure alias→URL resolution from `models.yml` (was: SSH, docker, container lifecycle)
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
