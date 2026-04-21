---
id: IDEA-003
status: draft
category: now
created: 2026-04-18
reqs: []
---

# Fill Test Coverage Gaps

## User Story

As a developer, I want test files for all untested requirement areas, so that the verification plan is fully executable and implementation gaps surface automatically.

## Context

Audit run 2026-04-18: 504/516 tests pass. The 12 failures are test isolation issues (module-level shared state in process registry and git tests running in parallel) — not implementation gaps. However, 8 requirement areas have no test files at all.

Current test isolation issue: `tests/tools/process.test.ts` uses a module-level `Map` registry that leaks between parallel test runs. `tests/git.test.ts` requires a real git repo and fails when run alongside tests that change the working directory. Fix: add `--sequence` flag to vitest config for these files, or reset module state in `beforeEach`.

Related requirements: all 129 placed requirements in REQUIREMENTS.md. Verification plan (Section 6) maps each REQ to a test file and class.

## Acceptance Criteria

- [ ] `tests/commands/develop.test.ts` — covers D-1 through D-13 (prerequisite check, locking, dispatch, write verification, escalation, rollback, orphan recovery, change summary, mtime guard, checkpoints, file coverage, self-review, read-before-write)
- [ ] `tests/commands/deploy.test.ts` — covers DPL-1 through DPL-5 (version bump, changelog, git tag, IaC, post-deploy hook)
- [ ] `tests/commands/chat.test.ts` — covers CHAT-1 through CHAT-14 (all slash commands, session persistence, compaction, bare mode, permission gate, model resolution, idea flow)
- [ ] `tests/commands/status.test.ts` — covers UTIL-1 (status display)
- [ ] `tests/tools/http.test.ts` — covers TOOL-3 (HTTP session persistence), TOOL-4 (URL fetch with confirmation), SEC-5 (SSRF blocking)
- [ ] `tests/logging.test.ts` — covers LOG-1 through LOG-4 (project log, global log, log content, error summary)
- [ ] `tests/commands/rollback.test.ts` — covers UTIL-8 (rollback command), D-10 (checkpoint creation)
- [ ] `tests/tui/` — covers UI-1 through UI-12 (progress display, welcome box, command header, multi-line input, layout, message roles, placeholder, exit behavior, footer, agent stats, thinking indicator, input history)
- [ ] Test isolation fixed: process registry reset between tests; git tests run sequentially or in isolated temp dirs
- [ ] `bun test` passes with 0 failures across all 33+ files when run together

## Affected Modules

- `tests/commands/` — 3 new files
- `tests/tools/` — 1 new file
- `tests/` — 2 new files
- `tests/tui/` — new component tests
- `tests/tools/process.test.ts` — fix isolation
- `tests/git.test.ts` — fix isolation
- `vitest.config.ts` — possibly add sequence config for affected files

## Notes

- TUI tests (UI-1 through UI-12) are the hardest — Ink components require `ink-testing-library` or snapshot testing. Consider splitting into unit tests (state logic) and integration tests (rendered output).
- Chat tests (CHAT-1 through CHAT-14) will need the `MockAdapter` from `src/testing/mock.ts` extensively.
- Deploy tests need a real git repo with commits — use the existing test fixture pattern from `tests/git.test.ts`.
- HTTP tests: SSRF is already tested in `tests/tools/ssrf.test.ts`. TOOL-3 and TOOL-4 need a mock HTTP server — consider `bun`'s built-in `Bun.serve()` for test fixtures.
