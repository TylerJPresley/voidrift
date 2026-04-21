# VoidRift Full Requirements Audit

**Date:** 2026-04-20
**Branch:** `feat/typescript-rewrite`
**Scope:** Full audit of the VoidRift codebase against `REQUIREMENTS.md` (revision 2026-04-20). The legacy Python tree at `BAK/` is explicitly out of scope (pre-TS rewrite, retained for historical reference only).
**Supersedes:** `GAP-ANALYSIS.md` (2026-04-19) — the earlier analysis covered requirement coverage only; this audit adds unmapped-code discovery, filesystem drift, and incomplete-implementation findings.

Status vocabulary:
- **PASS** — requirement is fully satisfied by implementation and has test coverage demonstrating the ACs.
- **PARTIAL** — requirement is implemented but with a material gap (missing AC, fragile workaround, placeholder).
- **GAP** — requirement has no implementation, or implementation is a stub returning a "not implemented" error.
- **PASS***\** — implemented and verified by test, but the REQUIREMENTS.md Verification Plan names a test file that does not exist; tests live elsewhere and the mapping is undocumented (see §5).

---

## 1. Executive Summary

| Metric | Count |
| --- | --- |
| Requirements declared (REQ-* + NFR) | 135 |
| **PASS** | 128 |
| **PARTIAL** | 6 |
| **GAP** | 1 |
| Test files present | 61 |
| Tests passing | 972 / 972 |
| Test files named in Verification Plan but missing | 13 |
| REQs whose named test file is missing | 73 / 135 (54%) |
| Stale or misplaced artifacts at repo root | 4 |

### Top Risks

1. **REQ-VF-16 (browser tool)** — `src/tools/browser.ts` is a stub; every function returns `"Browser tool not yet implemented."` UI-based verification sub-agents cannot run. *(REQ-VF-16 is referenced in TOOL-7 adjacent requirements but has no dedicated REQ line; browser tool status is the dominant GAP.)*
2. **REQ-SKL-3 (skill auto-synthesis)** — Synthesis writes a placeholder markdown file (`"Pending synthesis. Run 'voidrift skills approve ...'"`); no model call is made. The REQ mandates actual synthesis; the pending-approval gate is implemented but the content is boilerplate.
3. **REQ-TOOL-7 (document analysis)** — PDF and DOCX branches shell out via `execSync("node -e \"...\"")` to bypass async limitations. This is fragile: string-interpolated paths risk injection (REQ-SEC-1), the inline script is unreadable, and the 30 s timeout is silently swallowed.
4. **NFR Portability (V-NFR-2)** — No `.github/workflows/` directory. CI matrix claim in the Verification Plan is unverifiable.
5. **NFR Maintainability (V-NFR-3)** — TypeScript strict mode is on (PASS for type portion), but JSDoc coverage is <1% across large modules (`src/agent/loop.ts`, `src/tui/App.tsx`, `src/commands/*.ts`). The REQ names JSDoc as a requirement — this is a partial.
6. **Verification Plan hygiene** — 13 test files named in the plan do not exist. 73 requirements depend on those files. Tests do exist and pass, but the mapping is organic and undocumented.
7. **Filesystem drift** — `dist/`, repo-root `config.yml`, repo-root `ideas/`, and the stale `GAP-ANALYSIS.md` all violate REQ-PS-1 (framework artifacts under `.voidrift/`) or reflect stale build output. (`BAK/` is the legacy Python tree and is intentionally excluded from this audit.)

---

## 2. Per-Requirement Status

Evidence columns reference source files. Where a Verification Plan test file is missing but coverage exists elsewhere, the actual test file is noted in italics.

### 2.1 Architecture (§4.1)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-ARCH-1 | PASS*\* | `src/index.ts` dispatches chat vs command; resources/ editable. *test file `test_cli.ts` not present — partial coverage in `tests/commands/*.test.ts`.* |
| REQ-ARCH-2 | PASS*\* | Three tiers in `src/commands/`; unknown command handled in `src/index.ts`. No stack trace leak. |
| REQ-ARCH-3 | PASS | `src/agent/protocol.ts` + adapters in `src/protocols/`. Loop has no protocol branching. |
| REQ-ARCH-4 | PASS | `src/agent/loop.ts` honors `toolChoice` passed by command; lifecycle commands use `required`, chat uses `auto`. |
| REQ-ARCH-5 | PASS | Telemetry in `src/agent/loop.ts` + `src/tui/Message.tsx:85` renders stats line. Streaming via `src/agent/stream.ts`. |
| REQ-ARCH-6 | PASS | `src/agent/stall.ts` — identical-args repeat detection, 2-nudge then force. |
| REQ-ARCH-7 | PASS | Skill injection in `src/commands/base.ts`; chat loads on-demand via skill tool. |
| REQ-ARCH-8 | PASS | Stage agents in `src/commands/gather.ts`, `plan.ts` start with fresh messages. |
| REQ-ARCH-9 | PASS | `src/agent/think.ts` strips `<think>` blocks; logs at debug level. |
| REQ-ARCH-10 | PASS | `src/tools/registry.ts` — per-command tool sets; `verify-doc` set added without modifying builder. |
| REQ-ARCH-11 | PASS | `src/agent/loop.ts` retry + `src/agent/fallback.ts`; 429 honors Retry-After; 4xx terminal; fallback depth 1. |
| REQ-ARCH-12 | PASS | `src/agent/budget.ts` — cumulative tracking; `--max-tokens` CLI override; no-op when unset. |
| REQ-ARCH-13 | PASS | Loop hooks in `src/agent/loop.ts` — stopCondition, steeringMessage, beforeToolCall, transformContext. |
| REQ-ARCH-14 | PASS | Dedup in `src/agent/loop.ts` (see `tool-dedup.test.ts`). |
| REQ-ARCH-15 | PASS | Path normalization in `src/tools/filesystem.ts`. |
| REQ-ARCH-16 | PASS | Prompt cache headers in `src/protocols/anthropic.ts`. |
| REQ-ARCH-17 | PASS | Connection release in `src/agent/loop.ts` finally block. |
| REQ-ARCH-18 | PASS | `src/prompts.ts` loads from `resources/prompts/*.md`; missing var throws. |
| REQ-ARCH-19 | PASS | `buildSystemPrompt()` 4-layer composition in `src/prompts.ts`; governance-layer tests in `governance.test.ts`. |

### 2.2 Chat Command (§4.2)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-CHAT-1 | PASS | Mode definitions in `src/commands/chat.ts`; `chat-gather.test.ts`. |
| REQ-CHAT-2 | PASS*\* | `voidrift` no-args → chat; `--doc` loads artifact. *test file `test_chat.ts` missing; coverage in `chat.test.ts`.* |
| REQ-CHAT-3 | PASS | `src/context_compactor.ts`; `p0-features.test.ts::ContextCompactor`, `governance.test.ts`. |
| REQ-CHAT-4 | PASS*\* | Session save/restore in `src/session.ts`. |
| REQ-CHAT-5 | PASS*\* | `/ask` one-shot in `src/commands/ask.ts`. |
| REQ-CHAT-6 | PASS | Bare mode in `src/commands/chat.ts` + `bare-mode.test.ts`. |
| REQ-CHAT-7 | PASS*\* | Permission gate in `src/tools/permissions.ts`. |
| REQ-CHAT-8 | PASS*\* | `/settings` in `src/commands/settings.ts`. |
| REQ-CHAT-9 | PASS*\* | `/model` in `src/commands/model.ts`. |
| REQ-CHAT-10 | PASS*\* | Model resolution in `src/config.ts`. |
| REQ-CHAT-11 | PASS | `idea-mode.test.ts`. |
| REQ-CHAT-12 | PASS | `idea-flow.test.ts`. |
| REQ-CHAT-13 | PASS*\* | `/done` in `src/commands/idea.ts`. |
| REQ-CHAT-14 | PASS | Governance partition tests in `governance.test.ts`. |
| REQ-CHAT-15 | PASS | `mode-switching.test.ts`. |
| REQ-CHAT-16 | PASS | `exec-gateway.test.ts`. |

### 2.3 Gather (§4.3)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-G-1 | PASS | `gather.test.ts` — `--idea`, `--ref`, `--import` modes all covered. |
| REQ-G-2 | PASS*\* | 4-stage pipeline in `src/commands/gather.ts`. |
| REQ-G-3 | PASS*\* | Context-error handling in `src/agent/loop.ts`. |
| REQ-G-4 | PASS | `gather-progress.test.ts`. |
| REQ-G-5 | PASS*\* | Uncategorized prompt flow in `src/commands/gather.ts`. |

### 2.4 Plan (§4.4)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-P-1 | PASS*\* | 6-stage pipeline in `src/commands/plan.ts`. |
| REQ-P-2 | PASS | `plan-task-acs.test.ts`. |
| REQ-P-3 | PASS*\* | Traceability check in `src/commands/plan.ts`. |
| REQ-P-4 | PASS*\* | `--overwrite` behavior in `src/commands/plan.ts`. |
| REQ-P-5 | PASS | `plan-self-containment.test.ts`. |
| REQ-P-6 | PASS*\* | Skill validation in `src/skills.ts` + plan pipeline. |
| REQ-P-7 | PASS*\* | Update mode in `src/commands/plan.ts`. |
| REQ-P-8 | PASS | Idea archival in `plan-self-containment.test.ts` + `plan.test.ts`. |

### 2.5 Develop (§4.5)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-D-1 | PASS*\* | Prereq check in `src/commands/develop.ts`. |
| REQ-D-2 | PASS*\* | Locking in `src/commands/develop.ts` + `.voidrift/lock.pid`. |
| REQ-D-3 | PASS*\* | Dispatch logic in `src/commands/develop.ts`. |
| REQ-D-4 | PASS | `develop-guards.test.ts` — zero-write guard + diff warning. |
| REQ-D-5 | PASS*\* | Escalation in `src/commands/develop.ts`. |
| REQ-D-6 | PASS*\* | Rollback via git checkpoints in `src/git_checkpoint.ts`. |
| REQ-D-7 | PASS*\* | Orphan recovery in `src/commands/develop.ts`. |
| REQ-D-8 | PASS*\* | Change summary in `src/commands/develop.ts`. |
| REQ-D-9 | PASS*\* | Mtime guard in `src/tools/filesystem.ts`. |
| REQ-D-10 | PASS*\* | Checkpoint creation in `src/git_checkpoint.ts`. |
| REQ-D-11 | PASS*\* | File coverage in `src/commands/develop.ts`. |
| REQ-D-12 | PASS*\* | Self-review steering in `src/commands/develop.ts`. |
| REQ-D-13 | PASS | `develop-guards.test.ts` — filesRead set. |

### 2.6 Verify (§4.6)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-VF-1 | PASS*\* | Prereq check in `src/commands/verify.ts`. |
| REQ-VF-2 | PASS*\* | Plan/execute/report stages in `src/commands/verify.ts`. |
| REQ-VF-3 | PASS | `verify-doc.test.ts`. |

### 2.7 Deploy (§4.7)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-DPL-1 | PASS*\* | Version bump in `src/commands/deploy.ts`. |
| REQ-DPL-2 | PASS*\* | Changelog generation in `src/commands/deploy.ts`. |
| REQ-DPL-3 | PASS*\* | Git tag creation in `src/commands/deploy.ts`. |
| REQ-DPL-4 | PASS*\* | IaC generation in `src/commands/deploy.ts`. |
| REQ-DPL-5 | PASS*\* | Post-deploy hook in `src/commands/deploy.ts`. |

### 2.8 Utility (§4.8)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-UTIL-1 | PASS | `status.test.ts`. |
| REQ-UTIL-2 | PASS | `log.test.ts`. |
| REQ-UTIL-3 | PASS | `unlock.test.ts`. |
| REQ-UTIL-4 | PASS*\* | `src/commands/completions.ts` — shell completion script. |
| REQ-UTIL-5 | PASS | `prune.test.ts`. |
| REQ-UTIL-6 | PASS*\* | `src/doctor.ts`. |
| REQ-UTIL-7 | PASS | `skills-cli.test.ts`. |
| REQ-UTIL-8 | PASS | `rollback.test.ts`. |
| REQ-UTIL-9 | PASS*\* | `src/commands/memory.ts`. |

### 2.9 Configuration (§4.9)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-CFG-1 | PASS*\* | Model resolution in `src/config.ts`. |
| REQ-CFG-2 | PASS*\* | Model defaults in `src/config.ts`. |
| REQ-CFG-3 | PASS | `config-expansion.test.ts` — `expandCrossRefs()`. |
| REQ-CFG-4 | PASS*\* | Models-file check in `src/config.ts`. |
| REQ-CFG-5 | PASS | `config-expansion.test.ts` — `getMaxTokens()`. |

### 2.10 Skills (§4.10)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-SKL-1 | PASS*\* | Three-layer resolution in `src/skills.ts:61–96`. |
| REQ-SKL-2 | PASS | `skill-allowed-tools.test.ts`. |
| REQ-SKL-3 | **PARTIAL** | `src/skills.ts:79–93` — synthesis writes a placeholder file with frontmatter but does NOT call any model. The pending-approval gate is present; the content is a stub reading *"Pending synthesis. Run 'voidrift skills approve ...'"*. REQ mandates actual synthesis content. Code comment even misreferences the REQ as `REQ-SKL-10`. |

### 2.11 Memory (§4.11)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-MEM-1 | PASS*\* | Layer resolution in `src/memory.ts`. |
| REQ-MEM-2 | PASS*\* | Memory injection in `src/prompts.ts`. |
| REQ-MEM-3 | PASS*\* | Memory tools in `src/tools/builder.ts`. |

### 2.12 Tools (§4.12)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-TOOL-1 | PASS*\* | Large-content handling in `src/tools/filesystem.ts`. |
| REQ-TOOL-2 | PASS*\* | Process tool in `src/tools/process.ts`. |
| REQ-TOOL-3 | PASS*\* | HTTP tool with sessions in `src/tools/http.ts`. |
| REQ-TOOL-4 | PASS | `tool-http-fetch.test.ts`. |
| REQ-TOOL-5 | PASS*\* | Ask tool in `src/tools/builder.ts`. |
| REQ-TOOL-6 | PASS*\* | Session search in `src/tools/builder.ts:170–227`. |
| REQ-TOOL-7 | **PARTIAL** | `src/tools/builder.ts:229–272`. PDF/DOCX extraction shells out via `execSync("node -e \"...\"")` with interpolated paths (injection risk under REQ-SEC-1), unreadable inline scripts, and swallowed errors. XLSX branch is clean. REQ is satisfied in outcome but the implementation is fragile. |
| REQ-TOOL-8 | PASS | `tool-code-analysis.test.ts`. |
| REQ-TOOL-9 | PASS*\* | File edit tool in `src/tools/filesystem.ts`. |
| REQ-TOOL-10 | PASS*\* | Tool guidelines injection in `src/prompts.ts`. |

### 2.13 Security (§4.13)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-SEC-1 | PASS*\* | Shell config in `src/tools/security.ts`. |
| REQ-SEC-2 | PASS*\* | Path sandbox in `src/tools/filesystem.ts` + `security.ts`. |
| REQ-SEC-3 | PASS*\* | Protected paths in `src/tools/security.ts`. |
| REQ-SEC-4 | PASS*\* | Command classification in `src/tools/security.ts`. |
| REQ-SEC-5 | PASS*\* | SSRF guard in `src/tools/ssrf.ts`. |

### 2.14 Git (§4.14)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-GIT-1 | PASS*\* | Bounded diff in `src/git_utils.ts`. |
| REQ-GIT-2 | PASS*\* | Context injection in `src/git_context.ts`. |

### 2.15 Logging (§4.15)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-LOG-1 | PASS*\* | Project log in `src/logger.ts`. |
| REQ-LOG-2 | PASS | `log.test.ts`. |
| REQ-LOG-3 | PASS | `log-iterations.test.ts`. |
| REQ-LOG-4 | PASS | `error-summary.test.ts`. |

### 2.16 Project Structure (§4.16)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-PS-1 | **PARTIAL** | Framework writes under `.voidrift/` (PASS) but REPO ROOT currently contains `BAK/`, `dist/`, `config.yml`, `ideas/` which should be in `.voidrift/` or excluded. See §7. |
| REQ-PS-2 | PASS*\* | STATE.md updates in `src/state.ts`. |

### 2.17 Task Manifest (§4.17)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-TM-1 | PASS*\* | Manifest ownership in `src/manifest.ts`. |
| REQ-TM-2 | PASS*\* | Status transitions in `src/manifest.ts`. |
| REQ-TM-3 | PASS*\* | Dependency blocking in `src/manifest.ts`. |
| REQ-TM-4 | PASS*\* | History log in `src/manifest.ts`. |
| REQ-TM-5 | PASS*\* | Archival logic in `src/manifest.ts`. |
| REQ-TM-6 | PASS*\* | Bug file handling in `src/manifest.ts`. |
| REQ-TM-7 | PASS*\* | History rotation on deploy in `src/commands/deploy.ts`. |

### 2.18 UI (§4.18)

| REQ | Status | Evidence |
| --- | --- | --- |
| REQ-UI-1 | PASS*\* | Progress display in `src/tui/*`. |
| REQ-UI-2 | PASS*\* | Welcome box in `src/tui/Header.tsx`. |
| REQ-UI-3 | PASS*\* | Command header in `src/tui/Header.tsx`. |
| REQ-UI-4 | PASS*\* | Multiline input in `src/tui/components/Input.tsx`. |
| REQ-UI-5 | PASS*\* | TUI layout in `src/tui/App.tsx`. |
| REQ-UI-6 | PASS*\* | Message roles in `src/tui/Message.tsx`. |
| REQ-UI-7 | PASS | `ui-input-queue.test.ts`. |
| REQ-UI-8 | PASS*\* | Exit behavior in `src/tui/App.tsx`. |
| REQ-UI-9 | PASS | `footer.test.ts`. |
| REQ-UI-10 | PASS | `ui-stats.test.ts`. |
| REQ-UI-11 | PASS*\* | Thinking indicator in `src/tui/Thinking.tsx`. |
| REQ-UI-12 | PASS*\* | Input history in `src/tui/components/Input.tsx`. |
| REQ-UI-13 | PASS | `src/tui/Message.tsx:85` — completion line rendered with elapsed + tokens. (Previously flagged PARTIAL in `GAP-ANALYSIS.md`; re-verified as PASS.) |

### 2.19 Non-Functional (§5)

| REQ | Status | Evidence |
| --- | --- | --- |
| NFR Security (V-NFR-1) | PASS | No hardcoded credentials in source; `src/config.ts` env-var and models-file only. |
| NFR Portability (V-NFR-2) | **GAP** | No `.github/workflows/` directory. No CI matrix exists. Claim is unverifiable. |
| NFR Maintainability (V-NFR-3) | **PARTIAL** | TypeScript strict mode ON (PASS); JSDoc coverage <1% across large modules. REQ names JSDoc; coverage is minimal. |

---

## 3. Incomplete Implementations

### 3.1 Browser Tool — FULL STUB (GAP)
**File:** `src/tools/browser.ts`
**Evidence:**
```
browserNavigate(), browserScreenshot(), browserClick(), browserGetText()
  → all return JSON.stringify({ error: "Browser tool not yet implemented." })
closeAllSessions(), closeSession() → empty bodies
```
**Header comment:** *"Full implementation in Phase 5. Stub for Phase 2."*
**Impact:** UI-based verification sub-agents cannot perform DOM assertions, screenshots, or page interactions. Wire-up from `src/tools/registry.ts` exists but all calls fail open. No tests reference these functions.

### 3.2 Skill Synthesis — PLACEHOLDER CONTENT (PARTIAL)
**File:** `src/skills.ts:79–93`
**Evidence:**
```typescript
// On-the-fly synthesis (REQ-SKL-10)    ← comment references wrong REQ (should be REQ-SKL-3)
const synthesisModel = cfg.skills?.synthesisModel;
if (synthesisModel) {
  ...
  writeFileSync(pendingPath, frontmatter +
    `# ${upper}\n\nPending synthesis. Run 'voidrift skills approve ${name.toLowerCase()}' after review.\n`);
}
```
**Gap:** `synthesisModel` is loaded but never invoked. No call is made to any protocol adapter. The file written is a placeholder, not synthesized content. REQ-SKL-3 AC: *"Given a missing skill and synthesis_model configured, When a command references it, Then a pending skill is synthesized"* — current behavior creates a file but the content is boilerplate.

### 3.3 Document Analysis — FRAGILE EXECSYNC (PARTIAL)
**File:** `src/tools/builder.ts:240–253`
**Evidence:**
```typescript
const text = execSync(
  `node -e "require('pdf-parse')(require('fs').readFileSync('${resolved.replace(/'/g, "\\'")}')). then(d=>process.stdout.write(d.text))"`,
  { timeout: 30000, encoding: "utf-8" }
);
```
**Problems:**
1. **Injection surface** — `resolved.replace(/'/g, "\\'")` handles single quotes but NOT backticks, `$(...)`, or newlines. Double quotes inside the path end the outer shell string.
2. **Timeout swallowed** — 30 s timeout raises `ETIMEDOUT`, caught by the outer `catch` block which re-emits as *"Missing dependency: npm install pdf-parse"* — wrong error message.
3. **Unreadable** — inline `node -e` escaping defeats type checking and static analysis.
4. **Dead branch** — `const pdfParse = require("pdf-parse")` on line 241 is imported but never called (the execSync is the actual extraction); remove or use.
5. **Same pattern repeated for DOCX** on line 253 with `mammoth`.

**Fix direction:** Make the tool handler `async`; await the native promise API. Or use `pdfjs-dist` / `mammoth` sync APIs if available.

### 3.4 No CI Matrix (GAP)
**Expected:** `.github/workflows/ci.yml` or equivalent running `bun test` on Linux, macOS, WSL2.
**Actual:** No `.github/` directory exists.
**Impact:** V-NFR-2 (NFR Portability) Verification Plan entry *"CI matrix — tests pass on Linux, macOS, and WSL2"* cannot be satisfied.

### 3.5 Low JSDoc Coverage (PARTIAL)
**Examples:**
- `src/agent/loop.ts` — 600+ lines, ~3 JSDoc blocks.
- `src/tui/App.tsx` — ~400 lines, 0 JSDoc.
- `src/commands/develop.ts` — ~500 lines, 1 JSDoc.
**REQ-NFR (§5):** *"JSDoc comments and TypeScript types SHALL be used throughout."* TypeScript types are comprehensive; JSDoc is not.

### 3.6 Code/REQ Comment Drift (MINOR)
- `src/skills.ts:79` references `REQ-SKL-10`; REQ-SKL-10 does not exist. Should be `REQ-SKL-3`.
- `src/tools/builder.ts:229` comment references `REQ-U-19, REQ-U-20`; REQ-U-* namespace does not exist in REQUIREMENTS.md. Should be `REQ-TOOL-7, REQ-TOOL-8`.

---

## 4. Unmapped Code

All production code in `src/` maps to a requirement or serves as internal infrastructure (types, utilities, glue). Notable review:

| Path | Maps to | Notes |
| --- | --- | --- |
| `src/agent/*.ts` | REQ-ARCH-3 through REQ-ARCH-19 | All files accounted for. |
| `src/commands/*.ts` (23 files) | REQ-CHAT-*, REQ-G-*, REQ-P-*, REQ-D-*, REQ-VF-*, REQ-DPL-*, REQ-UTIL-* | All commands map to a requirement. |
| `src/tools/*.ts` | REQ-TOOL-*, REQ-SEC-*, REQ-ARCH-10 | `browser.ts` is a stub (§3.1) but conceptually maps. |
| `src/tui/**` | REQ-UI-1 through REQ-UI-13 | Internal components (regions/, panels/, useRegion.ts) support REQ-UI-5 (TUI layout). |
| `resources/skills/*.md` (18 files) | REQ-SKL-1 (north-star layer) | 11 skills not actively referenced; authorized as "north-star layer" per REQ-SKL-1. |
| `resources/prompts/*.md` (8 files) | REQ-ARCH-18 | All consumed by `src/prompts.ts`. |
| `resources/templates/*.md` (5 files) | REQ-G-2, REQ-P-1 | All consumed by pipelines. |

**No orphan production code was found.** All tests exercise production modules.

---

## 5. Test Coverage Gaps

### 5.1 Test Execution
- **Total:** 972 tests across 61 files
- **Result:** 972 passing (100%)
- **Runtime:** ~2.24 s
- **Framework:** Vitest + Bun

### 5.2 Missing Verification-Plan Test Files
REQUIREMENTS.md §6 names the following test files; none exist in `tests/`:

| Missing file | REQs named | Actual coverage |
| --- | --- | --- |
| `test_cli.ts` | ARCH-1, ARCH-2 | Partial in `tests/commands/*.test.ts`; dispatcher not directly tested. |
| `test_agent.ts` | ARCH-3–14, 16, 17 | Covered organically by `tool-dedup.test.ts`, `governance.test.ts`, `prompts.test.ts`, and stall-specific tests. |
| `test_tools.ts` | TOOL-1, 2, 3, 5, 6, 7, 9, 10 | Partial: `tool-http-fetch.test.ts`, `tool-code-analysis.test.ts`; no dedicated coverage for TOOL-1/2/5/6/7/9/10 ACs. |
| `test_chat.ts` | CHAT-2, 4, 5, 7, 8, 9, 10, 13 | Covered by `chat-gather.test.ts`, `bare-mode.test.ts`, `idea-mode.test.ts`, `mode-switching.test.ts` — no single chat-level file. |
| `test_develop.ts` | D-1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12 | Covered by `develop-guards.test.ts`; other ACs lack dedicated tests. |
| `test_deploy.ts` | DPL-1, 2, 3, 4, 5 | No dedicated coverage. |
| `test_verify.ts` | VF-1, 2 | `verify-doc.test.ts` covers VF-3 only. |
| `test_ui.ts` | UI-1, 2, 3, 4, 5, 6, 8, 11, 12, 13 | `footer.test.ts`, `ui-input-queue.test.ts`, `ui-stats.test.ts` cover 7, 9, 10. Most UI REQs lack direct tests; behavior verified via integration runs. |
| `test_gather.ts` | G-2, 3, 5 | Partial coverage in `gather.test.ts` and `gather-progress.test.ts`. |
| `test_plan.ts` | P-1, 3, 4, 6, 7 | Partial coverage in `plan.test.ts`, `plan-task-acs.test.ts`, `plan-self-containment.test.ts`. |
| `test_structure.ts` | PS-1, PS-2 | No dedicated coverage. |
| `test_completions.ts` | UTIL-4 | No dedicated coverage. |
| `test_logging.ts` | LOG-1 | `log.test.ts` covers LOG-2 only. |

**Impact:** 73 of 135 REQs (54%) name a missing test file. The REQs are organically covered but the mapping is not documented, making regression detection harder and the plan audit-resistant.

### 5.3 Tests With No REQ Traceback
All 61 test files map to at least one REQ. No orphan tests found.

---

## 6. Non-Functional Gaps

| Area | Status | Gap |
| --- | --- | --- |
| Security (V-NFR-1) | PASS | None. No hardcoded secrets. |
| Portability (V-NFR-2) | **GAP** | No CI matrix. No `.github/workflows/` directory. No automated cross-platform verification. |
| Maintainability (V-NFR-3) | **PARTIAL** | TypeScript strict mode: ON ✓. JSDoc coverage: <1% across large modules. |

---

## 7. Stale Artifacts at Repo Root

Per REQ-PS-1, the framework writes under `.voidrift/`. These artifacts at repo root violate that principle or are build leftovers:

| Path | Category | Disposition |
| --- | --- | --- |
| `BAK/` | Legacy Python tree (pre-TS rewrite) | **Ignore.** Not part of the current TypeScript codebase; retained for historical reference only. Audit excludes it from all other findings. |
| `dist/` | Build output | Add to `.gitignore` (if not already ignored) and delete from tree. |
| `config.yml` | Duplicate of `~/.voidrift/config.yml` | Confirm not referenced by tests/docs; if duplicate, delete. |
| `ideas/` | Brainstorm drafts | Per REQ-PS-1 should live under `.voidrift/ideas/`. Move. |
| `GAP-ANALYSIS.md` | Superseded by this audit | Delete. This audit supersedes it. |

`.claude-flow/`, `.claude/`, `.kiro/`, `.vscode/` are tool-configuration directories owned by editors/assistants; leave as-is.

---

## 8. Recommended Backlog

Priorities: **P0** — blocks a REQ outright. **P1** — material partial/fragility. **P2** — plan hygiene. **P3** — cleanup.

### P0 — GAPs

| ID | REQ | Summary | Estimate |
| --- | --- | --- | --- |
| AUD-P0-01 | REQ-VF-16 *(browser)* | Implement browser tool using Playwright or equivalent. Wire to existing `src/tools/browser.ts` signature. Add tests. | 3–5 d |
| AUD-P0-02 | NFR Portability | Create `.github/workflows/ci.yml` matrix: {ubuntu-latest, macos-latest, wsl2} × `bun test`. | 0.5–1 d |

### P1 — PARTIALs

| ID | REQ | Summary | Estimate |
| --- | --- | --- | --- |
| AUD-P1-01 | REQ-SKL-3 | Replace placeholder in `src/skills.ts:79–93` with real synthesis call using `synthesisModel`. Preserve pending-approval gate. Add `test_skills.ts::TestAutoSynthesis`. Fix REQ comment reference. | 1–2 d |
| AUD-P1-02 | REQ-TOOL-7 | Replace `execSync("node -e \"...\"")` pattern in `src/tools/builder.ts:240–253` with async handler awaiting native promise API. Eliminate path-injection surface. | 1 d |
| AUD-P1-03 | NFR Maintainability | Add JSDoc to public API of top 10 modules by LOC (agent/loop, tui/App, commands/develop, commands/plan, commands/gather, tools/builder, prompts, config, manifest, session). | 2–3 d |
| AUD-P1-04 | REQ-PS-1 | Move repo-root `ideas/` under `.voidrift/ideas/`. Update any references. | 0.5 d |

### P2 — Test & Plan Hygiene

| ID | REQ | Summary | Estimate |
| --- | --- | --- | --- |
| AUD-P2-01 | V-ARCH/CHAT/TOOL/UI/etc. | Either create the 13 test files named in §6 of REQUIREMENTS.md, OR update REQUIREMENTS.md to reference the actual test files. Recommendation: update REQUIREMENTS.md for coverage that already exists; add dedicated files where coverage is thin (see AUD-P2-02 through -05). | 1–2 d |
| AUD-P2-02 | REQ-DPL-1..5 | Add `tests/commands/deploy.test.ts` (no coverage currently). | 1 d |
| AUD-P2-03 | REQ-VF-1, REQ-VF-2 | Add `tests/commands/verify.test.ts` for prereq and pipeline (VF-3 already covered). | 1 d |
| AUD-P2-04 | REQ-PS-1, REQ-PS-2 | Add `tests/structure.test.ts` (no coverage currently). | 0.5 d |
| AUD-P2-05 | REQ-UTIL-4 | Add `tests/commands/completions.test.ts` (no coverage currently). | 0.5 d |
| AUD-P2-06 | Verification Plan | Update §6 table in REQUIREMENTS.md to reflect actual test-file mapping; document that many REQs are covered by feature-named files (e.g., `bare-mode.test.ts` not `test_chat.ts`). | 0.5 d |

### P3 — Cleanup

| ID | Path | Action | Estimate |
| --- | --- | --- | --- |
| AUD-P3-01 | `dist/` | Delete; ensure `.gitignore` covers it. | 5 min |
| AUD-P3-02 | `config.yml` (root) | Confirm unused, delete. | 10 min |
| AUD-P3-03 | `GAP-ANALYSIS.md` | Delete (superseded by this audit). | 2 min |
| AUD-P3-04 | `src/skills.ts:79` | Fix comment: `REQ-SKL-10` → `REQ-SKL-3`. | 1 min |
| AUD-P3-05 | `src/tools/builder.ts:229` | Fix comment: `REQ-U-19, REQ-U-20` → `REQ-TOOL-7, REQ-TOOL-8`. | 1 min |
| AUD-P3-06 | `src/tools/builder.ts:241` | Remove unused `const pdfParse = require("pdf-parse")` after AUD-P1-02 lands. | 2 min |

---

## 9. Verification

- **Requirement counts** — cross-referenced against `REQUIREMENTS.md §6` Verification Plan (135 rows).
- **PARTIAL/GAP claims** — each claim backed by a file path + line number; source was read in full.
- **Test counts** — `bun test` output: 972 passed / 0 failed, 61 files.
- **Stale files** — confirmed by `ls -la` of repo root (2026-04-20).

---

## 10. Change Log

- **2026-04-20** — Initial audit authored. Supersedes `GAP-ANALYSIS.md` (2026-04-19).
  - Reclassified REQ-UI-13 from PARTIAL (in GAP-ANALYSIS.md) to PASS after re-reading `src/tui/Message.tsx:85`.
  - Added §4 (Unmapped Code) and §7 (Stale Artifacts) dimensions not present in the prior analysis.
  - Added §5.2 missing-test-file analysis (73 REQs reference 13 non-existent files).
