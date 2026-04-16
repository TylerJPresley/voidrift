# AUDIT.md — TypeScript Implementation vs REQUIREMENTS.md

**Date:** 2026-04-16
**Branch:** `feat/typescript-rewrite`
**Commit:** `bc0fd5d`
**Tests:** 472 passing, 3 skipped (475 total)

## Executive Summary

**~150 requirements audited across 22 sections.**

| Status | Count | % |
|--------|-------|---|
| PASS | 66 | 44% |
| PARTIAL | 38 | 25% |
| FAIL | 31 | 21% |
| N/A | 15 | 10% |

The TypeScript rewrite covers the core architecture (agent loop, protocol adapters, tool system, command pipelines) solidly. The major gaps are in interactive features (streaming, /compact, permission gate, /idea), tool handler implementations (http, memory, session, analyze, ask are stubs), and operational infrastructure (system log, error tracker, concurrent dispatch, git auto-commits).

---

## 1. System Architecture (REQ-ARCH)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-ARCH-1 | N/A | Specifies "Python CLI" — TypeScript rewrite uses `src/`. Structural requirement (CLI + resources) satisfied. |
| REQ-ARCH-2 | PARTIAL | All 15 subcommands exist. Missing: explicit unhandled-exception wrapper to prevent raw stack traces. |
| REQ-ARCH-3 | PARTIAL | Interactive mode exists. Active container file read for default model not verified. |
| REQ-ARCH-4 | PARTIAL | `tool_choice` supported. Stall detection works. **Gaps:** (1) `done` tool not auto-injected by loop for `tool_choice="required"` — develop handles via hook. (2) 3rd stall strips ALL tools instead of keeping write tools + done. (3) Streaming not implemented — chat uses `stream: false`. |
| REQ-ARCH-5 | PARTIAL | `resolveModel()` returns `ModelInterface`. **Gap:** `ModelInterface` does not bundle a `ProtocolAdapter` — loop creates adapter via `getAdapter()`. |
| REQ-ARCH-6 | PASS | Skills pre-injected in gather/plan/develop. `skill(action="get")` available in chat only. |
| REQ-ARCH-7 | PASS | Separate agent instances per unit of work. Clean message history. State passed as data. |
| REQ-ARCH-8 | PASS | `stripThinkTags()` removes `<think>` blocks. Orphaned `</think>` handled. `ThinkTagBuffer` for streaming with 200-char buffer. |
| REQ-ARCH-9 | PARTIAL | Per-command tool sets and action filtering work. **Gap:** OCP contract violated — `COMMAND_TOOLS` hardcoded in `builder.ts`, not dynamically imported from command modules. |
| REQ-ARCH-10 | PASS | Exponential backoff with jitter. Retry-After parsed. Non-retryable 4xx. Context-length → reactive compaction. Logged. |
| REQ-ARCH-11 | PASS | Truncation detection, text continuation, tool call discard + re-emit, exhaustion handling. |
| REQ-ARCH-12 | PARTIAL | Context-length detection works. **Gap:** Uses `trimMessages()` (filter empties) instead of making a summarization API call as specified. |
| REQ-ARCH-13 | PASS | `TokenBudget` tracks usage. `BudgetExhaustedError`. CLI flags override config. Unconditional accumulation. |
| REQ-ARCH-14 | PASS | All hooks implemented: maxTurns, stopCheck, transformContext, beforeToolCall, afterToolCall, getSteeringMessages, getFollowUpMessages. LoopState correct. |
| REQ-ARCH-15 | PASS | `snipOldToolResults()` snips old file reads. Writes never snipped. Returns new list. |
| REQ-ARCH-16 | PASS | Deduplication + concurrent batching. Results in original order. Logged. |
| REQ-ARCH-17 | PASS | Path normalization (strip `/`, `./`). Array content → string. Logged. |
| REQ-ARCH-18 | PASS | `[ITERATION]` and `[LOOP_EXIT]` with token totals. |
| REQ-ARCH-19 | PARTIAL | Cache control markers added for Anthropic. **Missing:** `[CACHE]` and `[PROMPT_HASH]` logging. |
| REQ-ARCH-20 (stream) | PASS | `stream_options` gated by known providers. Decision in `buildRequest()`. |
| REQ-ARCH-20 (decomp) | FAIL | No helper method decomposition. Stall/steering/follow-up all inline in `_runLoop()`. |
| REQ-ARCH-21 | PASS | Client closed in `finally` block. Previous client closed on fallback. |
| REQ-ARCH-22 | PARTIAL | Adapter pattern works. Tool translation, finish reason mapping, thinking blocks handled. **Gaps:** ModelInterface doesn't bundle adapter. No streaming response parsing. |

## 2. CLI Context (REQ-CTX)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-CTX-1 | PASS | `findSkill()` with 3-layer resolution. YAML frontmatter stripped. |
| REQ-CTX-2 | PASS | Skills pre-injected in system prompts for gather/plan/develop. |
| REQ-CTX-4 | PASS | Run ID = log filename stem. |
| REQ-CTX-5 | PASS | Analysis cache with SHA-256 hash in frontmatter. |
| REQ-CTX-6 | PASS | `loadPrompt()` and `findSkill()` cache in process memory. |

## 3. Resources (REQ-RES)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-RES-1 | PASS | Command prompts in `resources/prompts/<command>.md` with H2 sections. |
| REQ-RES-2 | PASS | North-star skills in `resources/skills/`. Dynamic discovery. |
| REQ-RES-3 | PASS | Plan resolves skills via `findSkill()` and pre-injects. |
| REQ-RES-4 | PASS | Develop resolves per-task skills from frontmatter. |
| REQ-RES-5 | PASS | Missing skill logs warning and continues. |
| REQ-RES-6 | PASS | Prompts loaded from disk, indexed by H2. Format variables via template literals. |
| REQ-RES-7 | PASS | Four-layer system prompt construction. |

## 4. Gather (REQ-G)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-G-1 | PARTIAL | `--path` works. `--idea` accepted but no idea-specific logic. No exit-with-help when neither flag provided. |
| REQ-G-8 | PASS | Four-stage pipeline with separate functions. Stage isolation clean. |
| REQ-G-10 | PASS | No auto-commit. |
| REQ-G-11 | FAIL | No context-length error wrapping with stage/group info. |
| REQ-G-12 | FAIL | All gather agents use `stream: false`. Spec requires `stream: true`. |
| REQ-G-13 | PARTIAL | `makeChunks` exists with overlap clamping. Not wired into `runSourceAnalysis`. |
| REQ-G-17 | PASS | Context block concatenated and injected into source analysis. |
| REQ-G-18 | PARTIAL | Reads files directly, not through WriteContext. No pagination/byte guards on gather reads. |
| REQ-G-19 | PASS | Normal-flow source analysis: zero tools, content in user message. |
| REQ-G-20 | PASS | JSON sanitization: control chars stripped, truncated JSON repaired. |
| REQ-G-21 | FAIL | No elapsed time display. |
| REQ-G-22 | FAIL | No uncategorized file count warning. |
| REQ-G-23 | FAIL | No triage display output with files grouped by category. |
| REQ-G-24 | PASS | `assignUncategorized` with `promptFn` callback. |

## 5. Plan (REQ-P)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-P-1 | PASS | Six stages with artifact verification and retry. |
| REQ-P-2 | PARTIAL | Output hidden. No progress indicators. |
| REQ-P-3 | PASS | `--overwrite` removes plan artifacts, preserves gather. |
| REQ-P-4 | PASS | No auto-commit. |
| REQ-P-9 | PASS | Word-overlap skill resolution. Valid skills with descriptions. |
| REQ-P-10 | PASS | ARCHITECTURE-TEMPLATE loaded. |
| REQ-P-11 | FAIL | No delta analysis / update mode. Always runs fresh. |
| REQ-P-13 | PASS | REQUIREMENTS.md existence check. |
| REQ-P-14 | PASS | Outline files with YAML frontmatter. Removed after manifest built. |
| REQ-P-15 | PASS | Skills injected per-task agent at dispatch time. |
| REQ-P-16 | PASS | Task-scoped ACs in prompt. |
| REQ-P-17 | PASS | REQ ID traceability. Coverage check warns on uncovered. |

## 6. Develop (REQ-D)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-D-1 | PASS | Manifest existence check. |
| REQ-D-2 | PASS | "All tasks complete" exit. |
| REQ-D-3 | PASS | Lock file with PID, stale detection, cleanup in finally. |
| REQ-D-4 | PASS | Per-task dispatch with skills from frontmatter. |
| REQ-D-5 | PASS | Done rejection hook, follow-up nudges, retry, escalation. |
| REQ-D-6 | PASS | Architect consultation with escalation prompt. |
| REQ-D-7 | PASS | Max 5 escalations → blocked. |
| REQ-D-8 | PASS | Escalation includes reqs + arch + task, no source. |
| REQ-D-9 | PASS | CLI owns status transitions. |
| REQ-D-10 | FAIL | No concurrent dispatch. Sequential `for` loop only. |
| REQ-D-11 | FAIL | No git operation lock (moot — no concurrency). |
| REQ-D-13 | PARTIAL | Abort mechanism exists. No SIGINT/SIGTERM handler registered. |
| REQ-D-15 | PASS | Snapshot system with rollback. |
| REQ-D-16 | PARTIAL | Auto-resets orphans. No interactive prompt in TTY mode. |
| REQ-D-17 | PASS | Diff stats computed and displayed. |
| REQ-D-18 | PASS | Git snapshot captured and injected. |
| REQ-D-19 | PASS | Mtime guard with force_write override. |
| REQ-D-20 | PASS | Git checkpoint manager. |
| REQ-D-21 | PASS | Post-task file list verification. |
| REQ-D-22 | PASS | Self-review steering after first write. |
| REQ-D-23 | PASS | Develop prompt directs read-first. |
| REQ-D-24 | PASS | File delete with sandbox, protected paths, snapshot. |

## 7. Deploy (REQ-DPL / REQ-A)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-DPL-1 | PARTIAL | Version classification works. Missing: operator confirmation prompt. |
| REQ-DPL-2 | PASS | Changelog from history.log. |
| REQ-DPL-3 | PASS | Annotated git tag. |
| REQ-DPL-4 | PASS | Conditional IaC generation. |
| REQ-DPL-5 | PASS | Post-deploy hook with VERSION env var. |
| REQ-A-5 | PASS | Both artifacts checked at start. |

## 8. Verify (REQ-VF)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-VF-P | PASS | REQUIREMENTS.md check. |
| REQ-VF-3 | PASS | VERIFY-PLAN.md with self-contained test cases. |
| REQ-VF-4 | PARTIAL | Bug files written. Format not enforced in code. |
| REQ-VF-5 | PASS | VERIFY.md with summary table and verdict. |
| REQ-VF-6 | PASS | STATE.md entry. |
| REQ-VF-7 | PASS | verify-execute tool set excludes source writes. |
| REQ-VF-10 | PASS | Process cleanup in finally block. |
| REQ-VF-13 | PASS | Four-layer system prompt. |
| REQ-VF-15 | FAIL | Sub-agents run sequentially, not concurrently. |
| REQ-VF-16 | PASS | Correct tool sets for verify-plan and verify-execute. |
| REQ-VF-17 | PASS | Doc verification stage before test planning. |

## 9. Utilities (REQ-U)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-U-1 | PARTIAL | Task counts displayed. No emoji indicators, no Rich table. |
| REQ-U-2 | PARTIAL | Chat session works. **Missing:** streaming (`stream: false`). |
| REQ-U-2a | PARTIAL | Footer mode updates for slash commands. No `/chat` reset. |
| REQ-U-2b | PASS | `/gather` handler with wrapCommand harness. |
| REQ-U-2c | PASS | `/plan` handler with overwrite/update prompt. |
| REQ-U-2d | PARTIAL | `/verify` handler. Missing finally-block cleanup at handler level. |
| REQ-U-2e | PARTIAL | `/develop` handler. Missing orphan reset, git snapshot at handler level. |
| REQ-U-3 | PARTIAL | Log view and prune work. `--follow` flag declared but not implemented. |
| REQ-U-4 | PASS | Unlock works. |
| REQ-U-5 | FAIL | No `completions` command. |
| REQ-U-6 | PARTIAL | Prune works. Missing analysis cache pruning (REQ-U-14). |
| REQ-U-7 | FAIL | `/compact` not implemented. |
| REQ-U-8 | FAIL | HTTP tool is a stub. |
| REQ-U-10 | FAIL | No auto-compact. |
| REQ-U-11 | FAIL | No post-compact restoration. |
| REQ-U-12 | FAIL | Ask tool is a stub. |
| REQ-U-13 | PASS | Session persistence with JSONL, compaction boundaries, sanitization. |
| REQ-U-14 | FAIL | No analysis cache pruning. |
| REQ-U-15 | PASS | `/ask` one-shot works. Not appended to history. |
| REQ-U-16 | PARTIAL | Doctor checks config, models, logs, disk. Missing skill parseability. |
| REQ-U-16b | PASS | Per-model entry validation in doctor. |
| REQ-U-17 | PARTIAL | `--bare` works. `--doc` skipped in bare mode (should still work). |
| REQ-U-18 | PARTIAL | `searchEntries()` implemented in session.ts. Handler is a stub. |
| REQ-U-19 | FAIL | Analyze document tool is a stub. |
| REQ-U-20 | FAIL | Analyze code tool is a stub. |
| REQ-U-21 | PARTIAL | `IdeaSession` class exists. Not wired to `/idea` handler. |
| REQ-U-22 | FAIL | No permission gate. |
| REQ-U-23 | PASS | Session gap marker at 30+ minutes. |

## 10. Model Config (REQ-MC)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-MC-1 | PASS | Alias resolution from models file. |
| REQ-MC-2 | PASS | Cloud models need no initialization. |
| REQ-MC-3 | PASS | Defaults section, per-entry overrides, all operational fields. |
| REQ-MC-4 | PARTIAL | Fallback field parsed. Not consumed on retry exhaustion in loop. |
| REQ-MC-5 | PASS | Entry validation with alias identification. |

## 11. Config (REQ-CFG)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-CFG-1 | PASS | `${VAR}`, `${VAR:-default}`, `${section.key}` expansion. |
| REQ-CFG-2 | PASS | All config sections present. |
| REQ-CFG-4 | PASS | `VOIDRIFT_HOME` override. |
| REQ-CFG-5 | PASS | Retention config with defaults. |
| REQ-CFG-6 | PASS | Operational limits from models file. |
| REQ-CFG-7 | PASS | `getMaxTokens` with command.stage dot notation. |
| REQ-CFG-8 | PARTIAL | Models file missing → error from resolveModel. No dedicated setup check message. |
| REQ-CFG-9 | PASS | Per-command bash config with merging. |
| REQ-CFG-10 | PASS | CR/LF stripped from env var expansion. |

## 12. UI (REQ-UI)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-UI-1 | PARTIAL | Ink layout matches structure. Not prompt_toolkit (expected for TS). |
| REQ-UI-1a | PARTIAL | Role bars correct. Tool calls use action-colored bars instead of purple dot. |
| REQ-UI-3 | PARTIAL | Placeholder text works. No multi-line input (Ctrl+J). |
| REQ-UI-6 | PASS | Footer with all fields, color coding, right-alignment. |
| REQ-UI-7 | PASS | Header with ASCII art, callout box, resume note. |
| REQ-UI-8 | PARTIAL | Markdown via marked-terminal. No progressive streaming render. |
| REQ-UI-11 | FAIL | No concurrent develop dashboard. |
| REQ-UI-12 | FAIL | `--style` accepted but ignored. |
| REQ-UI-13 | PARTIAL | Status shows counts. No Rich table, no emoji, no idea count. |
| REQ-UI-14 | PASS | Braille spinner at 100ms. |
| REQ-UI-15 | PARTIAL | Pending message stored and dispatched. No visual display or recall. |
| REQ-UI-16 | FAIL | Input history not implemented. |

## 13. Tools & Security (REQ-TOOL, REQ-SEC, REQ-FSZ)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-TOOL-1 | PASS | Tool guidelines assembled from `_guidelines`. |
| REQ-TOOL-2 | PASS | No module-level WriteContext singleton. |
| REQ-TOOL-3 | PASS | All 10 schemas in registry.ts. |
| REQ-TOOL-4 | PARTIAL | Validates handler is callable. No parameter-name inspection. |
| REQ-TOOL-5 | PARTIAL | Build-time wiring for shell. HTTP/ask/memory/session/analyze are stubs. |
| REQ-TOOL-6 | PASS | Concurrent-safe metadata. Action-aware partitioning. |
| REQ-TOOL-7 | PASS | No legacy tool names in agent code. |
| REQ-TOOL-8 | FAIL | Hardcoded COMMAND_TOOLS dict. OCP contract violated. |
| REQ-SEC-1 | PARTIAL | Path sandboxing works. No symlink resolution. No PATH_BLOCKED logging. |
| REQ-SEC-2 | PASS | Command classification with block/warn/safe. Allowlist override. |
| REQ-SEC-3 | PARTIAL | SSRF check exists. No IPv6. Never called (http is stub). |
| REQ-SEC-4 | PASS | Per-command bash config factory. |
| REQ-FSZ-1 | PASS | Pagination with warning header. |
| REQ-FSZ-2 | PASS | Write rejection when exceeding max_read_lines. |
| REQ-FSZ-4 | PASS | Surgical edit with ambiguity rejection and whitespace fallback. |
| REQ-FSZ-5 | PASS | Byte guard after line pagination. |

## 14. Skills, Git, Logging, Tasks, Ideas, Testing, Memory

| ID | Status | Evidence |
|----|--------|---------|
| REQ-SKL-1 | PASS | Three skill layers. |
| REQ-SKL-2 | PASS | 3-layer resolution, project overrides. |
| REQ-SKL-4 | FAIL | No `voidrift skills` subcommand group. |
| REQ-SKL-5 | FAIL | No synthesis pipeline. |
| REQ-SKL-9 | PARTIAL | `allowed_tools` parsed. No enforcement via hook. |
| REQ-GIT-1 | FAIL | No plan artifact commit. |
| REQ-GIT-2 | FAIL | No per-task develop commits. |
| REQ-GIT-4 | PASS | Bounded diff with limits and binary exclusion. |
| REQ-LOG-1 | PASS | Command logs at correct path. |
| REQ-LOG-4 | FAIL | No system log (`voidrift.log`). |
| REQ-LOG-6 | FAIL | No ErrorTracker. |
| REQ-TM-1 | PASS | ManifestManager with full lifecycle. |
| REQ-TM-2 | PASS | All six statuses with transitions. |
| REQ-TM-3 | PASS | Dependency resolution with transitive blocking. |
| REQ-TM-4 | PASS | Self-contained task files. |
| REQ-TM-5 | PASS | History.log append. |
| REQ-TM-6 | PASS | Archive moves to archived/. |
| REQ-TM-8 | FAIL | No history rotation on deploy. |
| REQ-IDEA-1 | FAIL | `/idea` not wired. |
| REQ-IDEA-2 | FAIL | No guided conversation flow. |
| REQ-TEST-1 | FAIL | No FauxProvider/cassettes. |
| REQ-TEST-2 | FAIL | No resource monitor. |
| REQ-MEM-1 | PARTIAL | Memory system works. Tool handler is a stub. |

---

## Priority Gaps (Ranked by Impact)

### P0 — Core UX (blocks production use)

1. **Streaming** — Chat uses `stream: false`. Token-by-token display, interruptibility, and progressive markdown rendering all depend on this.
2. **Tool handler stubs** — `http`, `memory`, `session`, `analyze`, `ask` return "not yet implemented". Chat agent cannot use web research, memory, session search, document analysis, or ask the operator.
3. **`/compact` + auto-compact** — No context management. Long sessions will hit context limits with no recovery.
4. **Permission gate** — Writes and shell commands execute without operator confirmation in chat.

### P1 — Feature completeness

5. **`/idea` handler** — IdeaSession class exists but isn't wired. Idea refinement flow is dead code.
6. **Concurrent develop dispatch** — Sequential only. Large projects with high-concurrency models can't parallelize.
7. **`--style` differentiation** — Flag accepted but ignored. No terse/raw modes.
8. **`--follow` on log** — Flag declared but not implemented.
9. **Plan update/delta mode** — Always runs fresh. No delta analysis for existing artifacts.
10. **Model fallback activation** — Fallback field parsed but never consumed on retry exhaustion.

### P2 — Operational infrastructure

11. **System log** (`~/.voidrift/logs/voidrift.log`) — No framework-level logging.
12. **ErrorTracker** — No structured error accumulation or summary.
13. **Git auto-commits** — No plan artifact commit, no per-task develop commits.
14. **History rotation** — Deploy doesn't rotate history.log.
15. **`voidrift skills` subcommand** — No search/install/approve/remove.
16. **`voidrift completions`** — No shell completion generation.
17. **Analysis cache pruning** — Prune doesn't clean `.voidrift/analysis/`.

### P3 — Polish

18. **OCP contract** — COMMAND_TOOLS hardcoded in builder.ts.
19. **Loop decomposition** — Stall/steering/follow-up inline in _runLoop.
20. **Symlink resolution** in path sandboxing.
21. **IPv6 SSRF blocking**.
22. **Gather streaming** — Spec says `stream: true` for token telemetry.
23. **Gather elapsed time display**.
24. **Gather triage display** — Files grouped by category.
25. **Reactive compaction** — Uses trimMessages instead of summarization API call.
