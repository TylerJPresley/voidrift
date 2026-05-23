---
id: IDEA-9
status: draft
category: next
created: 2026-05-11
---

# Package Architecture

## Summary
The modular package structure and dependency map for VoidRift. Each package is strictly isolated.

## Description
This idea captures the full package map and resource conventions for when we are ready to implement the full system.

| Package | Type | Depends On | Purpose |
|---------|------|------------|---------|
| `@voidrift/core` | Infrastructure | gemini-cli-core | Config bridge, workflow objects, adapter factory |
| `@voidrift/openai-adapter` | Adapter | gemini-cli-core, openai | OpenAI ContentGenerator |
| `@voidrift/anthropic-adapter` | Adapter | gemini-cli-core, @anthropic-ai/sdk | Anthropic ContentGenerator |
| `@voidrift/governance` | System | gemini-cli-core | Context window partition |
| `@voidrift/modes` | System | governance | Built-in mode cycling |
| `@voidrift/memory` | System | gemini-cli-core | Two-layer memory |
| `@voidrift/tui` | Frontend | core, governance, modes, memory | Ink terminal UI |

### Resource Convention
Each package bundles resources in `resources/`:
- Prompts: `*-prompt.md` — agent instructions
- Templates: `*-template.md` — output formats
- Resolution: `~/.voidrift/resources/<package>/<file>` overrides bundled defaults.

## Acceptance Criteria
- Given a new package is added, WHEN it follows the resource convention, THEN it is immediately usable without modifying other packages.
- Given an override file exists in `~/.voidrift/resources/`, WHEN loaded, THEN it takes precedence over the bundled default.
