# Task Format

Each task in TASKS.md is a multi-line block.

## Structure

```
- [ ] <summary>
  file: <relative/path/to/file>
  skills: <SKILL-NAME>, <SKILL-NAME>
  reqs: <REQ-ID>, <REQ-ID>
  <free-form description — acceptance criteria, inputs/outputs,
  error cases, rationale. May contain code examples, JSON, markdown.>
```

## Rules

- First line: `- [ ]` followed by a concise summary of the task.
- `file:` line: target file path relative to project root. Omit for tasks with no single target file.
- `skills:` line: comma-separated skill names from the valid list. One line only.
- `reqs:` line: comma-separated requirement IDs this task satisfies. One line only.
- Description: everything after the metadata lines. Include enough context for a developer to implement without reading the full requirements.
- All continuation lines are indented (2 spaces minimum).
- A task block ends at the next unindented `- [ ]`, `- [x]`, `- [!]`, or `## Module:` line.
- Completed tasks: `- [x]`. Blocked tasks: `- [!]`.
