# ADR-005: IEEE 29148 Requirements Format

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley
**Supersedes:** AC-* acceptance criteria format (1027 lines)

## Context

The original REQUIREMENTS.md used a flat list of acceptance criteria (`AC-CLI1`, `AC-MCP3`, `AC-D36`, etc.) organized by component. At 1027 lines with 100+ ACs, it had several problems:

- No traceability structure — ACs weren't linked to user needs
- Mixed abstraction levels — high-level goals next to implementation details
- No verification plan — no way to know which ACs had tests
- Redundant content — same concepts repeated across sections
- Hard to navigate — no standard structure

## Decision

Migrate to IEEE 29148 / EARS (Easy Approach to Requirements Syntax) format:

1. **Introduction** — purpose, scope
2. **User Stories** — who needs what and why
3. **External Interfaces** — CLI commands, MCP tools, environment variables
4. **Functional Requirements** — `REQ-*` identifiers with EARS patterns ("When X, the system shall Y")
5. **Non-Functional Requirements** — performance, reliability, security constraints
6. **Verification Plan** — `V-*` entries mapping requirements to test methods

## Consequences

- **Positive:** 1027 → 248 lines (76% reduction) with better coverage
- **Positive:** Every requirement has a unique `REQ-*` ID and is traceable to user stories
- **Positive:** Verification plan explicitly maps requirements to tests
- **Positive:** EARS notation makes requirements unambiguous ("When/While/If/Where" patterns)
- **Negative:** Legacy AC-* references in code comments and commit messages are now stale
- **Negative:** The old format is preserved as `REQUIREMENTS-legacy.md` for reference during transition
