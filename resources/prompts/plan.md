# Plan Prompts

Command prompt file for the plan command. Each section is loaded via `get_prompt("plan", "<section>")`. The ARCH-DESIGN skill is prepended as the shared methodology.

## PLAN-ARCH

**Role:** Architect — design the system architecture.

Steps:
1. Read REQUIREMENTS.md and any spec files provided below.
2. IF `ARCHITECTURE.md` already exists, read it via `read_framework_file("ARCHITECTURE.md")` — treat it as a starting point to update, not regenerate from scratch.
3. Design or revise the system architecture using the architecture template provided in context.
4. Write `ARCHITECTURE.md` via `write_framework_file()`. Include these fields near the top:
   - `startup_command:` — the shell command to start the system for testing (e.g. `uvicorn main:app --port 8000`). Populate for any project with a runnable server or process. Leave blank only for pure libraries with no runnable entry point.
   - `test_bootstrap:` — the shell command to seed test data before verify runs (e.g. `python scripts/seed_test_data.py`). Include when the requirements mention authentication, user accounts, or any pre-seeded state needed to run tests.
5. For each module: IF `arch/<module>.md` already exists, read it via `read_framework_file()` — update it. IF not, create it. Write each module file via `write_framework_file("arch/<module>.md")` with component internals, data models, internal interfaces, error handling patterns, and any cross-module interfaces this module exposes or consumes.
6. Call `done()`.

For multi-module projects, ARCHITECTURE.md contains system-level context only: overview, module inventory, cross-module API contracts, cross-cutting concerns, decision log. Module-internal design goes in `arch/<module>.md`.

Module arch files must be concise. Interfaces and data models as signatures only — no full implementations. Code examples must not exceed 5 lines. A module arch file that exceeds 4KB is too verbose — focus on what the developer needs to know, not how every function works.

REQUIREMENTS:
{requirements}

{specs_section}

## PLAN-TASKS

**Role:** Architect — create the implementation task breakdown from the architecture.

Steps:
1. Read the architecture: `ARCHITECTURE.md` and each `arch/<module>.md` file listed below.
2. IF task files already exist in `tasks/active/`, read them — determine what is already covered. Read source files to determine what is already implemented. Write tasks only for the unimplemented delta.
3. IF no task files exist, create the full task breakdown from scratch.
4. Write each task as an individual file: `tasks/active/TASK-{{id}}.md` using `write_framework_file`. Start IDs at 1 and increment. Each file has YAML frontmatter and a markdown body:

```
---
id: 1
module: backend
skills: [BACKEND-ENG]
files:
  - backend/routes/weather.py (create)
depends: []
---

# Create weather endpoint

## User Story
As an operator, I want a /weather endpoint so that...

## Context
The backend module uses FastAPI (see arch/backend.md). The endpoint...

## Acceptance Criteria
- GET /weather returns 200 with JSON body containing temperature
- Missing city parameter returns 400 with error message

## Implementation Notes
Use the OpenWeatherMap client from backend/clients/weather.py.
```

5. Module names must match the `arch/` filenames (lowercased, spaces to hyphens).
6. Use `skills:` in frontmatter. Valid skill names: {valid_skills}. Use ONLY names from this list.
7. Use `depends:` to specify task IDs that must complete first (e.g. `depends: [1, 2]`).
8. Each task file must be self-contained — include enough context in the body for a developer agent to implement without reading other files.
9. For tasks that create test files, include the AC identifier(s) the tests must validate.
10. Call `done()`.

REQUIREMENTS:
{requirements}

{specs_section}

ARCHITECTURE:
{architecture}

MODULE ARCH FILES:
{arch_files}

## ARCH-USER

Design the system architecture.

## ARCH-RETRY

ARCHITECTURE.md was not written. Read existing files if present, then write ARCHITECTURE.md and arch/<module>.md files now.

## TASKS-USER

Create the task breakdown as individual task files.

## TASKS-RETRY

No task files were written. Read existing files if present, then write tasks/active/TASK-{{id}}.md files now.
