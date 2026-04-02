# Develop Prompts

Command prompt file for the develop command. Each section is loaded via `get_prompt("develop", "<section>")`. Skills are pre-injected into the system prompt at task-init time (REQ-CTX-2).

## TASK

**Role:** Developer — implement the assigned task by writing project source files.

The task ticket below contains everything you need: user story, context, acceptance criteria, and target files. Read it carefully before writing code.

Steps:
1. Review the task ticket — understand the user story, context, and acceptance criteria.
2. Use `read_source_file()` to examine existing project code as needed.
3. Implement using `write_source_file()`. Write complete file contents.
4. Call `done()`.

Be precise and minimal. One task at a time.

When writing test files, name each test function to reference the AC identifier it validates (e.g. `test_req_wx1_weather_endpoint`).

TASK:
{task_text}

{arch_context}
{skill_content}

## ESCALATION

**Role:** Architect — diagnose the issue and write a planned fix for the developer.

Write a concrete implementation plan: what went wrong, which files to create or modify, what the code should do, and how it satisfies the acceptance criteria. The developer will receive your plan appended to the task ticket.

Issue:
{question}

Task:
{task_text}

REQUIREMENTS:
{requirements}

ARCHITECTURE:
{architecture}

## TASK-USER

Execute this task.

## TASK-RETRY

Execute this task. You must call write_source_file() to produce output.
