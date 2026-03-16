# ADR-005: IEEE 29148 Requirements Format

**Date:** 2026-03-15
**Status:** Accepted

## Context

Requirements need a standard structure that supports traceability (requirement → user story → verification), unambiguous language, and efficient navigation. Ad-hoc formats tend to mix abstraction levels and lack verification mapping.

## Decision

Use IEEE 29148 with EARS (Easy Approach to Requirements Syntax) notation:

1. **Introduction** — purpose, scope
2. **User Stories** — who needs what and why
3. **External Interfaces** — CLI commands, MCP tools, environment variables
4. **Functional Requirements** — `REQ-*` identifiers with EARS patterns ("When X, the system shall Y")
5. **Non-Functional Requirements** — performance, reliability, security constraints
6. **Verification Plan** — `V-*` entries mapping requirements to test methods

## Consequences

- Every requirement has a unique `REQ-*` ID traceable to user stories
- Verification plan explicitly maps requirements to tests
- EARS notation makes requirements unambiguous ("When/While/If/Where" patterns)
- Standard structure makes it easy to find and update specific requirements
- Same format applies to both the framework itself and projects built with it
