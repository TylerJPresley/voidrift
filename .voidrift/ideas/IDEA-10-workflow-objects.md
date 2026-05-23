---
id: IDEA-10
status: draft
category: next
created: 2026-05-11
---

# Workflow Objects (Idea → CR → Task)

## Summary
The workflow object definitions: Ideas, Change Requests (CRs), and Tasks. Each is a markdown file with YAML frontmatter.

## Description
This idea captures the lifecycle of how work is organized in VoidRift:
- **Idea:** `.voidrift/ideas/IDEA-N.md`
- **CR:** `.voidrift/changes/CR-N.md`
- **Task:** `.voidrift/tasks/TASK-N.md`

### Status Transitions
```
Idea:  draft → planned → in-progress → verified → done
CR:    draft → approved → in-progress → verified → done
Task:  planned → in-progress → implemented → verified → blocked
```

## Acceptance Criteria
- Given an idea with status `draft`, WHEN CRs are created from it, THEN the idea status becomes `planned`.
- Given a CR with status `draft`, WHEN develop starts it, THEN status becomes `in-progress`.
- Given a task with status `planned`, WHEN an agent starts it, THEN status becomes `in-progress`.
