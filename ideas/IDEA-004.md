---
id: IDEA-004
status: draft
category: next
created: 2026-04-18
reqs: []
---

# Harness-Driven Memory Capture

## User Story

As an operator, I want the framework to automatically record run summaries to project memory after develop, verify, and plan complete, so that accumulated patterns (recurring escalations, failing test items, project structure) are available to future agents without relying on the model to remember to call `write_memory`.

## Context

VoidRift's current memory system (REQ-MEM-1 through REQ-MEM-3) is model-driven: the agent decides when to call `memory(action="write")`. This works in chat but fails for automated commands — develop, verify, and plan agents don't have memory tools, so run data is discarded at the end of every session.

The insight: **the harness must own accumulation, not the model.** A tool the model may forget to call is not a memory system. The harness already has all the data at completion time — task outcomes, escalation counts, failed test items — and can write it without a model call.

Two tiers:

**Tier 1 — Harness-driven capture.** After develop, verify, and plan complete, the harness writes structured run summaries to project memory. No model call. Uses data already in memory at the completion point.

**Tier 2 — Inject into develop agents.** Develop agents receive the memory index in their system prompt (same pattern as git context injection, REQ-GIT-2). Adds awareness of prior run patterns at negligible context cost. Develop agents cannot write memory — the harness does that.

Related requirements:
- REQ-MEM-1: two-layer memory system
- REQ-MEM-2: memory index injected into chat prompt
- REQ-MEM-3: memory tools in chat only
- REQ-GIT-2: git context injected into develop/chat agents (same injection pattern for Tier 2)
- REQ-D-3: develop dispatch loop — escalation count available here
- REQ-D-8: develop change summary — diff stats available here
- REQ-VF-2: verify pipeline — verdict and results available here
- REQ-P-1: plan pipeline — task count and module count available here

Original design document: `BAK/PLAN.md` (written against Python implementation — needs TypeScript translation).

## Acceptance Criteria

**Tier 1 — Harness capture:**
- [ ] After develop completes (any outcome), a `develop-run-history` entry is written to project memory containing: outcome, task status counts, escalation count, files modified count, error summary, timestamp, model alias
- [ ] After verify completes (any verdict), a `verify-run-history` entry is written containing: verdict, pass/fail/skip counts, failed item IDs, timestamp, model alias
- [ ] After plan completes, a `plan-context` entry is written (overwritten, not appended) containing: module count, task count, timestamp, model alias
- [ ] `develop-run-history` and `verify-run-history` retain at most the last 5 records — oldest are dropped
- [ ] `plan-context` is overwritten on each plan run (reflects current structure, not history)
- [ ] No model call is made during any capture — pure data transformation and file write

**Tier 2 — Develop agent injection:**
- [ ] Each develop task agent receives the project memory index block in its system prompt, after the git context block
- [ ] The injected block uses the same format as chat memory injection (names and descriptions only)
- [ ] Develop agents cannot write memory — the harness-written entries are read-only context for them

## Affected Modules

- `src/commands/develop.ts` — call capture after run completes; pass escalation count out of dispatch loop
- `src/commands/verify.ts` — call capture after run completes
- `src/commands/plan.ts` — call capture after run completes
- `src/memory.ts` — add `captureRunSummary(entry, record, maxHistory)` and `overwriteEntry(entry, content)` functions
- New `src/memorycapture.ts` — three capture functions + trim helper

## Notes

- Entry names: `develop-run-history`, `verify-run-history`, `plan-context`
- Max history: 5 records (configurable via config or hardcoded constant)
- Trim logic: split on `### ` headings, keep first N, rejoin — pure function, no I/O
- Tier 2 injection: develop agents don't have `memory(action="read")` in their tool set — the index block is injected as static context, not a tool. This is intentional.
- The `plan-context` entry being overwritten (not appended) is intentional — each plan run rewrites the architecture, so historical plan counts are misleading.
- Tests: use temp directories, no real project needed. Test trim behavior independently as a pure function.
