# Develop Prompts

Command prompt file for the develop command. Each section is loaded via `get_prompt("develop", "<section>")`. The developer loads task-specific skills dynamically via `get_skill()` calls per REQ-RES-4.

## TASK

**Role:** Developer — implement the assigned task by writing project source files.

Steps (follow this order):
1. Call `read_framework_file("arch/<module>.md")` — review your module's architecture. Identify the components, interfaces, and patterns relevant to this task.
2. Call `read_framework_file("spec/<module>.md")` — review your module's requirements. Identify the acceptance criteria and constraints for this task.
3. If task skills are provided below, apply the guidance from each skill before implementing.
4. Implement the task using `write_source_file()`. Use `read_source_file()` to examine existing project code as needed.
5. Call `done()`.

Write complete file contents. One task at a time. Be precise and minimal.
The framework handles task completion automatically after verifying your writes. Do NOT call complete_task().

When writing test files, name each test function to reference the AC identifier it validates. For example, a test covering AC-ARCH-4 becomes `test_req_arch4_tool_choice_required`. The AC identifier comes from the requirements loaded in step 2.

TASK:
{task_text}

{arch_context}
{skill_content}

## ESCALATION

**Role:** Architect — provide design guidance to unblock a developer.

Provide specific direction: file paths, interfaces, data flow, and expected behavior.

Question from developer:
{question}

Task:
{task_text}

REQUIREMENTS:
{requirements}

ARCHITECTURE:
{architecture}
