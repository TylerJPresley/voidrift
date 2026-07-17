---
name: VCS
description: VCS-forward skill that guides branching, commits, merges, and releases. Checks memory for stored decisions, asks when values are missing.
triggers:
  keywords: ["git", "commit", "branch", "merge", "version control", "vcs", "repository", "workflow", "tag", "release"]
agents: []
active: true
---

# VCS Skill

This skill is the interactive guide for all VCS operations in VoidRift. It follows a **form-and-values** pattern: the skill defines the structure of decisions needed (the form), and memory stores the answers (the values). On each run, check memory first — if a decision is missing, ask the user. Never rehash a decision that's already stored.

## How This Skill Works

1. **Check memory** — read existing VCS-related memories before acting
2. **Fill gaps** — if a required value is missing, ask the user (first-run only)
3. **Store decisions** — save user choices as memory directives so they persist across sessions
4. **Execute** — use the stored values to guide all VCS operations

## Memory Keys This Skill Manages

| Key | Purpose | When to Set |
|-----|---------|-------------|
| `vcs-type` | VCS system in use (`git`, `svn`, `hg`, `none`) | First detection |
| `vcs-default-branch` | Main branch name (`main`, `master`, etc.) | First detection |
| `vcs-strategy` | Branching strategy (`gitflow`, `trunk`, `github-flow`, `custom`) | User decision |
| `vcs-naming-pattern` | Branch naming convention (`feature/*`, `bugfix/*`, `hotfix/*`) | User decision |
| `vcs-merge-strategy` | Default merge approach (`squash`, `rebase`, `merge`) | User decision |
| `vcs-commit-format` | Commit message convention (`conventional`, `simple`) | User decision |
| `vcs-release-strategy` | How releases work (`semver`, `gitflow`, `custom`, `none`) | User decision |
| `vcs-protect-main` | Whether main/master is protected | User decision |
| `vcs-tag-pattern` | Release tag format (`v{version}`, `{project}-{version}`) | User decision |

## Workflow: Before Any VCS Operation

Every time a VCS operation is requested, follow this flow:

### 1. Check Memory
Read existing VCS memories. Note what's present and what's missing.

### 2. Ask What's Missing (First Run Only)
If `vcs-type` is unknown, check the repo. Then ask about missing strategy values:
- What's the default branch? (`main` or `master`?)
- What branching strategy do you use? (`gitflow`, `trunk`, `github-flow`)
- What merge strategy? (`squash` for feature branches, `rebase` for linear, `merge` for release)
- Do you use release branches? (gitflow uses them; trunk/github-flow don't)
- Branch naming convention? (`feature/*`, `bugfix/*`, `hotfix/*`, `release/*`)
- Commit format? (`conventional` — `feat:`, `fix:`, `chore:` — or `simple`)
- Tag/release format? (`v1.2.3`, `project-1.2.3`, or none)

Store all answers as memory directives.

### 3. Use Stored Values
Subsequent sessions use the memory values directly — no re-asking.

## Branching Decisions (Gitflow Standard)

When guiding branches, use this decision tree:

**Creating a new branch:**
- Is it a feature? → `feature/<name>`
- Is it a bug fix? → `bugfix/<name>`
- Is it a hotfix? → `hotfix/<name>`
- Is it a release? → `release/<version>` (only if strategy uses them)

**When to ask about branching:**
- User says they want to make changes → suggest creating a feature branch
- User commits directly to main/master → remind them and suggest a branch (if `vcs-protect-main` is true or they're using gitflow)
- User wants to merge → check if source branch should be squashed, rebased, or merged based on `vcs-merge-strategy`

**Release branches:**
- If `vcs-release-strategy` is `gitflow` → use `release/X.Y.Z` branches from `develop`
- If `vcs-release-strategy` is `trunk` or `github-flow` → no release branches, tag directly from `main`
- If `vcs-release-strategy` is `none` → skip release tagging

## Commit Guidelines

Use the stored `vcs-commit-format`:

**Conventional Commits:**
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `style:` — formatting, no code change
- `refactor:` — code refactor, no feature/fix
- `perf:` — performance improvement
- `test:` — adding tests
- `chore:` — maintenance tasks

**Always:**
- Write a subject line under 72 characters
- Add a body explaining what and why (not how)
- Reference issues/PRs when applicable

## Merge Guidelines

- **`squash`** — merge feature branches into main/develop (clean history, one commit per feature)
- **`rebase`** — keep linear history (requires careful coordination)
- **`merge`** — preserve branch history (useful for release merges in gitflow)

When merging, always check if the source branch is behind the target and should be rebased first.

## Tagging and Releases

- Use `vcs-tag-pattern` for consistency
- Annotated tags preferred for releases (`git tag -a`)
- Push tags explicitly (`git push origin --tags`)
- Only tag on `main` or `master` (or `release/X.Y.Z` if using gitflow)

## Error Handling

- **Dirty workspace** → "Working tree is dirty. Commit, stash, or discard changes before switching branches."
- **No VCS** → "No VCS detected. This project has no repository. Continue with the workflow but skip VCS operations."
- **Branch conflicts** → "Branch X conflicts with Y. Here are the options: [a] Resolve conflicts manually, [b] Use a different branch name, [c] Delete branch Y"
- **Merge conflicts** → "Merge conflicts detected. Show conflict markers and let the user resolve, or suggest abort/strategy."
- **Network issues** → "Remote operations unavailable. Work locally and sync when connected."

## Workflow State Machine

```
[Idle]
  ↓ (user initiates VCS operation)
[Check Memory] → (missing? → [Ask User] → [Save to Memory])
  ↓ (values known)
[Apply Stored Strategy]
  ↓
[Execute Operation]
  ↓
[Show Result]
  ↓
[Back to Idle]
```