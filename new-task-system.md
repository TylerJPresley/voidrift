# New Task System — Design Document

*Status: In development — not yet implemented*

## Artifacts

```
.voidrift/
├── REQUIREMENTS.md          # Gather output
├── ARCHITECTURE.md          # Plan output (system-level)
├── arch/<module>.md         # Plan output (module-level, optional)
├── tasks/
│   ├── manifest.yml         # CLI-managed: active tasks, bugs, dependencies
│   ├── history.log          # Append-only event log (archived entries)
│   ├── active/
│   │   ├── TASK-0008.md     # planned / in-progress / implemented / failed
│   │   ├── BUG-0001.md      # open bug
│   │   └── ...
│   └── archived/
│       ├── TASK-0001.md     # verified — done, available for reference
│       ├── BUG-0003.md      # resolved bug
│       └── ...
├── VERIFY.md                # Verify output
└── STATE.md                 # CLI-managed lifecycle log
```

### manifest.yml — active work only

Only tracks tasks and bugs that are in `active/`. Small, fast, read on every dispatch. When a task is archived, the CLI removes it from manifest and appends an event to history.log.

### history.log — append-only event log

One line per lifecycle event. Never modified, only appended. Read for reporting, not on the hot path.

```
2026-04-01T10:00:00 TASK-0001 verified module=backend assigned=kiro
2026-04-01T10:05:00 TASK-0002 verified module=backend assigned=kiro
2026-04-01T11:30:00 TASK-0005 failed module=backend refs=BUG-0001
2026-04-01T14:00:00 TASK-0005 verified module=backend assigned=kiro
2026-04-01T14:00:00 BUG-0001 resolved refs=TASK-0005
```

Rotation strategy deferred to release planning in automate.

## Bugs and Dependencies

Bugs are independent entities with their own numbering sequence. They can originate from verify, from an operator, or from a change request. They may or may not be connected to a task.

```
.voidrift/tasks/active/
├── TASK-0005.md         # status: failed, refs: [BUG-0001]
├── TASK-0006.md         # status: blocked (depends on 5)
├── BUG-0001.md          # verify evidence — linked to TASK-0005 via manifest
├── BUG-0002.md          # operator-reported bug, no originating task
```

### Failed Task Flow

1. Verify fails TASK-0005
2. CLI creates BUG-0001.md with failure evidence
3. CLI sets TASK-0005 to `failed`, adds `refs: [BUG-0001]` to manifest
4. CLI blocks dependent tasks (forward + transitive)
5. Architect gets consulted — receives task ticket + bug report, diagnoses the root cause, appends guidance to TASK-0005.md as a comment section
6. Develop re-dispatches TASK-0005 — agent sees original ticket + architect's diagnosis
7. On success: CLI sets `implemented`, unblocks dependents

### Standalone Bug Flow

1. Operator or verify finds a defect not tied to a specific task
2. BUG-0002.md created in `active/`
3. Plan (or operator) creates a new TASK referencing the bug for context
4. Normal develop flow

### Relationships

Bugs and tasks have independent numbering. The manifest tracks references but doesn't enforce 1:1. A bug can spawn multiple tasks. A task can reference multiple bugs.

### Dependency Resolution (CLI-managed)

- **Forward**: task 5 failed → who depends on 5? → block them
- **Reverse**: task 5 implemented → who was blocked by 5? → are all their other deps met? → unblock
- **Transitive**: task 5 failed → task 8 depends on 5 → task 11 depends on 8 → both blocked

### Archive

When a task reaches `verified`:
- TASK file moves to `archived/`
- Referenced BUG files move to `archived/` alongside it (if all tasks referencing that bug are verified)

## Pipeline

### Gather — unchanged
Produces REQUIREMENTS.md.

### Plan — two stages, new output format
1. **Stage 1: Architecture** — produces ARCHITECTURE.md + optional arch/<module>.md (same as today)
2. **Stage 2: Tasks** — reads architecture + requirements, produces individual task files. Each task file is a self-contained ticket with: user story, context (relevant architecture/requirements excerpts), acceptance criteria, file targets (create/modify), skill tags, and dependency declarations. The CLI parses the task files and builds manifest.yml (status, dependencies, module grouping).

### Develop — simplified to a dispatch loop
1. CLI reads manifest.yml, finds next task(s) where status=`planned` and all dependencies are `implemented` or `verified`
2. CLI reads the task file(s)
3. CLI dispatches sub-agent(s) up to concurrency limit — each gets the task file content as its prompt
4. Sub-agent writes code, calls `done()`
5. CLI marks task `implemented` in manifest
6. Repeat until no ready tasks remain
7. If tasks remain but all are `blocked` (unmet dependencies), report and exit

No module-level workers. No context loading tool calls. No orchestration in the agent. The CLI is the orchestrator.

### Verify — reads implemented tasks from manifest
1. Plan agent builds test cases from implemented task tickets (ACs are already in the ticket)
2. Sub-agents execute tests
3. Pass → CLI marks task `verified` in manifest
4. Fail → CLI marks task `failed`, writes bug report to `bugs/`, links it to the task file
5. Failed tasks can be re-dispatched through develop with the bug report appended as context

### Change Requests — same pipeline, different entry point
1. Operator updates REQUIREMENTS.md (or gather re-runs on modified codebase)
2. Plan runs in update mode — reads existing source, existing tasks, produces new/modified task tickets for the delta
3. Develop picks up new tickets
4. Verify validates

## Manifest (CLI-owned)

```yaml
modules:
  backend: [1, 2, 3, 4, 5]
  frontend: [6, 7, 8, 9]
  deployment: [10, 11]

dependencies:
  6: [1, 2]
  10: [5, 9]

tasks:
  1: {status: verified, assigned: kiro, completed: 2026-04-01T10:00:00}
  2: {status: implemented, assigned: kiro}
  3: {status: in-progress, assigned: kiro}
  4: {status: planned}
  5: {status: planned}
  6: {status: blocked}
  7: {status: planned}
  8: {status: planned}
  9: {status: planned}
  10: {status: blocked}
  11: {status: planned}
```

## Task Ticket

```markdown
---
id: 3
module: backend
skills: [BACKEND-ENG]
files:
  - backend/routes/weather.py (create)
  - backend/services/openweather.py (create)
depends: [1, 2]
---

# Implement weather API endpoint and OpenWeatherMap service

## User Story
As a kiosk user, I want to see current weather and hourly forecast
so that I can plan my day at a glance.

## Context
Backend is FastAPI (see ARCHITECTURE.md §2.1). Config module (task 1)
provides `AppConfig.lat`, `AppConfig.lon`, `AppConfig.openweather_api_key`.
Cache module (task 2) provides `@cached(ttl=120)` decorator.

## Acceptance Criteria
- REQ-WX-1: GET /api/weather returns current conditions + hourly forecast
- REQ-WX-2: Hourly indices configurable via config.hourly_indices
- REQ-WX-3: Response cached per refresh_interval

## Implementation Notes
- Route: GET /api/weather → WeatherResponse
- Service: OpenWeatherClient.get_forecast(lat, lon) → parsed response
- Use httpx.AsyncClient for external API calls
```

## What Dies

- TASKS.md (replaced by task files + manifest)
- TASKS-DONE.md (status lives in manifest)
- TaskStore class (replaced by manifest reader)
- Module-level ThreadPoolExecutor workers (replaced by task-level dispatch)
- Context loading tool calls in develop (context is in the ticket)
- Stall detection for missing files (no files to miss)

## What's New

- `tasks/` directory with numbered ticket files
- `manifest.yml` — CLI-managed orchestration state
- Plan stage 2 produces individual files instead of a single TASKS.md
- Develop is a simple dispatch loop
- Task lifecycle: planned → in-progress → implemented → verified (or failed → planned)

## Open Questions

### Resolved

- **Priority?** No. If it's in `active/`, it's priority. Dispatch order is: dependencies met → dispatch. Concurrency handles the rest.
- **Subtasks?** No. Subtasks are just tasks with dependencies. Keep it flat.
- **Blocked reason?** Blocked = unmet dependency. No free-text blocking.
- **Estimation?** Not needed for automated agents. Could derive from history.log later.
- **Sprints/milestones?** Deferred to release planning in automate.
- **Bug numbering?** Independent sequence from tasks. Manifest tracks refs between them.
- **History rotation?** Deferred to release planning. Rotate on release boundaries.

### Future

- **Ideas** (`IDEA-0001.md`) — backlog layer above the task system. Not active work, not dispatched, just captured for later planning.
- **Change requests** — same pipeline, different entry point. Plan produces new/modified tickets for the delta.
