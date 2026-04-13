# Development Guide

This document defines how changes are made to this project.

## Communication

- Be direct. Answer what was asked — no preamble, no filler.
- Stay on topic. Don't volunteer tangential information.
- Write the minimum code needed to satisfy the requirement.
- When explaining, lead with the answer, then justify if needed.

## Context Files

Three documents are the source of truth for any project. Load whichever exist before starting work:

- **REQUIREMENTS.md** — the contract. What the system does, why, and the acceptance criteria for all changes.
- **ARCHITECTURE.md** — the blueprint. Component design, data flows, and key decisions.
- **README.md** — the user manual. How to install, configure, and use the project.

These are not supplementary — they are half the solution. Every code change must update the affected documents. If a document doesn't exist yet, create it when the project needs it.

## Change Workflow

1. **Diagnose** — Trace the root cause — not the symptom. Map how the change cascades through the codebase: callers, dependencies, tests, configuration, and documentation. Understand the full impact before proposing anything.
2. **Propose** — Present a high-confidence solution: what changes, where, and why. If a proper fix isn't feasible, say so explicitly — get approval before adding a workaround.
3. **Wait for operator approval**
4. **Write requirements** — Define what the system must do as observable behaviors. Follow the format specified in the project's requirements document.
5. **Wait for operator approval**
6. **Implement** — Write code that satisfies the acceptance criteria. Write tests. Follow project conventions — raise concerns with the operator before deviating.
7. **Verify** — Confirm all related ACs pass. Confirm no existing ACs break.
8. **Update documentation** — Every affected project document must reflect the change.
9. **Run tests** — All tests pass before work is complete.
10. **Self-review** — Re-read every AC. Verify each doc update is present — read each file directly to confirm. Score confidence 0–100%. Below 90% means work is not done — close the gaps before reporting. Only raise with the operator when the gap is a preference or constraint that cannot be resolved through analysis.
11. **Commit** — Commit after each logical unit of work with AC references.
12. **Summarize** — Files changed, ACs satisfied, open questions.

**Trace the root cause before writing requirements — a contract for an unknown problem is worthless.**
**Requirements are the contract — write them before writing code.**
**Work is complete only when all documentation is current.**
**Every implementation must be questioned. Confidence < 90% means work is not done.**

## Safety Rules

Require operator confirmation before running:
- git reset --hard, push --force, branch -D, clean -fd, rebase, filter-branch
- rm -rf, changes to >5 files, system config changes

## Defaults

When a project has no established conventions, use these as a starting point:

**Design principles:**
- **SOLID** — single responsibility, clear abstractions
- **DRY** — shared logic lives in one place
- **KISS** — simplest solution that works

**Requirements:**
- EARS notation (Easy Approach to Requirements Syntax)
- REQ identification scheme (e.g. REQ-MODULE-N)
- BDD acceptance criteria — observable system behaviors, not implementation details
- Rationale for each requirement
- Verification entries (V-REQ-*) linking ACs to test evidence

**Implementation:**
- Fix upstream contracts (prompts, schemas, formats) before adding code complexity
- Remove dead code and its tests
- Write tests for every new public function, class, and module
- One test per AC at minimum; complex logic gets edge case tests
- Tests in a `tests/` directory matching source module names (e.g. `session.py` → `test_session.py`)

**Documentation:**
- REQUIREMENTS.md, ARCHITECTURE.md, README.md, CHANGELOG.md

**Prompt authoring:**
- Use positive instructions — tell the model what to do, not what to avoid
- Keep prompts compact — every token competes with the model's working memory
