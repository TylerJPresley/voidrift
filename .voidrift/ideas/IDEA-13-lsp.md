---
id: IDEA-13
status: draft
category: now
created: 2026-05-11
---

# LSP Integration

## Summary
A tool that exposes language server protocol capabilities to the agent. Provides code intelligence for file exploration and navigation.

## Description

The LSP package provides four tools to the agent:
- **go_to_definition** — Navigate from a symbol reference to its definition location.
- **find_references** — Find all references to a symbol across the project.
- **diagnostics** — Get current linting/syntax errors and warnings for a file.
- **hover** — Show type information and documentation for a symbol.

These are agent tools — the operator doesn't interact with them directly. They are used by the agent loop to understand code structure and make informed decisions about edits.

## Acceptance Criteria
- Given an open LSP server, WHEN go_to_definition is called with a symbol, THEN the definition location is returned.
- Given an open LSP server, WHEN find_references is called with a symbol, THEN all reference locations are returned.
- Given a file with syntax errors, WHEN diagnostics is called, THEN errors and warnings are returned.
- Given a symbol with type info, WHEN hover is called, THEN the hover content is returned.
