# VoidRift Development Directive

## Source of Truth
- `blueprint.md` is the foundational spec for architecture and behavior
- `amendments.md` tracks deviations, additions, and refinements made during implementation
- What we build must honor the blueprint's intent
- When we need to go beyond the blueprint, document it in amendments.md with rationale

## Bug Fixing
- ALWAYS do a root cause analysis of an issue
- Only implement a high confidence fix
- Never apply bandaids or workarounds
- Diagnose the actual problem first — understand WHY before writing code
- If unsure, investigate further before changing code

## Implementation
- Build what the blueprint specifies as the foundation
- When tweaks are needed, document them in amendments.md
- Write tests. Verify they pass.
- Follow project conventions (bun, TypeScript, Ink for TUI)
- If a proper fix isn't feasible, say so explicitly. Get approval before adding a workaround.

## Post-Flight
- Tests pass — `bun test` passes. No regressions.
- Confidence ≥ 90% — score honestly. Below 90% means work is not done.
- Don't claim "complete" unless it actually works end-to-end.

## Process
- We're not doing formal requirements-driven design right now
- Blueprint is the spec. Honor it.
- Propose before implementing when the change is non-obvious
- Be honest about what's done vs what's stubbed
