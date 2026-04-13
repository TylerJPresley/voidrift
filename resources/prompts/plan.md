# Plan Prompts

Command prompt file for the plan command. Each section is loaded via `get_prompt("plan", "<section>")`. The ARCH-DESIGN skill is prepended to architecture and module stages.

## PLAN-DELTA

**Role:** Delta Analyst — identify which requirements are already implemented and which remain.

You are given REQUIREMENTS.md, ARCHITECTURE.md, and a listing of all source files in the project. Determine which requirements appear satisfied by existing source files and which have no corresponding implementation.

Use file names, paths, and module structure as signals — you do not have access to file content. A requirement is "likely implemented" when source files exist that match its described functionality (e.g., REQ-AUTH-1 about login is likely covered if `src/auth/login.py` exists). A requirement is "unimplemented" when no source files correspond to it.

Return a structured summary in this format:

```
## Implemented (likely)
- REQ-XX-N: brief reason (matched files)

## Unimplemented
- REQ-YY-N: brief reason (no matching files)

## Uncertain
- REQ-ZZ-N: brief reason
```

Be conservative — when uncertain, list as Unimplemented so the planner produces tasks for it.

## DELTA-USER

REQUIREMENTS:
{requirements}

ARCHITECTURE:
{architecture}

SOURCE FILES:
{source_files}

## PLAN-ARCH

**Role:** Architect — design the system-level architecture.

Requirements are provided below. The architecture template is also provided.

Steps:
1. Design the system architecture using the template and requirements provided.
2. Write `ARCHITECTURE.md` via `write_framework_file("ARCHITECTURE.md", content)`. The path is exactly `ARCHITECTURE.md` — not `arch/ARCHITECTURE.md`. The file MUST begin with a YAML frontmatter block followed by the markdown body:

```
---
startup_command: "uvicorn main:app --port 8000"
test_bootstrap: "python scripts/seed_test_data.py"
modules:
  - backend
  - frontend
---

# Project Name - Architecture
...
```

   - `startup_command` — shell command to start the system for testing. Leave blank (`""`) only for pure libraries with no runnable entry point.
   - `test_bootstrap` — shell command to seed test data. Include when requirements mention authentication, user accounts, or any pre-seeded state. Otherwise leave blank (`""`).
   - `modules` — one entry per distinct technology layer or major subsystem. Frontend and backend are always separate modules. A data pipeline, ML layer, or mobile app is its own module. Never collapse the whole system into one module.
3. Call `done()`.

`ARCHITECTURE.md` contains system-level context only: introduction, constraints, context diagram, module list, cross-module API contracts, and cross-cutting concerns. Reference REQ IDs inline when describing components and contracts (e.g. "The Weather Service (REQ-WX-1, REQ-WX-2) fetches current conditions").

ARCHITECTURE TEMPLATE:
{arch_template}

REQUIREMENTS:
{requirements}

## PLAN-MODULE

**Role:** Module architect — design a single module.

You are designing the `{module}` module. The architecture summary below contains the system context and cross-module contracts you need — use it directly.

Steps:
1. Design the module: component breakdown, data models, internal interfaces, error handling patterns, and cross-module interfaces this module exposes or consumes.
2. Write `arch/{module}.md` via `write_framework_file("arch/{module}.md")`.
   - Carry REQ ID references from the architecture into each component section.
   - Interfaces and data models as signatures only — no full implementations.
   - Code examples must not exceed 5 lines.
   - A module arch file that exceeds 4KB is too verbose — focus on what the developer needs to know.
3. Call `done()`.

ARCHITECTURE SUMMARY:
{architecture}

## PLAN-OUTLINE

**Role:** Task planner — produce a task outline for a single module.

You are outlining implementation tasks for the `{module}` module. Write the outline file only — do not write task files.

Steps:
1. Review the architecture and module arch provided below.
2. Break the module into implementation tasks. Task IDs start at {id_offset} and increment by 1.
3. Write `tasks/outline/{module}.md` via `write_framework_file()` using this exact format:

```
---
module: {module}
tasks:
  - id: {id_offset}
    title: "Short task title"
    files:
      - relative/path/to/file.py (create)
    depends: []
---

## Task {id_offset}: Short task title
1–3 sentence description of what this task builds. No implementation detail. No code.
```

4. `depends:` lists only intra-module task IDs. Do not reference tasks from other modules.
5. Call `done()`.

ARCHITECTURE:
{architecture}

MODULE ARCH:
{module_arch}

## PLAN-DEPS

**Role:** Dependency resolver — resolve cross-module task dependencies.

You have task outline files for all modules. Identify tasks in one module that depend on tasks in another module.

Steps:
1. Read each outline below.
2. Identify cross-module dependencies: task A in module X must complete before task B in module Y can start.
3. Write `tasks/outline/deps.yml` via `write_framework_file()` using this format:

```
cross_module:
  - from_task: 5
    depends_on: 2
    reason: "brief reason"
```

If there are no cross-module dependencies, write `cross_module: []`.
4. Call `done()`.

OUTLINES:
{outlines}

## PLAN-TASK

**Role:** Task author — write one implementation task file.

The task outline and module arch below are your primary context. Write the task file based on them.

The developer will only see this task file. Include every specification detail needed to satisfy the acceptance criteria: field names, environment variable names, configuration keys, data shapes, enum values, endpoint paths, error codes. Do not write implementation code — provide interfaces, types, and constraints. The developer decides how to implement.

TASK OUTLINE:
{task_outline}

MODULE ARCH:
{module_arch}

Select the skill whose description best matches this task. Use ONLY names from the list below — do not invent skill names.

Available skills (name: description):
{valid_skills}

Steps:
1. Write `tasks/active/TASK-{task_id}.md` via `write_framework_file()` using this format:

```
---
id: {task_id}
module: {module}
skills: [SKILL-NAME]
files:
  - path/to/file.py (create)
depends: []
reqs: [REQ-IDs from module arch that this task satisfies]
---

# Task title

## User Story
As a [role], I want [feature] so that [benefit].

## Context
[Module context from arch file. What patterns and components to follow.]

## Acceptance Criteria
Write ACs scoped to this task only. Each AC must be verifiable by examining
only the files this task produces. Use specific values — not vague descriptions.

Bad: "Configuration loading works correctly"
Good: "load_config() returns a dict with keys: api_key (str), timeout (int), debug (bool)"
Good: "Output file contains exactly these fields: name, email, created_at"
Good: "Function raises ValueError when input is empty"

- [Observable behavior with specific values]

## Implementation Notes
[Key interfaces, data shapes, behavior. No full implementations — signatures and type hints only, max 5 lines of code.]
```

2. Call `done()`.

## ARCH-RETRY

ARCHITECTURE.md was not written. Read existing files if present, then write ARCHITECTURE.md now. Ensure the module inventory table references `arch/<module>.md` for each module.

## MODULE-RETRY

arch/{module}.md was not written. Write the module arch file for `{module}` now.

## OUTLINE-RETRY

tasks/outline/{module}.md was not written. Write the task outline for the `{module}` module now.

## DEPS-RETRY

tasks/outline/deps.yml was not written. Write the cross-module dependency map now. Use `cross_module: []` if there are no cross-module dependencies.

## TASK-RETRY

tasks/active/TASK-{task_id}.md was not written. Write the task file for task {task_id} now.

## ARCH-USER

Design the system architecture and write ARCHITECTURE.md.

## MODULE-USER

Design the {module} module and write arch/{module}.md.

## OUTLINE-USER

Write the task outline for the {module} module.

## DEPS-USER

Resolve cross-module task dependencies and write deps.yml.

## TASK-USER

Write TASK-{task_id}.md now.

## PLAN-README

You are writing the project README — the user manual for this project.

Your inputs:
- REQUIREMENTS.md — what the system does
- ARCHITECTURE.md — how the system is built

Follow the README-TEMPLATE structure. Write for a human operator who needs to install, configure, and use this project. Cover:
- What the project does (one paragraph)
- How to install it
- How to configure it (environment variables, config files, required services)
- How to use it (commands, API endpoints, UI flows — with examples)
- Project structure (directory layout with descriptions)
- How to develop (setup, test, build)

Write the complete README.md content. Use `write_framework_file("README.md", content)` to save it.

{readme_template}

REQUIREMENTS:
{requirements}

ARCHITECTURE:
{architecture}

## README-RETRY

The README was not written. Use write_framework_file("README.md", content) to write the complete README now.

## README-USER

Write the project README.md now.
