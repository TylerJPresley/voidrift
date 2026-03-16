# ADR-004: Single-Branch Worker Pool

**Date:** 2026-03-15
**Status:** Accepted

## Context

Multi-module projects benefit from concurrent execution, but branch-per-module strategies introduce merge complexity and disk space multiplication. Most module conflicts come from shared config files, not source code.

## Decision

All workers operate on the same branch with a `--workers N` flag:

- `--workers 1` (default): sequential execution, one module at a time
- `--workers 0`: one worker per module (concurrent)
- `--workers N`: N concurrent workers across modules

A serialized commit lock prevents concurrent git operations. The planner enforces a file ownership constraint — each file path belongs to exactly one module.

## Consequences

- No merge step — all work happens on one branch
- No disk space multiplication
- Single CLI flag controls concurrency
- File ownership constraint prevents cross-module conflicts
- Commit lock needed for concurrent workers (not yet implemented)
