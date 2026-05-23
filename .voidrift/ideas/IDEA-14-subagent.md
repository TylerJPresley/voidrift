---
id: IDEA-14
status: draft
category: now
created: 2026-05-11
---

# Subagent Delegation

## Summary
A tool that allows the agent to delegate sub-tasks to independent agent sessions. Provides isolation, worktree support, and result reporting.

## Description

The subagent system allows the primary agent to spawn independent worker agents for specific sub-tasks. Key capabilities:

- **Delegation** — The main agent delegates work to a subagent with a task description and tools.
- **Worktree isolation** — Subagents can operate in isolated git worktrees to prevent file conflicts.
- **Results flow** — Subagent results are returned to the primary agent for inclusion in the main context.

This is an agent-to-agent communication pattern, not a user-facing tool. It enables multi-agent workflows where the primary agent breaks complex tasks into independent sub-tasks.

## Acceptance Criteria
- Given a task delegation, WHEN the subagent starts, THEN it has the specified tools and task description.
- Given a subagent with worktree isolation, WHEN it writes files, THEN those files are isolated from the main workspace.
- Given a subagent completes, WHEN results are returned, THEN the primary agent receives the result as a structured response.
