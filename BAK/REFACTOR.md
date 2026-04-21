# REFACTOR.md — Closing the Remaining Audit Gaps

**Source:** AUDIT.md (2026-04-16, post-refactor)
**Current:** 105 PASS (70%), 30 PARTIAL (20%), 15 FAIL (10%)
**Target:** Close all FAIL items and high-impact PARTIAL items.

---

## Phase 1 — Verify Tools (FAIL × 3)

The verify command can plan tests but can't execute them. These three stubs block the entire verify-execute pipeline.

| Task | Requirements | Files |
|------|-------------|-------|
| Implement `startProcess()` — spawn child process, return handle ID, buffer stdout/stderr | REQ-VF-8 | `src/tools/process.ts` |
| Implement `waitForReady()` — http/port/log_pattern strategies with timeout | REQ-VF-9 | `src/tools/process.ts` |
| Implement HTTP client with per-session cookie/auth persistence | REQ-VF-12 | `src/tools/http.ts` |

**Tests:** Process start/read_output/stop. waitForReady with mock server. HTTP session cookie persistence.

---

## Phase 2 — HTTP Tool for Chat (FAIL × 1)

| Task | Requirements | Files |
|------|-------------|-------|
| Implement `http(action="get")` — SSRF check, fetch, strip markup, sub-agent summary, URL cache | REQ-U-8, REQ-TOOL-5 | `src/tools/http.ts`, `src/tools/builder.ts` |
| Wire via `web_fetch_kwargs` build-time pattern in `buildDomainHandlers` | REQ-TOOL-5 | `src/tools/builder.ts` |

**Tests:** SSRF integration. Fetch + summary. Cache hit skips HTTP. Error returns message.

---

## Phase 3 — Quick Fixes (FAIL × 4, PARTIAL × 8)

Small, independent items that can be done in a single pass.

| Task | Requirements | Files |
|------|-------------|-------|
| Remove plan auto-commit (contradicts REQ-P-4 / REQ-GIT-3) | REQ-GIT-3, REQ-P-4 | `src/commands/plan.ts` |
| Gather: wire `makeChunks()` into `runSourceAnalysis()` for large files | REQ-G-13 | `src/commands/gather.ts` |
| Gather: use `stream: true` on all agents | REQ-G-12 | `src/commands/gather.ts` |
| Gather: read source files through WriteContext (pagination/sandbox) | REQ-G-18 | `src/commands/gather.ts` |
| Gather: implement `--idea` mode (read idea file, generate reqs, update idea) | REQ-G-1 | `src/commands/gather.ts` |
| Doctor: check optional deps (pdf-parse, mammoth, xlsx) | REQ-U-16a | `src/commands/doctor.ts` |
| Wire `askFn` into chat's `buildLocalTools` call | REQ-U-12 | `src/commands/chat.ts` |
| Add `reason` field to `[ITERATION]` log entries | REQ-ARCH-18 | `src/agent/loop.ts` |
| Explicit "models file missing" check before `resolveModel` | REQ-CFG-8 | `src/index.ts` |
| Code analysis: add path sandboxing | REQ-U-20 | `src/tools/builder.ts` |
| `done()` tool call triggers final text-only call | REQ-ARCH-4 | `src/agent/loop.ts` |
| Rename `/ask` to `/quick` per spec | REQ-U-15 | `src/commands/chat.ts` |

**Tests:** Chunking integration. Streaming gather. Idea-to-reqs flow. Doctor optional deps. Done final call.

---

## Phase 4 — UI Polish (FAIL × 3, PARTIAL × 9)

| Task | Requirements | Files |
|------|-------------|-------|
| Input history — Up/Down arrow cycling | REQ-UI-16 | `src/tui/App.tsx` |
| `--style` differentiation — verbose/terse/raw rendering paths | REQ-UI-12 | `src/commands/chat.ts`, `src/tui/Message.tsx` |
| Multi-line input (Ctrl+J / backslash+Enter) | REQ-UI-3 | `src/tui/App.tsx` |
| Tool call display: purple dot `●` instead of action-colored bars | REQ-UI-1a | `src/tui/ToolCall.tsx` |
| Pending message visual: yellow `┃` bar, dotted rule, hint line | REQ-UI-15 | `src/tui/App.tsx`, `src/tui/Message.tsx` |
| Footer: branch color `#c678dd`, background `#1a1a2e` | REQ-UI-6 | `src/tui/Footer.tsx` |
| Header: ASCII art color `#c678dd`, callout background `#13132a` | REQ-UI-7 | `src/tui/Header.tsx` |
| Status: emoji indicators (✅, ⬜, 🔄) | REQ-U-1 | `src/commands/status.ts` |
| Stats format: `(elapsed · tkns: ↓ Nk - ↑ Nk · ctx N%)` | REQ-UI-10 | `src/tui/state.ts`, `src/commands/chat.ts` |
| Empty response fallback: "(Completed: ...)" or "(No response)" | REQ-UI-14 | `src/commands/chat.ts` |
| Interactive mode when `voidrift` run with no args | REQ-ARCH-3 | `src/index.ts` |

**Tests:** History cycling. Style rendering. Emoji output. Stats format.

---

## Phase 5 — Skills Synthesis (FAIL × 3, PARTIAL × 1)

| Task | Requirements | Files |
|------|-------------|-------|
| `voidrift skills install <name>` — synthesis pipeline with pending dir | REQ-SKL-5 | new `src/commands/skills.ts`, `src/index.ts` |
| `voidrift skills approve <name>` — move pending to active | REQ-SKL-5 | `src/commands/skills.ts` |
| `voidrift skills remove <name>` — delete domain skill | REQ-SKL-4 | `src/commands/skills.ts` |
| Manifest fetching from configured repos | REQ-SKL-6 | `src/commands/skills.ts` |
| On-the-fly synthesis when `findSkill` returns null + synthesis_model configured | REQ-SKL-10 | `src/skills.ts` |

**Tests:** Install writes to pending. Approve moves to active. Remove deletes. Manifest fetch.

---

## Phase 6 — Remaining PARTIAL Items

| Task | Requirements | Files |
|------|-------------|-------|
| Idea `--idea` on plan: gate on missing `reqs:`, auto-archive when all tasks verified | REQ-IDEA-5 | `src/commands/plan.ts`, `src/manifest.ts` |
| Bug entity creation API in ManifestManager | REQ-TM-7 | `src/manifest.ts` |
| Orphaned task interactive prompt in TTY mode | REQ-D-16 | `src/commands/develop.ts` |
| Document extraction logic (pdf-parse, mammoth, xlsx) | REQ-U-19 | `src/tools/builder.ts` |

**Tests:** Idea archival. Bug creation. Orphan prompt. Document extraction.

---

## Summary

| Phase | Items | Est. Effort | Unlocks |
|-------|-------|-------------|---------|
| 1. Verify Tools | 3 FAIL | Medium | Verify can execute tests against running servers |
| 2. HTTP Tool | 1 FAIL + 1 PARTIAL | Medium | Chat web research |
| 3. Quick Fixes | 4 FAIL + 8 PARTIAL | Small | Correctness, gather completeness |
| 4. UI Polish | 3 FAIL + 9 PARTIAL | Medium | Production-quality TUI |
| 5. Skills Synthesis | 3 FAIL + 1 PARTIAL | Medium | Domain skill ecosystem |
| 6. Remaining PARTIAL | 4 PARTIAL | Small | Feature completeness |

**Phases 1-3 close all FAIL items except UI and skills. Phase 4 handles UI. Phase 5 handles skills. Phase 6 mops up.**
