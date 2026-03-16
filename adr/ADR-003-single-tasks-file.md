# ADR-003: Single TASKS.md with Module Headers

**Date:** 2026-03-15
**Status:** Accepted

## Context

Multi-module projects need a way to organize tasks by module while keeping task management simple. Separate files per module add discovery complexity and require file-copying workflows.

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

- Single file to manage — no glob discovery, no file copying
- Module names are dynamic — determined by the planner, not hardcoded
- Atomic write-through — one file flush updates all module state
- Easier for operators to read and edit
- Concurrent writes from multiple workers need file locking (not yet implemented)
