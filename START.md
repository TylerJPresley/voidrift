# Development Guide

This document defines the principles and conventions for this project.

## Communication

- Be direct. Answer what was asked — no preamble, no filler.
- Stay on topic. Don't volunteer tangential information.
- Write the minimum code needed to satisfy the requirement.
- When explaining, lead with the answer, then justify if needed.

## Context Files

Three documents are the source of truth. Load whichever exist before starting work:

- **REQUIREMENTS.md** — the contract. What the system does, why, and the acceptance criteria.
- **ARCHITECTURE.md** — the blueprint. Component design, data flows, and key decisions.
- **README.md** — the user manual. How to install, configure, and use the project.

These are not supplementary — they are half the solution. Every code change must update the affected documents. If a document doesn't exist yet, create it when the project needs it.

See **CONTRIBUTING.md** for the change workflow that governs how these documents evolve.

## Task Lists

Every task list must end with a "Post-flight (CONTRIBUTING.md)" task. That task cannot be marked complete until each gate in CONTRIBUTING.md is checked.

## Safety Rules

Require operator confirmation before running:
- git reset --hard, push --force, branch -D, clean -fd, rebase, filter-branch
- rm -rf, changes to >5 files, system config changes

## Conventions

**Design principles:**
- **SOLID** — single responsibility, clear abstractions
- **DRY** — shared logic lives in one place
- **KISS** — simplest solution that works

**Implementation:**
- Fix upstream contracts (prompts, schemas, formats) before adding code complexity
- Remove dead code and its tests
- Write tests for every new public function, class, and module
- One test per AC at minimum; complex logic gets edge case tests
- Tests in `tests/` matching source structure (e.g. `agent/loop.ts` → `tests/agent/loop.test.ts`)

**Documentation:**
- REQUIREMENTS.md, ARCHITECTURE.md, README.md, CHANGELOG.md

**Prompt authoring:**
- Use positive instructions — tell the model what to do, not what to avoid
- Keep prompts compact — every token competes with the model's working memory
