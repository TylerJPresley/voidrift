# Git Worktrees

## Purpose

Worktrees create isolated workspaces from the same repository. Work on a feature branch without touching your main checkout — no stashing, no branch-switching mid-task.

## When to Use

- Starting any feature or bugfix with meaningful scope
- Before executing an implementation plan
- When the Developer needs its own isolated environment to run tasks in parallel

## Setup

### 1. Verify the worktree directory is gitignored

```bash
git check-ignore -q .worktrees 2>/dev/null || {
    echo ".worktrees" >> .gitignore
    git add .gitignore && git commit -m "chore: ignore worktrees directory"
}
```

### 2. Create the worktree

```bash
git worktree add .worktrees/<feature-name> -b feature/<feature-name>
cd .worktrees/<feature-name>
```

### 3. Run project setup and verify a clean baseline

```bash
mvn install -DskipTests && mvn test   # Backend — must pass before starting work
npm install && npm test               # Frontend — must pass before starting work
```

If baseline tests fail, do not proceed. Report the failures and get explicit approval.

## Cleanup After Merging

```bash
git worktree remove .worktrees/<feature-name>
git branch -d feature/<feature-name>
```

## Red Flags

- Creating the worktree directory without first verifying it is gitignored
- Skipping the baseline test run
- Proceeding when baseline tests fail, without explicit approval
- Running `git worktree remove` from inside the worktree being removed
