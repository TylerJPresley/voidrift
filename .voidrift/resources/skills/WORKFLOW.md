---
name: WORKFLOW
description: Agent loop patterns, tool dispatch sequencing, pipeline stage design, and task execution for VoidRift automated commands.
---

# Domain: Agent Workflow (WORKFLOW)

## Tool Dispatch Sequencing

Read files before writing them. Inspect the current state of a file before overwriting
or editing it. Never assume file contents.

Use `file(action="read")` with explicit `offset`/`limit` for files over 300 lines — read
the relevant section, not the whole file.

Use `file(action="edit")` for targeted changes to existing files; use `file(action="write")`
only for new files or complete rewrites. `file(action="edit")` requires a unique
`old_string` — include enough surrounding context lines to make it unambiguous.

Run tests or build commands via `shell` after every write to validate the change
before calling `done()`.

## `done()` Call

Call `done()` only after writes are validated (tests pass, or the command output
confirms success).

The `done()` summary must state: what files were created or modified, which AC was
addressed, and whether tests pass. One paragraph, no bullet lists.

Never call `done()` after a read-only turn. If the task required no writes, call
`done()` with an explanation of why no changes were needed.

## Stall Recovery

If you find yourself reading the same file twice without writing between reads, you
are stalling. Make a decision based on what you've already read and write.

If a tool call fails, diagnose the error message before retrying. A retry with
identical arguments will produce the same failure.

## Context Budget

Prefer smaller, focused reads over reading entire large files. The context window is
shared between the system prompt, task, and all tool results — protect it.

If a file exceeds `max_read_lines`, paginate with `offset`/`limit`. Read what you
need; stop when you have enough to act.
