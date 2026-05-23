---
id: IDEA-4
status: draft
category: next
created: 2026-05-11
---

# Verify Command

## Summary
Acceptance testing for CRs. Runs per-test-case agents against the worktree implementation and produces a verification report.

## Description
The verify command takes `--cr <id>`, reads the CR's proposed requirements, and runs agents to verify each acceptance criterion against the worktree. Produces `.voidrift/verify/<id>-report.md`.

## Acceptance Criteria
- Given `verify --cr <id>`, WHEN verification runs, THEN each AC is tested and a report is produced.
- Given a failing AC, WHEN verification runs, THEN the failure is recorded in the report.
- Given all ACs pass, WHEN verification completes, THEN the CR status can transition to `verified`.
