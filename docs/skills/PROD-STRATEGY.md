---
name: PROD-STRATEGY
description: Release management, documentation standards, changelog maintenance, and conventional commits.
triggers:
  extensions: []
  files: ["CHANGELOG.md","README.md"]
  keywords: ["changelog","release","documentation","conventional commit","semver","versioning"]
agents: []
active: true
---

# PROD-STRATEGY

## Conventional Commits

```
✅ feat(auth): add OAuth2 PKCE flow for MCP servers
✅ fix(stream): prevent duplicate rendering on stderr output
✅ docs(readme): update installation instructions for Node 22
✅ refactor(context): extract prompt compiler from session manager

❌ updated stuff
❌ fix bug
❌ WIP
```

Format: `type(scope): imperative description`
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

## Versioning (SemVer)

- MAJOR: breaking API/behavior change
- MINOR: new feature, backwards compatible
- PATCH: bug fix, no new features

When in doubt: if existing users' code/config would break, it's MAJOR.

## Changelog

```markdown
## [0.2.0] - 2025-06-25
### Added
- OAuth2 PKCE flow for MCP server authentication
- /resume panel for session recovery

### Fixed
- Duplicate rendering in non-git workspaces
- Empty response on model stream failure

### Changed
- Skills panel split into core/custom tabs
```

- Group by: Added, Fixed, Changed, Removed, Deprecated
- Write for users, not developers — what changed from their perspective?
- Link to issues/PRs where relevant

## README Structure

1. One-sentence description (what it does)
2. Why it exists (the problem it solves)
3. Quick start (install + first command)
4. Configuration (minimal working example)
5. Features (brief, link to detailed docs)
6. Troubleshooting (top 3 issues)

## Documentation Rules

- Update docs in the same commit as the code change
- Write for the reader's goal, not the implementation's structure
- Code examples must be copy-pasteable and working
- If something is deprecated, say what replaces it
