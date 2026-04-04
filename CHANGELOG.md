# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
