# REFACTOR-PLAN.md — Closing the Audit Gaps

**Source:** AUDIT.md (2026-04-16)
**Goal:** Bring the TypeScript implementation to full REQUIREMENTS.md compliance.
**Approach:** Phases ordered by dependency — each phase unlocks the next.

---

## Phase 1 — Streaming (P0, unlocks chat UX)

Streaming is the single biggest blocker. Chat markdown rendering, `/compact`, auto-compact, and the thinking indicator mid-stream all depend on it.

| Task | Requirements | Files |
|------|-------------|-------|
| Implement `iterStream` on `OpenAIAdapter` | REQ-ARCH-4, REQ-ARCH-20 | `src/agent/protocol.ts` |
| Implement `iterStream` on `AnthropicAdapter` | REQ-ARCH-22 | `src/agent/protocol.ts` |
| Add streaming path to `_rawCall` in loop.ts | REQ-ARCH-4 | `src/agent/loop.ts` |
| Wire `stream: true` in chat.ts with `onToken` callback | REQ-U-2 | `src/commands/chat.ts` |
| Progressive markdown rendering during stream | REQ-UI-8 | `src/tui/Message.tsx` |
| Mid-stream stall indicator (1.5s pause) | REQ-UI-14 | `src/tui/Thinking.tsx`, `src/tui/state.ts` |
| Wire `stream: true` in gather agents | REQ-G-12 | `src/commands/gather.ts` |

**Tests:** Adapter stream parsing (text, tool calls, thinking blocks, usage). Loop streaming path. Mock token delivery.

---

## Phase 2 — Tool Handler Implementations (P0)

Five tool handlers are stubs. These are required for chat to be useful.

| Task | Requirements | Files |
|------|-------------|-------|
| `memory` handler — wire `MemoryManager` methods | REQ-MEM-1 | `src/tools/builder.ts` |
| `session` handler — wire `searchEntries` + read/list | REQ-U-18 | `src/tools/builder.ts` |
| `http` handler — SSRF check, fetch, sub-agent summary, cache | REQ-U-8, REQ-SEC-3 | `src/tools/http.ts`, `src/tools/builder.ts` |
| `analyze` handler — document extraction (PDF/DOCX/XLSX) | REQ-U-19 | `src/tools/analyze.ts` (new) |
| `analyze` handler — code analysis (tree-sitter or TS equivalent) | REQ-U-20 | `src/tools/analyze.ts` |
| `ask` handler — operator prompt with TTY detection | REQ-U-12 | `src/tools/builder.ts` |
| Wire all handlers via build-time kwargs pattern | REQ-TOOL-5 | `src/tools/builder.ts` |

**Tests:** Each handler round-trip. SSRF integration with http. Non-TTY fallback for ask. Memory read/write/list. Session search.

---

## Phase 3 — Context Management (P0)

Depends on Phase 1 (streaming) for token counting.

| Task | Requirements | Files |
|------|-------------|-------|
| `/compact` handler — summarize history via API call | REQ-U-7 | `src/commands/chat.ts` |
| `ContextCompactor` class — threshold detection, failure circuit breaker | REQ-U-10, REQ-U-21 | `src/agent/context.ts` (or new `src/commands/compactor.ts`) |
| Auto-compact at 80% utilization | REQ-U-10 | `src/commands/chat.ts` |
| 70% nudge (one-time system message) | REQ-U-10 | `src/commands/chat.ts` |
| Post-compact restoration — last 3 files + skills | REQ-U-11 | `src/commands/chat.ts` |
| Reactive compaction — summarization API call (not just trimMessages) | REQ-ARCH-12 | `src/agent/loop.ts` |

**Tests:** Compactor threshold logic. Circuit breaker after 3 failures. Restoration file injection. Reactive compact with mock API.

---

## Phase 4 — Permission Gate (P0)

| Task | Requirements | Files |
|------|-------------|-------|
| Session-scoped permission tracker (writes/runs/reads-outside) | REQ-U-22 | `src/commands/chat.ts` (or new `src/commands/permissions.ts`) |
| `beforeToolCall` hook integration — prompt before write/run/out-of-sandbox read | REQ-U-22 | `src/commands/chat.ts` |
| Allow once / always / deny flow via TUI input | REQ-U-22 | `src/tui/App.tsx` |
| Non-TTY auto-deny | REQ-U-22 | `src/commands/permissions.ts` |
| Automated commands bypass gate | REQ-U-22 | `src/commands/develop.ts`, etc. |

**Tests:** Write prompts before writing. Deny returns denial. Always skips subsequent. Non-TTY auto-denies. Develop writes without prompt.

---

## Phase 5 — Idea Flow (P1)

| Task | Requirements | Files |
|------|-------------|-------|
| Wire `/idea` and `/done` handlers in chat.ts | REQ-IDEA-1 | `src/commands/chat.ts` |
| Idea file I/O — create, load, save to `.voidrift/ideas/` | REQ-IDEA-3 | `src/commands/idea.ts`, `src/manifest.ts` |
| Guided conversation stages (Intake → Exploration → Shaping → Summary) | REQ-IDEA-2 | `src/commands/idea.ts` |
| Manifest `ideas` section with status (draft/now/next/later/done) | REQ-IDEA-3 | `src/manifest.ts` |
| `--idea <id>` on gather and plan | REQ-G-1, REQ-IDEA-5 | `src/commands/gather.ts`, `src/commands/plan.ts` |

**Tests:** IdeaSession state transitions (already exist). Idea file round-trip. Manifest idea tracking. `/done` categorization.

---

## Phase 6 — Concurrent Dispatch (P1)

| Task | Requirements | Files |
|------|-------------|-------|
| `Promise.all` with concurrency limit in develop dispatch loop | REQ-D-10 | `src/commands/develop.ts` |
| Git operation mutex (async lock) | REQ-D-11 | `src/commands/develop.ts` |
| Concurrent verify sub-agents | REQ-VF-15 | `src/commands/verify.ts` |
| SIGINT/SIGTERM handler → `requestAbort()` | REQ-D-13 | `src/index.ts` |

**Tests:** Concurrent dispatch with mock agents. Lock serialization. Abort signal propagation.

---

## Phase 7 — Chat Polish (P1)

| Task | Requirements | Files |
|------|-------------|-------|
| `--style` differentiation — verbose/terse/raw rendering | REQ-UI-12 | `src/commands/chat.ts`, `src/tui/Message.tsx` |
| `--follow` on log command | REQ-U-3 | `src/index.ts` |
| Multi-line input (Ctrl+J / backslash+Enter) | REQ-UI-3 | `src/tui/App.tsx` |
| Input history (Up/Down arrow cycling) | REQ-UI-16 | `src/tui/App.tsx` |
| Pending message visual display (yellow bar, hint line, Up recall) | REQ-UI-15 | `src/tui/App.tsx`, `src/tui/Message.tsx` |
| `/chat` mode reset | REQ-U-2a | `src/commands/chat.ts` |
| `--doc` works in bare mode | REQ-U-17 | `src/commands/chat.ts` |
| Model fallback activation on retry exhaustion | REQ-MC-4 | `src/agent/loop.ts` |

**Tests:** Style rendering differences. Log follow. History cycling. Fallback activation.

---

## Phase 8 — Plan & Gather Gaps (P1-P2)

| Task | Requirements | Files |
|------|-------------|-------|
| Plan delta/update mode when artifacts exist | REQ-P-11 | `src/commands/plan.ts` |
| Gather `--idea` mode — read idea, generate reqs, update idea file | REQ-G-1 | `src/commands/gather.ts` |
| Gather elapsed time display | REQ-G-21 | `src/commands/gather.ts` |
| Gather triage display — files grouped by category | REQ-G-23 | `src/commands/gather.ts` |
| Gather uncategorized file count warning | REQ-G-22 | `src/commands/gather.ts` |
| Gather context-length error wrapping with stage info | REQ-G-11 | `src/commands/gather.ts` |
| Gather chunking wired into runSourceAnalysis | REQ-G-13 | `src/commands/gather.ts` |
| Gather source reads through WriteContext | REQ-G-18 | `src/commands/gather.ts` |
| Deploy operator confirmation for version bump | REQ-DPL-1 | `src/commands/deploy.ts` |
| Deploy history.log rotation | REQ-TM-8 | `src/commands/deploy.ts` |

**Tests:** Delta analysis. Idea-to-reqs flow. Elapsed time output. Triage display. Chunking integration.

---

## Phase 9 — Operational Infrastructure (P2)

| Task | Requirements | Files |
|------|-------------|-------|
| System log (`~/.voidrift/logs/voidrift.log`) with rotation | REQ-LOG-4, REQ-LOG-5 | `src/utils.ts` (or new `src/logger.ts`) |
| ErrorTracker — accumulate, summarize, write `.errors.jsonl` | REQ-LOG-6 | new `src/errors.ts` |
| Git auto-commit for plan artifacts | REQ-GIT-1 | `src/commands/plan.ts` |
| Git per-task commits in develop | REQ-GIT-2 | `src/commands/develop.ts` |
| `voidrift completions` command | REQ-U-5 | `src/index.ts` |
| Analysis cache pruning in prune command | REQ-U-14 | `src/index.ts` |
| `voidrift skills` subcommand group (list, search, install, approve, remove) | REQ-SKL-4, REQ-SKL-5 | new `src/commands/skills.ts`, `src/index.ts` |

**Tests:** Log rotation. Error tracker accumulation. Commit messages. Completions output. Cache pruning stages.

---

## Phase 10 — Architecture Cleanup (P3)

| Task | Requirements | Files |
|------|-------------|-------|
| OCP contract — move COMMAND_TOOLS/ACTIONS to command module exports | REQ-TOOL-8, REQ-ARCH-9 | `src/tools/builder.ts`, all command files |
| Loop decomposition — extract `_handleStall`, `_drainSteering`, `_drainOneFollowup` | REQ-ARCH-20 | `src/agent/loop.ts` |
| Bundle ProtocolAdapter into ModelInterface at resolution time | REQ-ARCH-5, REQ-ARCH-22 | `src/models.ts`, `src/agent/loop.ts` |
| `done` tool auto-injection for `tool_choice="required"` | REQ-ARCH-4 | `src/agent/loop.ts` |
| 3rd stall keeps write tools + done (not strip all) | REQ-ARCH-4 | `src/agent/loop.ts` |
| Anthropic `[CACHE]` and `[PROMPT_HASH]` logging | REQ-ARCH-19 | `src/agent/protocol.ts` |
| Symlink resolution in path sandboxing | REQ-SEC-1 | `src/tools/filesystem.ts` |
| IPv6 SSRF blocking | REQ-SEC-3 | `src/tools/ssrf.ts` |
| PATH_BLOCKED logging | REQ-SEC-1 | `src/tools/filesystem.ts` |
| Skill `allowed_tools` enforcement via beforeToolCall hook | REQ-SKL-9 | `src/agent/loop.ts` |

**Tests:** OCP dynamic import. Stall helper isolation. ModelInterface adapter bundling. Done injection. IPv6 blocking.

---

## Phase 11 — REQUIREMENTS.md Update (P3)

| Task | Requirements | Files |
|------|-------------|-------|
| Replace Python-specific references (Rich, prompt_toolkit, pyproject.toml, `cli/` paths) | — | `REQUIREMENTS.md` |
| Update REQ-ARCH-1 for TypeScript | — | `REQUIREMENTS.md` |
| Update REQ-UI-1/8/9 for Ink instead of prompt_toolkit/Rich | — | `REQUIREMENTS.md` |
| Update REQ-TEST-1/2 for vitest + MockAdapter instead of FauxProvider/pytest | — | `REQUIREMENTS.md` |
| Add missing TUI requirements discovered during refactor (markdown rendering, spacing) | — | `REQUIREMENTS.md` |
| Update verification plan table for TypeScript test file paths | — | `REQUIREMENTS.md` |

---

## Summary

| Phase | Priority | Est. Effort | Unlocks |
|-------|----------|-------------|---------|
| 1. Streaming | P0 | Large | Chat UX, compact, gather telemetry |
| 2. Tool Handlers | P0 | Large | Full chat capability |
| 3. Context Management | P0 | Medium | Long session viability |
| 4. Permission Gate | P0 | Medium | Safe chat operation |
| 5. Idea Flow | P1 | Medium | Idea-to-requirements pipeline |
| 6. Concurrent Dispatch | P1 | Medium | Develop/verify performance |
| 7. Chat Polish | P1 | Medium | Production-quality TUI |
| 8. Plan & Gather Gaps | P1-P2 | Medium | Full pipeline features |
| 9. Operational Infra | P2 | Medium | Observability, skills CLI |
| 10. Architecture Cleanup | P3 | Medium | Code quality, extensibility |
| 11. Requirements Update | P3 | Small | Document accuracy |

**Phases 1-4 are required for production use. Phases 5-8 complete the feature set. Phases 9-11 are operational and structural polish.**
