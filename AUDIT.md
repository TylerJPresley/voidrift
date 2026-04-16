# AUDIT.md — TypeScript Implementation vs REQUIREMENTS.md (Post-Refactor)

**Date:** 2026-04-16
**Branch:** `feat/typescript-rewrite`
**Commit:** `d7d9409`
**Tests:** 503 passing, 0 skipped

## Executive Summary

**~150 requirements audited across 22 sections.**

| Status | Count | % |
|--------|-------|---|
| PASS | 105 | 70% |
| PARTIAL | 30 | 20% |
| FAIL | 15 | 10% |

Up from 44% PASS in the pre-refactor audit to 70% PASS. The refactor closed the P0 blockers (streaming, tool handlers, context management, permission gate), P1 features (idea flow, concurrent dispatch, chat polish, plan/gather gaps), P2 operational infrastructure (system log, ErrorTracker, git commits, completions, analysis pruning, skills CLI), and P3 architecture cleanup (OCP, loop decomposition, ModelInterface adapter, done tool, cache logging, security fixes).

---

## Remaining Gaps by Priority

### FAIL (15 items)

| ID | Gap | Impact |
|----|-----|--------|
| REQ-ARCH-3 | No interactive guided flow when `voidrift` run with no args | UX — operators must know commands |
| REQ-G-12 | Gather uses `stream: false` — spec requires `stream: true` | No live token telemetry in gather |
| REQ-G-13 (wiring) | `makeChunks()` exists but not called from `runSourceAnalysis()` | Large files passed in full |
| REQ-U-8 | HTTP tool is a stub — no fetch, SSRF guard, sub-agent summary, cache | Chat can't do web research |
| REQ-U-16a | Doctor doesn't check optional deps (pdf-parse, mammoth, xlsx) | Missing deps discovered at runtime |
| REQ-UI-11 | No concurrent develop dashboard (Rich Live table) | No visibility into parallel tasks |
| REQ-UI-12 | `--style` accepted but ignored — no terse/raw modes | Style flag is dead code |
| REQ-UI-16 | No input history (Up/Down arrow cycling) | Must retype previous inputs |
| REQ-SKL-5 | No skills synthesis pipeline (`voidrift skills install`) | Can't install domain skills |
| REQ-SKL-6 | No manifest fetching from repos | Can't search remote skills |
| REQ-SKL-10 | No on-the-fly skill synthesis | Missing skills not auto-synthesized |
| REQ-VF-8 | Process tool `startProcess()` is a stub | Verify can't start system under test |
| REQ-VF-9 | `waitForReady()` is a stub | Verify can't wait for server readiness |
| REQ-VF-12 | HTTP tool for verify is a stub — no session persistence | Verify can't test HTTP endpoints |
| REQ-GIT-3 | Plan auto-commits despite spec saying `auto-commits: false` | Contradicts requirement |

### PARTIAL (30 items — key ones)

| ID | Gap |
|----|-----|
| REQ-ARCH-2 | No interactive mode with no args (overlaps ARCH-3) |
| REQ-ARCH-4 | `done()` doesn't trigger final text-only call; spinner not in loop |
| REQ-ARCH-18 | `[ITERATION]` log missing `reason` field |
| REQ-G-1 | `--idea` mode accepted but not implemented |
| REQ-G-18 | Gather source reads bypass WriteContext (no pagination/sandbox) |
| REQ-UI-1 | No scroll-back in conversation area |
| REQ-UI-1a | Tool calls use action-colored bars instead of purple dot `●` |
| REQ-UI-2 | No per-item progress with elapsed time in automated commands |
| REQ-UI-3 | No multi-line input (Ctrl+J / backslash+Enter) |
| REQ-UI-6 | Branch color wrong, no footer background color |
| REQ-UI-7 | ASCII art color wrong, no callout background fill |
| REQ-UI-10 | No formatted stats string `(elapsed · tkns · ctx%)` |
| REQ-UI-14 | No mid-stream stall indicator, no empty response fallback messages |
| REQ-UI-15 | Pending message has no visual display (yellow bar, hint line) |
| REQ-U-1 | Status uses plain text, not emoji indicators |
| REQ-U-12 | `askFn` not wired into chat's `buildLocalTools` call |
| REQ-U-15 | Command is `/ask` instead of `/quick` per spec |
| REQ-U-19 | Document extraction returns placeholder — logic not implemented |
| REQ-U-20 | Code analysis missing path sandboxing |
| REQ-D-16 | No interactive prompt for orphaned tasks in TTY mode |
| REQ-P-4 | Plan auto-commits (contradicts `auto-commits: false`) |
| REQ-TOOL-4 | Schema-handler validation only checks callable, not parameter names |
| REQ-TOOL-5 | HTTP handler is hardcoded stub, not built via factory pattern |
| REQ-SKL-4 | Only `list` and `search` implemented — no install/approve/remove |
| REQ-TM-7 | Bug entity management incomplete (no creation API, no architect consultation) |
| REQ-IDEA-5 | No `reqs:` field gate, no automatic idea archival |
| REQ-CFG-8 | No explicit "models file missing" check — error comes from resolveModel |

---

## Full Audit Tables

### 1. System Architecture (REQ-ARCH)

| ID | Status | Evidence |
|----|--------|---------|
| REQ-ARCH-1 | PASS | TypeScript CLI in `src/`, resources in `resources/`. |
| REQ-ARCH-2 | PARTIAL | All 15 subcommands exist. No interactive mode with no args. |
| REQ-ARCH-3 | FAIL | No interactive guided flow. Commander shows help text only. |
| REQ-ARCH-4 | PARTIAL | tool_choice, stall detection, streaming all work. `done()` doesn't trigger final text-only call. |
| REQ-ARCH-5 | PASS | `ModelInterface` bundles `ModelConfig` + `ProtocolAdapter`. |
| REQ-ARCH-6 | PASS | Skills pre-injected. `skill(action="get")` in chat only. |
| REQ-ARCH-7 | PASS | Separate agent instances per unit of work. |
| REQ-ARCH-8 | PASS | Think-tag stripping with orphaned tag handling and streaming buffer. |
| REQ-ARCH-9 | PASS | OCP contract: command modules export AGENT_TOOLS, dynamic import in builder. |
| REQ-ARCH-10 | PASS | Exponential backoff with jitter, Retry-After, correct retryable classification. |
| REQ-ARCH-11 | PASS | Max-tokens recovery for text and tool calls. |
| REQ-ARCH-12 | PASS | Reactive compaction via summarization API call. |
| REQ-ARCH-13 | PASS | TokenBudget with CLI flag override. |
| REQ-ARCH-14 | PASS | All 7 hooks implemented with LoopState. |
| REQ-ARCH-15 | PASS | snipOldToolResults with action-aware logic. |
| REQ-ARCH-16 | PASS | Deduplication + concurrent batching. |
| REQ-ARCH-17 | PASS | Path normalization with logging. |
| REQ-ARCH-18 | PARTIAL | ITERATION/LOOP_EXIT logged but missing `reason` field. |
| REQ-ARCH-19 | PASS | Cache control markers, [CACHE] logging, [PROMPT_HASH]. |
| REQ-ARCH-20 (stream) | PASS | stream_options gated by known providers. |
| REQ-ARCH-20 (decomp) | PASS | _handleStall, _drainSteering, _drainOneFollowup extracted. |
| REQ-ARCH-21 | PASS | Client closed in finally block and on fallback. |
| REQ-ARCH-22 | PASS | Full adapter pattern with streaming for both protocols. |

### 2. Commands (REQ-G, REQ-P, REQ-D, REQ-DPL, REQ-VF)

| ID | Status | ID | Status | ID | Status |
|----|--------|----|--------|----|--------|
| REQ-G-1 | PARTIAL | REQ-P-1 | PASS | REQ-D-1 | PASS |
| REQ-G-8 | PASS | REQ-P-2 | PARTIAL | REQ-D-2 | PASS |
| REQ-G-10 | PASS | REQ-P-3 | PASS | REQ-D-3 | PASS |
| REQ-G-11 | PASS | REQ-P-4 | PARTIAL | REQ-D-4 | PASS |
| REQ-G-12 | FAIL | REQ-P-9 | PASS | REQ-D-5 | PASS |
| REQ-G-13 | FAIL | REQ-P-10 | PASS | REQ-D-6 | PASS |
| REQ-G-17 | PASS | REQ-P-11 | PASS | REQ-D-7 | PASS |
| REQ-G-18 | PARTIAL | REQ-P-13 | PASS | REQ-D-10 | PASS |
| REQ-G-19 | PASS | REQ-P-14 | PASS | REQ-D-11 | PASS |
| REQ-G-20 | PASS | REQ-P-15 | PASS | REQ-D-13 | PASS |
| REQ-G-21 | PASS | REQ-P-16 | PASS | REQ-D-15 | PASS |
| REQ-G-22 | PASS | REQ-P-17 | PASS | REQ-D-17 | PASS |
| REQ-G-23 | PASS | REQ-DPL-1 | PASS | REQ-D-18 | PASS |
| REQ-G-24 | PASS | REQ-DPL-2 | PASS | REQ-D-19 | PASS |
| REQ-VF-P | PASS | REQ-DPL-3 | PASS | REQ-D-20 | PASS |
| REQ-VF-3 | PASS | REQ-DPL-4 | PASS | REQ-D-21 | PASS |
| REQ-VF-5 | PASS | REQ-DPL-5 | PASS | REQ-D-22 | PASS |
| REQ-VF-6 | PASS | REQ-A-5 | PASS | REQ-D-24 | PASS |
| REQ-VF-8 | FAIL | REQ-TM-8 | PASS | REQ-GIT-1 | PASS |
| REQ-VF-9 | FAIL | REQ-GIT-3 | FAIL | REQ-GIT-2 | PASS |
| REQ-VF-12 | FAIL | | | REQ-GIT-4 | PASS |
| REQ-VF-15 | PASS | | | | |
| REQ-VF-17 | PASS | | | | |

### 3. Utilities (REQ-U)

| ID | Status | ID | Status |
|----|--------|----|--------|
| REQ-U-1 | PARTIAL | REQ-U-13 | PASS |
| REQ-U-2 | PASS | REQ-U-14 | PASS |
| REQ-U-2a | PASS | REQ-U-15 | PARTIAL |
| REQ-U-2b | PASS | REQ-U-16 | PASS |
| REQ-U-2c | PASS | REQ-U-16a | FAIL |
| REQ-U-2d | PARTIAL | REQ-U-16b | PASS |
| REQ-U-2e | PASS | REQ-U-17 | PASS |
| REQ-U-3 | PASS | REQ-U-18 | PASS |
| REQ-U-4 | PASS | REQ-U-19 | PARTIAL |
| REQ-U-5 | PASS | REQ-U-20 | PARTIAL |
| REQ-U-6 | PASS | REQ-U-21 | PASS |
| REQ-U-7 | PASS | REQ-U-22 | PASS |
| REQ-U-8 | FAIL | REQ-U-23 | PASS |
| REQ-U-10 | PASS | | |
| REQ-U-11 | PASS | | |
| REQ-U-12 | PARTIAL | | |

### 4. Tools, Security, Config, Skills, UI, etc.

| ID | Status | ID | Status | ID | Status |
|----|--------|----|--------|----|--------|
| REQ-TOOL-1 | PASS | REQ-SEC-1 | PASS | REQ-CFG-1 | PASS |
| REQ-TOOL-2 | PASS | REQ-SEC-2 | PASS | REQ-CFG-4 | PASS |
| REQ-TOOL-3 | PASS | REQ-SEC-3 | PASS | REQ-CFG-5 | PASS |
| REQ-TOOL-4 | PARTIAL | REQ-SEC-4 | PASS | REQ-CFG-7 | PASS |
| REQ-TOOL-5 | PARTIAL | REQ-FSZ-1 | PASS | REQ-CFG-9 | PASS |
| REQ-TOOL-6 | PASS | REQ-FSZ-2 | PASS | REQ-CFG-10 | PASS |
| REQ-TOOL-7 | PASS | REQ-FSZ-4 | PASS | REQ-MC-1 | PASS |
| REQ-TOOL-8 | PASS | REQ-FSZ-5 | PASS | REQ-MC-3 | PASS |
| REQ-SKL-1 | PASS | REQ-PS-1 | PASS | REQ-MC-4 | PASS |
| REQ-SKL-2 | PASS | REQ-PS-2 | PASS | REQ-MC-5 | PASS |
| REQ-SKL-4 | PARTIAL | REQ-PS-3 | PASS | REQ-LOG-1 | PASS |
| REQ-SKL-5 | FAIL | REQ-PS-4 | PASS | REQ-LOG-4 | PASS |
| REQ-SKL-6 | FAIL | REQ-TM-1 | PASS | REQ-LOG-6 | PASS |
| REQ-SKL-9 | PASS | REQ-TM-2 | PASS | REQ-TEST-1 | PASS |
| REQ-SKL-10 | FAIL | REQ-TM-3 | PASS | REQ-TEST-2 | PASS |
| REQ-MEM-1 | PASS | REQ-TM-4 | PASS | REQ-IDEA-1 | PASS |
| REQ-UI-1 | PARTIAL | REQ-TM-5 | PASS | REQ-IDEA-3 | PASS |
| REQ-UI-3 | PARTIAL | REQ-TM-6 | PASS | REQ-IDEA-4 | PASS |
| REQ-UI-4 | PASS | | | | |
| REQ-UI-6 | PARTIAL | | | | |
| REQ-UI-7 | PARTIAL | | | | |
| REQ-UI-8 | PASS | | | | |
| REQ-UI-9 | PASS | | | | |
| REQ-UI-11 | FAIL | | | | |
| REQ-UI-12 | FAIL | | | | |
| REQ-UI-14 | PASS | | | | |
| REQ-UI-16 | FAIL | | | | |

---

## Progress Since Pre-Refactor Audit

| Metric | Pre-Refactor | Post-Refactor | Delta |
|--------|-------------|---------------|-------|
| PASS | 66 (44%) | 105 (70%) | +39 |
| PARTIAL | 38 (25%) | 30 (20%) | -8 |
| FAIL | 31 (21%) | 15 (10%) | -16 |
| N/A | 15 (10%) | 0 (0%) | -15 |
| Tests | 472 + 3 skip | 503 + 0 skip | +31 |

### What the refactor delivered:
- **Streaming** — chat uses `stream: true` with progressive markdown rendering
- **Tool handlers** — memory, session, analyze, ask all wired (http still stub)
- **Context management** — /compact, auto-compact at 80%, nudge at 70%, restoration
- **Permission gate** — session-scoped writes/runs/reads-outside with allow/deny/always
- **Idea flow** — /idea, /done, file I/O, manifest tracking
- **Concurrent dispatch** — develop + verify use concurrency limit with async mutex
- **Git commits** — plan artifacts + per-task develop commits
- **System log** — ~/.voidrift/logs/voidrift.log with rotation
- **ErrorTracker** — structured error accumulation + .errors.jsonl
- **OCP contract** — command modules export AGENT_TOOLS, dynamic import
- **Loop decomposition** — _handleStall, _drainSteering, _drainOneFollowup
- **ModelInterface** — adapter bundled at resolution time
- **Security** — symlink resolution, IPv6 SSRF, PATH_BLOCKED logging, ip4ToInt fix
- **REQUIREMENTS.md** — all Python references replaced with TypeScript equivalents

### What remains:
1. **HTTP tool** (REQ-U-8) — the biggest remaining gap for chat usefulness
2. **Skills synthesis** (REQ-SKL-5/6/10) — install/approve/review workflow
3. **Verify tools** (REQ-VF-8/9/12) — process start, waitForReady, HTTP sessions
4. **UI polish** — input history, --style modes, concurrent dashboard, multi-line input
5. **Minor gaps** — interactive mode (ARCH-3), gather streaming (G-12), chunking wiring (G-13)
