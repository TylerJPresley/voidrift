---
id: IDEA-5
status: draft
category: later
created: 2026-05-11
---

# Deploy Command

## Summary
Release management: version bump, changelog generation, and git tagging for verified CRs.

## Description
The deploy command reads git history since the last tag, generates a changelog from commit messages, bumps the version in `package.json`, and creates an annotated git tag.

## Acceptance Criteria
- Given `deploy` with no arguments, WHEN executed, THEN usage help is displayed.
- Given verified CRs, WHEN deploy runs, THEN a changelog is generated and a git tag is created.
- Given no changes since last tag, WHEN deploy runs, THEN a message indicates nothing to deploy.
