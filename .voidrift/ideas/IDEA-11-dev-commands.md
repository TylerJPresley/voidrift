---
id: IDEA-11
status: draft
category: later
created: 2026-05-11
---

# Development Commands (Full Pipeline)

## Summary
The full set of development commands that orchestrate work via isolated agent sessions.

## Description
This idea captures the command pipeline for the full engineering lifecycle.

| Command | Input | Output | Isolation |
|---------|-------|--------|-----------|
| import | Path (dir or file) | Import report | Per-file agents |
| analyze | Project / idea / CR | Report, CRs, tasks | Per-stage agents |
| develop | CR with tasks | Implemented code | Per-task agents in worktree |
| verify | CR in worktree | Verification report | Per-test-case agents |
| deploy | Git history | Version, changelog, tag | Single agent |

## Acceptance Criteria
- Given any development command, WHEN it runs, THEN it creates isolated `AgentSession` instances.
- Given `develop --cr <id>`, WHEN executed, THEN a git worktree is created for filesystem isolation.
- Given `analyze --idea <id>`, WHEN executed, THEN it assesses fit and decomposes into CRs.
