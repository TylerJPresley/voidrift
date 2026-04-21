# Contributing: Change Workflow

This document defines the process for making changes to VoidRift. Every change —
feature, fix, refactor, or doc update — follows this workflow. No exceptions.

This project is building the tool that would normally enforce this process. Since
we can't use the tool to build itself, this document is the enforcement mechanism.
The agent operating on this project treats these gates as hard stops, not suggestions.

## The Pipeline

VoidRift enforces process through tool ordering: gather → plan → develop → verify.
We enforce the same process through conversation gates. The agent will not advance
past a gate without the required artifact or explicit operator approval to skip.

```
  Diagnose ──→ Propose ──→ [GATE: operator approval]
                              │
                              ▼
                     Write Requirements ──→ [GATE: operator approval]
                              │
                              ▼
                         Implement ──→ Verify ──→ Document ──→ Self-Review
                              │
                              ▼
                     Commit ──→ Summarize
```

## Pre-Flight (before writing code)

Every change must pass these checks before implementation begins:

- [ ] **Root cause traced** — the problem is understood, not just the symptom.
      Impact mapped: callers, dependencies, tests, configuration, documentation.
- [ ] **Solution proposed** — what changes, where, and why. Operator approved.
- [ ] **Requirement exists** — the change traces to a REQ-* entry in REQUIREMENTS.md
      with EARS notation and BDD acceptance criteria. If no requirement exists,
      write one and wait for operator approval before proceeding.
- [ ] **Architecture current** — ARCHITECTURE.md reflects the component that owns
      this change. If boundaries shift, update architecture first.

If a requirement doesn't exist and the operator says "just do it," the agent writes
the requirement anyway — even if minimal. The contract exists before the code.

## Requirements Format

- EARS notation: WHEN [trigger], THE SYSTEM SHALL [result]
- REQ identification: REQ-MODULE-N (e.g. REQ-CHAT-15)
- Rationale for non-obvious requirements
- BDD acceptance criteria: Given [context], When [action], Then [outcome]
- Verification entry: V-REQ-* linking ACs to test evidence

## Requirements Gate

Every modification to REQUIREMENTS.md — adding, changing, splitting, merging, or
removing a requirement or AC — must pass through these checks. No exceptions.

Before writing, evaluate each change:

1. **Behavioral?** It describes what the system achieves, not how it's implemented.
   Implementation details go to ARCHITECTURE.md.
2. **Needed?** It captures a unique intent not already covered. VERIFY by reading
   the existing requirement before claiming coverage.
3. **Placed correctly?** Feature-specific → that feature's section. Cross-cutting →
   4.5.x or 4.1. Multiple intents → split into separate requirements in their
   respective sections.
4. **Well-formed?** EARS notation, rationale, BDD acceptance criteria. Strip
   implementation details, add missing rationale/ACs if needed.
5. **Safe to remove?** Before removing anything, confirm every unique behavioral
   intent is captured in a placed requirement. If not, move the content first.
   Never delete uncaptured intent.
6. **Details migrated?** If stripping implementation details, move them to
   ARCHITECTURE.md in the same action. Not "later" — now.

After evaluation, present the proposed change to the operator and wait for approval
before writing to REQUIREMENTS.md. This applies to new requirements, new ACs,
modified requirements, and removals.

## Implementation Rules

- Write code that satisfies the acceptance criteria. Nothing more.
- Write tests. One test per AC minimum.
- Follow project conventions — raise concerns before deviating.
- If a proper fix isn't feasible, say so explicitly. Get approval before
  adding a workaround.

## Post-Flight (before claiming done)

Every change must pass these checks before work is reported complete:

- [ ] **All ACs satisfied** — re-read each acceptance criterion. Confirm the code
      satisfies it. Not "should work" — read the output, run the test.
- [ ] **Tests pass** — `bun test` passes. No regressions.
- [ ] **REQUIREMENTS.md updated** — if behavior changed, the requirement reflects it.
- [ ] **ARCHITECTURE.md updated** — if component boundaries, data flows, or decisions
      changed, the blueprint reflects it.
- [ ] **README.md updated** — if user-facing behavior changed, the manual reflects it.
- [ ] **Verification plan current** — V-* entries exist for new/changed requirements.
- [ ] **Confidence ≥ 90%** — score honestly. Below 90% means work is not done.
      Close the gaps. Only raise with the operator when the gap is a preference
      or constraint that cannot be resolved through analysis.

## Applicable Skills

Load from `resources/skills/` based on the change area. These are not optional —
they define the quality and documentation standards for each domain.

- **Any change**: QUALITY-QA, ANALYSIS-REQS
- **Agent loop** (`src/agent/`): WORKFLOW, RELIABILITY-ENG
- **Tools** (`src/tools/`): SECURITY-TRUST, BACKEND-ENG
- **Commands** (`src/commands/`): BACKEND-ENG, SYSTEMS-ENG
- **CLI entry / headless** (`src/index.ts`): SYSTEMS-ENG
- **TUI** (`src/tui/`): BACKEND-ENG
- **Architecture / design changes**: ARCH-DESIGN

QUALITY-QA enforces the post-flight checklist. ANALYSIS-REQS enforces the
requirements format. Both are always active.

## Commit Convention

- Commit after each logical unit of work.
- Message references AC IDs: `feat(chat): implement /bare toggle (REQ-CHAT-7)`
- Stage specific files — no `git add .`

## Summary Template

After completing a unit of work:

```
Files changed: <list>
ACs satisfied: <REQ-IDs>
Tests added/modified: <list>
Docs updated: <list>
Confidence: <0-100>%
Open questions: <if any>
```
