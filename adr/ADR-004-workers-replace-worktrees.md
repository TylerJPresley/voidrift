# ADR-004: Workers Replace Worktrees

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley
**Supersedes:** Git worktree-based parallel execution (AC-D36 through AC-D53)

## Context

The original parallel execution model created one git worktree per module, ran workers concurrently in separate branches, then merged results back. This required:

- 18 acceptance criteria (AC-D36 through AC-D53) for worktree lifecycle
- Complex merge conflict resolution with architect consultation
- Signal handling across process trees (`_kill_tree` recursive depth-first)
- Disk space estimation (repo size × module count)
- Three CLI flags (`--parallel`, `--retry`, `--overwrite`)

The implementation was fragile and the merge step was the most common failure point.

## Decision

Replace worktrees with a `--workers N` flag:

- `--workers 1` (default): sequential execution, one module at a time
- `--workers 0`: one worker per module (concurrent, future implementation)
- `--workers N`: N concurrent workers across modules

All workers operate on the same branch with a serialized commit lock. No worktrees, no merge step.

## Consequences

- **Positive:** Eliminated 18 acceptance criteria and ~200 lines of worktree/merge code
- **Positive:** Single CLI flag replaces three (`--parallel`, `--retry`, `--overwrite`)
- **Positive:** No merge conflicts — all work happens on one branch
- **Positive:** No disk space multiplication
- **Negative:** Concurrent workers need a commit lock (not yet implemented)
- **Negative:** No branch isolation — a bad task can affect other modules' files (mitigated: file ownership constraint in requirements)
