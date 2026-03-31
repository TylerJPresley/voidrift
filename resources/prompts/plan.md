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

REQUIREMENTS:
{requirements}

{specs_section}

## PLAN-TASKS

**Role:** Architect — create the implementation task breakdown from the architecture.

Steps:
1. Read the architecture: `ARCHITECTURE.md` and each `arch/<module>.md` file listed below.
2. IF `TASKS.md` already exists, read it via `read_framework_file("TASKS.md")` — determine what is already covered. Read source files to determine what is already implemented. Write tasks only for the unimplemented delta.
3. IF `TASKS.md` does not exist, create the full task breakdown from scratch.
4. Group tasks under `## Module: <name>` headers for multi-module projects. Module names must match the `arch/` filenames (lowercased, spaces to hyphens). For single-module projects, use a `## Tasks` header.
5. Write each task as a multi-line block following the TASK FORMAT below. Use `skills:` and `reqs:` metadata lines. Valid skill names: {valid_skills}. Use ONLY names from this list.
6. For tasks that create test files, include the AC identifier(s) the tests must validate in the task description.
7. When requirements mention authentication or pre-seeded state, add a test harness/bootstrap task.
8. Write `TASKS.md` one module at a time. First call: `write_framework_file("TASKS.md", content)` with the header and first module section. Each subsequent module: `write_framework_file("TASKS.md", content, append=true)`.
9. Call `done()`.

{task_format}

REQUIREMENTS:
{requirements}

{specs_section}

ARCHITECTURE:
{architecture}

MODULE ARCH FILES:
{arch_files}
