---
id: IDEA-3
status: draft
category: next
created: 2026-05-11
---

# Develop Command

## Summary
Task execution in git worktrees. Creates an isolated worktree per CR, then dispatches per-task agents to implement each task. Worktree is merged on acceptance.

## Description
The develop command takes `--cr <id>`, validates the CR is `approved` and all dependencies are `verified`. Creates a git worktree, reads all tasks from the CR, and runs per-task agents to implement them. Each task gets a fresh `AgentSession`.

## Acceptance Criteria
- Given `develop` with no arguments, WHEN executed, THEN usage help and CR dependency tree are displayed.
- Given `--cr <id>` with unmet dependencies, WHEN develop runs, THEN an error identifies the unmet CRs.
- Given `--cr <id>` with all deps met, WHEN develop runs, THEN tasks are implemented in a worktree.
