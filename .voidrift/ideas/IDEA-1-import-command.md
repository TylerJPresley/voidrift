---
id: IDEA-1
status: draft
category: next
created: 2026-05-11
---

# Import Command

## Summary
Codebase analysis pipeline that produces import reports for external projects. Per-file agents with configurable concurrency (20–35) for analyzing directories or single files.

## Description
The import command reads a target path (directory or file), analyzes it in four stages (triage, context build, source analysis, consolidation), and produces a structured report at `.voidrift/imports/<name>-report.md`. Each stage uses isolated agents. Cached analyses prevent redundant model calls.

## Acceptance Criteria
- Given a directory path, WHEN import runs, THEN an import report is produced.
- Given a single file path, WHEN import runs, THEN a focused report is produced.
- Given a non-existent path, WHEN import runs, THEN the command exits with an error.
