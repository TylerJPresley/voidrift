# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Progressive skill synthesis (REQ-SKL-5):** `find_or_synthesize_skill(name, project_dir, model)` in `skills.py` returns an existing approved skill or synthesizes a draft via an agent when no skill is found. Drafts are written to `.voidrift/skills/` with `status: draft` frontmatter. `approve_draft_skill(name, project_dir)` promotes a draft to approved in-place (updates frontmatter, invalidates cache). `voidrift skills approve` extended to handle both pending→domain promotion and project-layer draft promotion.
- **Kanban board for `voidrift status` (REQ-TM-1):** `render_kanban_board(mm)` builds a Rich Table with columns Planned / In Progress / Implemented / Verified / Blocked, grouping task IDs by module. Displayed automatically in `voidrift status` when tasks exist.
- **History log rotation on deploy (REQ-DPL-3):** `ManifestManager.rotate_history_log(version)` archives `history.log` as `history-v{version}.log` and resets the live log after a successful git tag, so each release cycle starts clean. Called automatically by `voidrift deploy`.
- **Gather pipeline stage extraction (REQ-G-8, REQ-ARCH-7):** `_gather_from` refactored into four named stage functions: `_run_triage`, `_run_context_build`, `_run_source_analysis`, `_run_final_pass`. Each has a defined signature and return type; orchestration logic in `_gather_from` is now a thin coordinator.
- **Tool registry extracted to `tools/registry.py` (TODO-07):** `LOCAL_TOOLS` and `LOCAL_HANDLERS` moved from `filesystem.py` to `tools/registry.py`. `filesystem.py` re-exports them for backward compatibility. `tool_builder.py` imports directly from `tools.registry`.
- **Lazy `WriteContext` construction (REQ-FSZ-5):** Module-level `WriteContext` construction replaced with a lazy `_get_ctx()` accessor. Importing `voidrift_cli.tools.filesystem` no longer calls `Path.cwd()` as a side effect.
- **OCP-compliant `AGENT_TOOLS` constants (REQ-ARCH-7):** Each command module declares its own `AGENT_TOOLS: frozenset[str]` (and `AGENT_TOOLS_PLAN`/`AGENT_TOOLS_EXECUTE` for verify). `tool_builder.py` reads these via dynamic `importlib` import, eliminating the hardcoded `_COMMAND_TOOLS` dict.
- **Per-instance active skill state (REQ-SKL-9):** `AgentLoop.active_skill_allowed_tools` and `AgentLoop.active_skill_name` replace the module-level mutable dict in `tool_builder.py`. No module-level side-channel for skill state.
- **Queue drain and stall helpers (REQ-ARCH-7):** `AgentLoop._drain_queues()` and `AgentLoop._handle_stall()` extracted from `_run_loop` for unit-testability.
- **Terminal and display helpers extracted from chat (REQ-ARCH-7):** `_setup_terminal`, `_restore_terminal`, `_make_display_callbacks`, `_handle_idea_command` extracted as module-level functions in `commands/chat.py`.

- **Structured code analysis (REQ-U-20):** `code_analysis(path)` agent tool parses source files via tree-sitter and returns compact JSON with language, line count, imports, exported symbols (name, type, line number), and complexity estimate (branch point count). Supports Python, JavaScript, TypeScript, Rust, Go, Java, C, C++, Ruby. Tree-sitter and per-language grammars are soft dependencies. Available in chat and gather.
- **Doctor optional dependency checks (REQ-U-16a):** `voidrift doctor` now checks for optional tool dependencies (tree-sitter, tree-sitter-python, pymupdf, python-docx, openpyxl) and reports availability as warn when missing, with pip install commands.
- **Document format tools (REQ-U-19):** `read_document(path)` agent tool extracts text from PDF (pymupdf), DOCX (python-docx), and XLSX (openpyxl). Returns plaintext/markdown. DOCX preserves heading hierarchy, XLSX returns markdown tables per sheet. All three are soft dependencies — missing libraries return install hints. Available in chat and gather commands. Path sandboxed to project root.
- **Conversation history search (REQ-U-18):** `search_history(query, limit)` agent tool in chat searches the raw `chat-session.jsonl` by case-insensitive substring match. Returns up to `limit` (default 5, max 10) matching entries newest-first with timestamps, roles, and content capped at 2000 characters. Searches all entries including those before compaction boundaries.
- **Bash tool for develop and chat agents (REQ-SEC-4, REQ-CFG-9):** `run_command` tool now available to develop and chat agents via a factory pattern in `tools/bash.py`. Per-command configuration in `config.yml` under `bash:` section — develop agents get a narrow allowlist (build, test, lint), chat agents get broader access. Two-layer security: per-command `allowed_patterns` checked first, then global `classify_command`. Verify's `run_command` migrated to the same factory. Configurable timeout and output truncation per command.
- **Plan Stage 6: README generation (REQ-P-1):** Plan now generates `.voidrift/README.md` as its final stage. A dedicated agent receives REQUIREMENTS.md and ARCHITECTURE.md and produces the project's user manual following the README-TEMPLATE. Plan owns all documentation — develop owns source code only.
- **`--bare` mode for chat (REQ-U-17):** `voidrift chat --bare` strips all automatic context injection — no skills, git snapshot, or project state. System prompt is `system.md` CONTEXT only. `--bare --system-prompt <path>` replaces the system prompt entirely. Session persistence, tools, `--doc`, and `--style` still work.
- **FauxProvider test fixtures (REQ-TEST-1):** Record/replay API fixture system in `testing/faux_provider.py`. Drop-in replacement for the OpenAI client backed by JSONL cassette files. Replay mode (default) returns recorded responses; record mode captures real calls. Request hashing excludes `api_key` for deterministic matching. `VCR_MODE=record` enables recording.
- **Project memory system (REQ-MEM-1):** Two-layer memory — project (`.voidrift/memory/`) and global (`~/.voidrift/memory/`). Persists project facts, conventions, and operator preferences across chat sessions. Memory index (names + descriptions) injected into chat system prompt; full content loaded on demand via `read_memory` tool. `write_memory` and `list_memory` also available. Project entries override global on name collision. `--bare` skips injection. `voidrift memory list|show|delete` subcommands for direct management without a chat session.
- **`voidrift doctor` diagnostic command (REQ-U-16):** Runs checks on config file, models file, skill files, log directory, and disk space. Reports pass/warn/fail per check. `--fix` auto-remediates where safe (creates missing directories).

### Changed
- **Token budget moved to model config (REQ-ARCH-13):** `max_input_tokens` and `max_output_tokens` are now per-model fields in `models.yml` instead of global `config.yml` settings. CLI flags still override per-run. Different models can have different budget limits.

### Added
- **Side question `/quick` (REQ-U-15):** `/quick <question>` in chat makes a one-shot API call with no tools, minimal system prompt, and `max_tokens=2048`. Does not affect session history or JSONL. Answer displayed inline.
- **Chat output styles `--style` (REQ-UI-12):** `voidrift chat --style verbose|terse|raw`. Verbose shows tool call names during execution. Terse hides individual calls, shows summary count after each round. Raw disables Rich formatting for piping. Display-only — system prompt unchanged.
- **Git checkpoints for develop rollback (REQ-D-20):** `GitCheckpointManager` creates `git stash create` snapshots before each develop task. Checkpoints persisted to `.voidrift/checkpoints.jsonl`. `voidrift rollback <turn>` restores working tree to any checkpoint. Clean trees skip checkpoint creation.
- **Model fallback on retry exhaustion (REQ-MC-4):** Models can declare a `fallback` alias in models.yml. When all retries are exhausted on 429/5xx, the agent switches to the fallback model and retries. Max 1 fallback level. Does not activate on auth or context-length errors. Logged as `[MODEL_FALLBACK]`.
- **External file modification detection (REQ-D-19):** `write_source_file` and `edit_source_file` track file mtime after each write. If the file is modified externally before the next write, a warning is returned and the write is refused. `force_write=true` overrides. Registry is task-scoped (cleared between tasks).
- **Structured error summaries (REQ-LOG-6):** `ErrorTracker` accumulates structured error events during command runs with category, type, message, task ID, and recoverability. Displays a Rich summary table at run end. Writes `.errors.jsonl` alongside the command log. Wired into develop command.
- **Analysis cache pruning (REQ-U-14):** `voidrift prune` now prunes `.voidrift/analysis/` entries in three stages: stale (source file deleted), expired (older than `cache.ttl_days`, default 30), and LRU eviction (over `cache.max_entries`, default 500). Reports counts per stage and bytes freed.
- **Chat session persistence (REQ-U-13):** Chat sessions are automatically persisted to `.voidrift/chat-session.jsonl` and restored on next `voidrift chat`. Append-only JSONL with `id`/`parentId` tree structure. `/compact` writes compaction entries that act as reconstruction boundaries. `/clear` deletes the session file and starts fresh. Message sanitization on restore strips empty content and orphaned tool calls.
- **Max read bytes guard (REQ-FSZ-5):** `read_source_file` and `read_framework_file` apply a secondary byte-count guard (default 512KB) after line pagination. Files with very long lines (minified JS, base64 blobs) are truncated at a valid UTF-8 boundary with a marker. `max_read_bytes=0` disables the guard.
- **Git diff safety limits (REQ-GIT-4):** `get_bounded_diff()` in `git_utils.py` reads `git diff HEAD` with configurable caps: max total lines (2000), max files (50), max lines per file (400). Binary files excluded by extension. Truncation markers identify omitted content. Config via `git:` section in `config.yml`.
- **Skill tool restrictions via `allowed_tools` frontmatter (REQ-SKL-9):** Skills can declare `allowed_tools` in YAML frontmatter to restrict which tools are available when the skill is active. Enforced via `before_tool_call` hook. In chat, restrictions are set when `get_skill` is called and cleared at the start of the next user turn. In develop, restrictions are parsed from all task skills and enforced for the task's agent. Absent or null `allowed_tools` applies no restriction; empty list blocks all tools.
- **SSRF guard for HTTP tools (REQ-SEC-3):** `web_fetch` and `http_request` now resolve hostnames and check against blocked IP ranges (link-local, RFC 1918, CGNAT, IPv6 unique-local/link-local) before making requests. Loopback allowed for local dev. `ssrf_allow_list` in config.yml overrides blocks by hostname or CIDR.
- **Git status snapshot injection (REQ-D-18):** Develop and chat commands capture a git snapshot (branch, last 5 commits, uncommitted changes) once per run and inject it as a `## Git Context` block in each agent's system prompt. Non-git directories and missing git skip silently. Changed files capped at 20.
- **Develop dashboard for concurrent tasks (REQ-UI-11):** When develop dispatches tasks concurrently (concurrency > 1), a Rich Live table shows one row per task with status, turn count, token counts, context %, elapsed time, and last tool called. Updates at 4 Hz. Sequential mode (concurrency 1) continues to use the single-task spinner. Agent loop `on_progress` now includes `turn` and `last_tool` fields.
- **Reactive compact on context-length errors (REQ-ARCH-12):** When an API call fails due to context overflow, the agent summarizes old messages and retries instead of raising immediately. Up to 2 attempts per agent instance. Counter resets between instances.
- **Token budget tracking (REQ-ARCH-13):** `TokenBudget` class tracks cumulative input/output tokens across all agents in a command run. `--max-input-tokens` and `--max-output-tokens` CLI flags on `develop` and `gather`. Config defaults via `token_budget:` section in `config.yml`. Raises `BudgetExhaustedError` when limits exceeded.
- **Pre-write file snapshots and rollback (REQ-D-15):** Before a task's first write to any file, the original content is snapshotted. On task failure, all written files are rolled back to their pre-task state. New files are deleted, modified files are restored. Thread-isolated via `threading.local()` for concurrent tasks.
- **Retry-After header parsing and jitter (REQ-ARCH-10):** All retry delays now include ±30% random jitter to prevent thundering-herd. HTTP 429 responses with `Retry-After` headers use the server-specified delay (capped at 30s) instead of exponential backoff. Enhanced retry logging with attempt number, delay, reason, and header presence.
- **Structured compact prompt:** Replaced freeform compact prompt with structured sections (Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context) plus machine-parseable `<read-files>` and `<modified-files>` tags. Produces consistent, complete summaries across compactions.
- **Context snip for automated commands:** `snip_old_tool_results(messages, max_age_turns=2)` replaces old read-tool results (>500 chars, >2 turns old) with line-count placeholders. Non-destructive — operates on a copy. Plugs into `transform_context` hook for develop/plan agents to free dead context from file reads.
- **Concurrent tool execution:** Consecutive read-tool calls (`read_source_file`, `read_framework_file`, `list_project_artifacts`, `web_fetch`) within a single turn execute concurrently via `ThreadPoolExecutor`. Write tools always execute serially. Batch partitioner groups consecutive safe calls. Results returned in original tool call order. Falls back to serial when `before_tool_call` hook is set.
- **Tool argument normalization:** Normalizers strip leading `/` and `./` from file paths, convert content lists to strings. Applied in `_execute_tool` after JSON parse, before handler call. Changes logged as `[TOOL_NORMALIZE]` for model behavior visibility.
- **Ask user question tool (TASK-FW-011):** `ask_user_question(question, options)` tool available in chat command. Displays question to operator with optional numbered choices, returns response as tool result. Non-TTY fallback returns "use your best judgment" message. Terminal mode restored during prompt (same pattern as web_fetch).
- **Per-tool system prompt injection (TASK-FW-012):** Tool definitions carry `_guidelines` lists co-located with their schema. `build_tool_guidelines(tools)` assembles them into a "Tool Guidelines" prompt section. Guidelines for: write_source_file (complete content, read first), edit_source_file (prefer over write for modifications), read_source_file (pagination awareness).
- **Filesystem path sandboxing (TASK-FW-013):** Unified `_check_sandbox` and `_check_protected` validation in all file tools. `protected_paths` config blocks writes to specified paths even within the project. All blocks logged as `[PATH_BLOCKED path=X reason=Y]`. `configure()` accepts `protected_paths` and `log_path`. `get_protected_paths()` reads from config.yml.
- **Steering and follow-up message queues (TASK-FW-014):** Thread-safe `steer(messages)` and `follow_up(messages, drain)` methods on `AgentLoop`. `steer()` injects messages after the current tool round (alongside `get_steering_messages` callback). `follow_up()` queues messages for after natural stop (alongside `get_follow_up_messages` callback). `drain="all"` injects all queued follow-ups at once; `"one-at-a-time"` drains one batch per stop.
- **Prompt cache optimization (TASK-FW-015):** Anthropic models get `cache_control: {type: "ephemeral"}` on system messages for prompt caching across concurrent agents. Cache efficiency logged as `[CACHE create=N read=N]` after each API call. System prompt SHA-256 hash logged as `[PROMPT_HASH]` at agent init for cache debugging. Non-Anthropic models unaffected.
- **Agent loop transition logging (TASK-FW-016):** Every loop iteration logs `[ITERATION turn=N reason=REASON tools=[...]]`. Reasons: `tool_call`, `done_tool`, `stall_nudge_N`, `max_tokens_recovery`, `reactive_compact`, `context_trim`, `follow_up`. Loop exit logs `[LOOP_EXIT reason=REASON turns=N total_input=N total_output=N]` with reasons: `natural_stop`, `forced_stop`.
- **Session crash recovery for develop (TASK-FW-017):** At develop startup, scans manifest for `in-progress` tasks (orphaned from crashed sessions). Interactive: prompts per task (reset/skip/fail). Non-interactive: auto-resets all to `planned`. Lock file and stale PID detection already existed (REQ-D-3).
- **Diff stats per task (TASK-FW-018):** `compute_diff_stats()` computes per-file line counts from snapshots before clearing. Returns `{path, status, lines_added, lines_removed}` dicts. Develop run displays per-task and total summary: `TASK-N: +added -removed (N files)`.
- **Bash command security classification (TASK-FW-020):** `classify_command()` in `tools/security.py` classifies shell commands as `safe`, `warn`, or `block` using regex patterns. Blocks: `rm -rf /`, fork bombs, `curl|bash`, `dd`, `mkfs`, writes to `/etc/` `/boot/` `/sys/` `/proc/`. Warns: `rm -rf`, `git push --force`, `sudo`, `chmod -R`. `allowed_commands` config overrides to safe. All executions logged as `[CMD_EXEC]`.
- **Loop control hooks (REQ-ARCH-14):** `max_turns` integer limit stops the agent loop after N tool rounds. `stop_check` callback lets command orchestrators halt the loop based on external conditions. `transform_context` filters messages before each API call without modifying history. `before_tool_call` intercepts tool execution (return string to block). `after_tool_call` transforms tool results. `get_steering_messages` injects messages after each tool round. `get_follow_up_messages` continues the loop on natural stop. `LoopState` dataclass passed to `stop_check`, `get_steering_messages`, `get_follow_up_messages` with messages, turn_count, token totals, and tools_called_this_turn. `on_payload` debug hook inspects/modifies raw API kwargs. All default to None (inactive). Signal-based abort via `request_abort()` / `clear_abort()` — sets module-level flag checked each tool round. Budget exhaustion checked as graceful stop alongside `stop_check`. Stall exhaustion logs `[LOOP_STOP reason=stall_exhausted]`. All stop paths use unified `[LOOP_STOP reason=...]` logging.
- **Surgical edit tool (REQ-FSZ-4):** `edit_source_file(path, old_str, new_str)` for targeted modifications. Exact match with whitespace-normalized fallback. Available in develop and chat commands. Counts as a write for REQ-D-5.
- **Chat auto-compact (REQ-U-10):** Auto-compact triggers at 80% context utilization (was 95%). One-time nudge at 70%. Circuit breaker disables auto-compact after 3 consecutive failures.
- **Post-compact restoration (REQ-U-11):** After compaction, re-injects the last 3 files accessed via `read_framework_file`/`read_source_file` and active skills as a system message. No model call — direct disk read. Capped at 20% of context window.
- **Structured compact prompt (REQ-U-7):** Compact prompt externalized to `resources/prompts/chat.md` COMPACT section. Requires file paths, code snippets, decisions with quotes, and pending work.
- **File read tracking:** `WriteContext` tracks files read via `read_source_file` and `read_framework_file` for post-compact restoration.
- **`plan --idea <id>` (REQ-IDEA-5):** Scopes planning to a single idea. Loads idea file content as context alongside REQUIREMENTS.md, gates on `reqs:` field, injects `idea: <id>` into task frontmatter, records in manifest. Auto-archives idea when all derived tasks verified.
- **Plan delta-based update mode (REQ-P-11):** Pre-pipeline delta analysis when plan artifacts exist. Agent receives requirements, architecture, and source file listing (filenames only), returns implemented/unimplemented classification. Delta injected into Stage 1 and Stage 3.
- **Idea-to-implementation flow (REQ-IDEA-1 through REQ-IDEA-5):** `/idea` in chat for guided refinement. `gather --idea <id>` generates requirements from ideas. `plan --idea <id>` scopes planning. Tasks trace back to originating idea.
- **Task system (REQ-TM-1 through REQ-TM-7):** Self-contained task files (`tasks/active/TASK-{id}.md`) with YAML frontmatter. CLI-owned `manifest.yml` tracks status, dependencies, and modules. Bugs as independent entities (`BUG-{id}.md`). Verified tasks archived with history.log trail.
- **Verify command (REQ-VF-3 through REQ-VF-16):** Two-stage requirements-driven acceptance testing. Plan agent writes self-contained test cases. Concurrent sub-agents execute scenarios. Bug reports with full evidence. `try/finally` cleanup.
- **`tools/process_manager.py` (REQ-VF-8 through REQ-VF-11):** Subprocess lifecycle — `start_process`, `stop_process`, `wait_for_ready` (http/port/log_pattern), `read_process_output` (500-line buffer), `run_command`, `stop_all`.
- **`tools/http_client.py` (REQ-VF-12):** Stateful HTTP client with per-session cookie and auth header persistence.
- **`tools/browser.py`:** Playwright-based browser automation — navigate, screenshot, click, get_text. Lazy import with informative error.
- **`web_fetch(url)` tool (REQ-U-8):** Fetches URL, strips HTML, summarizes via isolated sub-agent, caches for session. Chat command only.
- **`WEB-RESEARCH` skill:** Guidelines for effective web research using `web_fetch`.
- **`voidrift skills` command group (REQ-SKL-1 through REQ-SKL-8):** `list`, `search`, `review`, `install`, `remove`, `approve`. Synthesis pipeline via configured model and repos. Pending/approve workflow.
- **`DOMAIN-SKILL-TEMPLATE.md` (REQ-SKL-7):** Authoring guide for domain skills.
- **Agent loop retry (REQ-ARCH-10):** Exponential backoff on connection errors, HTTP 5xx, 429. 3 attempts, 1s base, 2× multiplier, 30s cap.
- **Max-tokens recovery (REQ-ARCH-11):** Detects `finish_reason == "length"`. Up to 2 continuation attempts for text truncation. Tool truncation logged as warning.
- **Think-tag stripping (REQ-ARCH-8):** `<think>` blocks removed from output, logged as `[THINKING]`. Handles orphaned `</think>` with 200-char streaming buffer.
- **Spinner telemetry (REQ-UI-10):** Elapsed time, token counts, context utilization on all agent calls. Randomized labels from `spinner-labels.txt`.
- **Chat UI (REQ-UI-7 through REQ-UI-9):** Rich `Live` block with thinking→streaming→markdown states. Terminal echo suppression during generation. `/compact` auto-triggers at 95%.
- **Context window display (REQ-UI-6):** `[25%] >` prompt with white/yellow/red thresholds. Mode indicator for idea flows.
- **Per-command tool filtering (REQ-ARCH-9):** `build_local_tools(cmd=)` returns only relevant tools per command.
- **Domain-separated filesystem tools:** `write_source_file`/`read_source_file` for project tree, `write_framework_file`/`read_framework_file` for `.voidrift/`.
- **File size guards (REQ-FSZ-1 through REQ-FSZ-3):** Read pagination with warnings. Write rejection with decomposition directive. Duplicate write guard compares content.
- **Per-stage `max_tokens` (REQ-CFG-7):** analysis=2000, consolidation=8192, task=4000, triage=4096, plan=32768.
- **Gather analysis output:** `ANALYSIS.md` index + `analysis/<file>.md` per source file. Analysis cache via YAML frontmatter hash (REQ-CTX-5).
- **Input chunking (REQ-G-13):** Large files split into overlapping chunks, analyzed separately, consolidated.
- **Shared framework context (REQ-RES-7):** `system.md` prepended to all command prompts.
- **Preflight guards:** Gather validates path (REQ-G-1). Plan requires REQUIREMENTS.md (REQ-P-13). Deploy requires both (REQ-A-5). Verify requires REQUIREMENTS.md (REQ-VF-P). Models file check on framework commands (REQ-CFG-8).
- **`ARCHITECTURE.md`** at repo root — component design, data flows, key decisions.

### Changed
- **edit_source_file ambiguity rejection (REQ-FSZ-4):** `edit_source_file` now rejects edits when `old_str` appears more than once in the file, returning the occurrence count and an instruction to add surrounding lines for uniqueness. Previously silently replaced the first occurrence. Tool description updated to state uniqueness requirement. `_guidelines` now includes "Always call read_source_file before edit_source_file."
- **North-star skills are language-agnostic (REQ-SKL-1):** `BACKEND-ENG` generalized to universal principles. VoidRift-specific content in project skill override.
- **All prompts externalized (REQ-RES-6):** Zero hardcoded prompt strings in CLI code.
- **Gather pipeline redesigned (REQ-G-8):** Source code is primary; non-source files are context. Four stages: triage → context build → source analysis → final pass. Direct response output (no tool-call JSON).
- **Gather streaming (REQ-G-12):** All gather agents use `stream=True` for live token telemetry. Think-tag stripping handles streamed responses.
- **Develop rewrite (REQ-D-4, REQ-D-10):** Manifest-based task-level dispatch. Self-contained task files as prompts. Concurrent via `ThreadPoolExecutor` up to model's `concurrency` limit.
- **Plan five-stage pipeline (REQ-P-1):** Architecture → module arch → task outlines → dependency resolution → task files. Each stage uses scoped agent instances.
- **Skill tag validation (REQ-P-9):** Word-overlap resolution for invalid tags. Valid skills listed with descriptions in prompt.
- **Three-layer skill resolution (REQ-SKL-2):** Project → domain → north star. Project skills fully replace lower-layer skills.
- **Model resolution (REQ-MC-1, REQ-MC-3):** Single external models file. `defaults:` section with per-entry overrides. No per-type inference.
- **Config simplified (REQ-CFG-2, REQ-CFG-6):** Operational limits on model entries, not config.yml. `models_file` key replaces `worker:` and `kiro:` sections.
- **Tool choice modes (REQ-ARCH-4):** `required` for automated commands (with `done` tool), `auto` for chat.
- **Chat multiline (REQ-UI-3):** `\` + Enter for continuation; Enter submits.
- **Terminology:** "phases" → "framework commands", "tools" → "agent tools", `phase=` → `cmd=`/`stage=`, `phases/` → `commands/`.
- **CLI is model-agnostic:** Resolves aliases to endpoint URLs. No SSH/docker/gateway management.
- **`tools/` package refactor:** Split from single file to sub-package (filesystem, process, HTTP, browser).
- **System log (REQ-LOG-4):** `~/.voidrift/logs/voidrift.log` hardcoded path, unaffected by `VOIDRIFT_HOME`.
- **Build tooling:** Makefile uses `uv`. `make setup` for onboarding. `make sync` creates `domain-skills/`.

### Fixed
- Plan Stage 1 recovery when model writes ARCHITECTURE.md to wrong path.
- Plan `--overwrite` removes entire directories (not just `.md` files).
- Plan Stage 5 prompt order: task outline first, skill list last.
- Gather `.gitignore` support and dot-path exclusion.
- Gather conciseness constraint (REQ-G-14): max 15 bullet points per analysis.
- Develop write verification (REQ-D-5): retry on no writes, then escalate.
- Develop graceful shutdown (REQ-D-13): SIGTERM/SIGINT flag, lock cleanup.
- Git operation lock for concurrent workers (REQ-D-11).
- No Python tracebacks shown to user. Unknown commands show help.
- Connection errors in chat return to prompt.

### Removed
- MCP Context Server — agent tools are CLI-native (in-process).
- Worker CLI code — extracted to separate `worker-cli` project.
- `TaskStore`, `TASKS.md`, `TASKS-DONE.md` — replaced by manifest + task files.
- `ArtifactStore`, `SessionStore` — replaced by in-memory state and filesystem.
- `tui.py` / `textual` dependency — replaced by `prompt_toolkit` + Rich.
- `spec/` directory — replaced by `analysis/` per-file analyses.
- Three-role system (analyst/architect/developer) — commands shape agents via prompts.
- ADR directory — rationale lives inline in REQUIREMENTS.md.
- Worktree-based parallel execution.

## [0.1.0] - 2026-03-15

### Added
- CLI package (`voidrift-cli`) with Click-based command interface
- Five framework commands: gather, plan, develop, deploy, verify
- Utility commands: status, chat, log, unlock, prune, completions, skills
- Agent loop with OpenAI-compatible API support (local, cloud, gateway)
- Pydantic models throughout (ModelConfig, Message, AgentLoop, etc.)
- Google-style docstrings on all public functions
- Test suite with pytest
- Shared VERSION file for synchronized package versioning
- CHANGELOG.md with Keep a Changelog format
- Makefile with test, install, build, sync, and setup targets
