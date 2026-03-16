# ADR-003: Single TASKS.md with Module Headers

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley
**Supersedes:** Multiple `TASKS-<module>.md` files

## Context

The original design created one `TASKS-<module>.md` file per module (e.g., `TASKS-backend.md`, `TASKS-frontend.md`, `TASKS-infra.md`). This required:

- Glob patterns to discover task files
- File copying between module files and a working `TASKS.md`
- Hardcoded module names (`infra` was always required)
- Complex merge logic for parallel worktree execution

## Decision

Use a single `TASKS.md` with `## Module: <name>` headers to delineate modules. The MCP `TaskStore` parses these headers into per-module queues at load time.

```markdown
## Module: backend
- [ ] Create src/api/routes.py: ... [arch-design]
- [ ] Create src/api/models.py: ... [data-eng]

## Module: frontend
- [ ] Create src/App.vue: ... [web-eng]
```

## Consequences

- **Positive:** Single file to manage — no glob discovery, no file copying
- **Positive:** Module names are dynamic — no hardcoded `infra` requirement
- **Positive:** Atomic write-through — one file flush updates all module state
- **Positive:** Easier for operators to read and edit
- **Negative:** File can get large for projects with many modules (mitigated: task files are typically <200 lines)
- **Negative:** Concurrent writes from multiple workers would need file locking (not yet implemented — `--workers` > 1 is sequential for now)
