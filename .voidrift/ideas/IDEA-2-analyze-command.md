---
id: IDEA-2
status: draft
category: next
created: 2026-05-11
---

# Analyze Command

## Summary
Project-wide analysis pipeline: requirements audit, architecture audit, implementation audit, and planned work audit. Supports `--idea <id>` (fit assessment + CR decomposition) and `--cr <id>` (task decomposition).

## Description
The analyze command provides three modes:
- **Project-wide:** Analyzes requirements, architecture, implementation, and planned work. Produces `.voidrift/analysis/project-report.md`. Pinned to git commit hash for caching.
- **Idea analysis:** Assesses if an idea fits the project (quality gate), then decomposes into draft CRs if it passes.
- **CR decomposition:** Breaks a CR into structured task files.

## Acceptance Criteria
- Given an existing current project report, WHEN analyze runs, THEN it reuses the report — no model calls.
- Given `analyze --idea <id>`, WHEN the idea fails fit assessment, THEN no CRs are produced.
- Given `analyze --cr <id>`, WHEN tasks are generated, THEN they cover all acceptance criteria.
