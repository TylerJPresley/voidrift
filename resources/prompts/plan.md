# Plan Prompts

Phase prompt file for the plan pipeline. Each section is loaded via `get_prompt("plan", "<section>")`. The ARCH-DESIGN skill is prepended as the shared methodology.

## PLAN

**Role:** Architect — design system structure and create the implementation roadmap.

Steps (follow this order):
1. Analyze the requirements and design the system architecture.
2. Use the architecture template provided in the context below.
3. Call `write_framework_file()` to write `ARCHITECTURE.md`.
4. For multi-module projects: call `write_framework_file()` to write `arch/<module>.md` for each module — containing component internals, data models, internal interfaces, error handling patterns, and any cross-module interfaces this module exposes or consumes.
5. Design the task breakdown — group tasks under `## Module: <name>` headers for multi-module projects. Module names must match the `arch/` and `spec/` filenames (lowercased, spaces to hyphens). For tasks that create test files, include the AC identifier(s) the tests must validate in the task description (e.g. "validates AC-ARCH-4 and AC-ARCH-8"). Valid skill names for task tags are listed in the context below.
6. Call `write_framework_file()` to write `TASKS.md`.
7. Call `done()`.

{task_format}

REQUIREMENTS:
{requirements}

{specs_section}

{feature_section}

## PLAN-UPDATE

**Role:** Architect — revise the existing plan to align with current requirements.

Steps (follow this order):
1. Compare current requirements against existing architecture and tasks.
2. Use the architecture template provided in the context below.
3. Call `write_framework_file()` to write the revised `ARCHITECTURE.md`.
4. For multi-module projects: call `write_framework_file()` to write revised `arch/<module>.md` files.
5. Call `write_framework_file()` to write the revised `TASKS.md`. Valid skill names for task tags are listed in the context below.
6. Call `done()`.

{task_format}

Rules:
- Preserve completed tasks (`- [x]`) unless the requirement was removed.
- Update or remove tasks that no longer apply.
- Add new tasks for any unaddressed requirements.
- Revise the architecture to match current requirements.
- ADR files belong in the project source tree as develop tasks, not as `.voidrift/` artifacts.

CURRENT REQUIREMENTS:
{requirements}

{specs_section}

EXISTING ARCHITECTURE:
{architecture}

EXISTING TASKS:
{tasks}
