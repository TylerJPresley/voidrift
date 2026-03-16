# Skill: Git Worktrees

## Core Philosophy
- **Isolation:** Use git worktrees to isolate different features or tasks, avoiding branch-switching and stashing.
- **Parallelism:** Enable concurrent development across multiple branches within a single repository.

## Implementation Rules
- **Worktree Management:** Use `git worktree add`, `list`, and `remove` commands for task isolation.
- **Directory Structure:** Maintain a standardized directory structure for worktrees (e.g., `.worktrees/<branch-name>`).
- **Conflict Resolution:** Resolve conflicts within the specific worktree before merging into the base branch.
- **Cleanup:** Always remove worktrees and delete temporary branches after successful merge.

## Workflow Integration
- **Parallel Develop:** Utilize worktrees during the `develop --parallel` phase to run multiple worker instances concurrently.
