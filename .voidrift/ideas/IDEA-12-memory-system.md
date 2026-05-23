---
id: IDEA-12
status: draft
category: now
created: 2026-05-11
---

# Memory System

## Summary
A two-layer persistent memory system that captures what the system learns about the project, the user, and their workflow. Distinct from governance (which is about standards, practices, and guidance for the model). Memory is what the system *learns*.

## Description

### Two Layers
- **Project memory** — `.voidrift/memory/` — entries specific to the current project.
- **Global memory** — `~/.voidrift/memory/` — entries shared across all projects.

If a project entry has the same name as a global entry, the project entry takes precedence.

### Memory as a Resource
Memory is structured as markdown files. Each entry has a name and contains structured notes about the project, user preferences, conventions, patterns, or anything the system should remember.

### Memory Tools (in TUI)
Available in chat mode:
- **read(name)** — Load a specific memory entry by name. Searches project first, then global.
- **write(name, content)** — Write or update a memory entry (defaults to project scope).
- **list** — List all entries (project and global) with names and descriptions.
- **search(query)** — Find entries matching a keyword or phrase.

### Memory Index
On session start, the system builds a memory index (entry names and descriptions only) and injects it into the governance layer. Full entry content is loaded on demand via the read tool, not upfront.

### Relevance Scoring
Memory entries are scored against the current conversation using keyword matching. Only entries scoring above a configurable threshold have their full content injected. The index is always injected regardless of score.

## Acceptance Criteria
- Given memory entries exist in both project and global, WHEN read is called with a name, THEN the project entry is returned if it exists.
- Given no project entry exists, WHEN read is called, THEN the global entry is returned.
- Given a session starts, WHEN memory index is built, THEN only names and descriptions are injected into governance.
- Given a conversation about authentication, WHEN relevance scoring runs, THEN memory entries about authentication rank higher.
- Given memory tool (read, write, list, search) is called outside chat mode, THEN it is not available.
