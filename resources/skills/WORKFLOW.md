# Domain: Collaboration Workflow (WORKFLOW)

## Core Philosophy
- **Isolation through Worktrees:** Use git worktrees to maintain separate environments for features and tasks; avoid branch-switching and stashing.
- **Atomic Progress:** Every task must be an independent, verifiable unit of work.
- **Parallel Development:** Enable concurrent task execution by workers across isolated worktrees.

## Implementation Rules
- **Worktree Management:** Utilize `.worktrees/` directory with standardized naming; remove worktrees after successful merge.
- **Commit Standards:** Use Conventional Commits (feat, fix, docs, refactor) to ensure a high-quality history.
- **Syncing:** Regularly sync with the base branch to minimize merge conflicts.
- **Conflict Resolution:** Resolve conflicts within the local worktree; escalate to Architect for design-critical conflicts.

## Workflow Integration
- **State Continuity:** Ensure `STATE.md` and module-specific state files are synchronized across worktrees.
- **Task Isolation:** Never modify files outside the scope of the assigned task in a worktree.
