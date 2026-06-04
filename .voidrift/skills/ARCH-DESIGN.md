---
name: ARCH-DESIGN
description: Practical architecture decisions for VoidRift-generated projects: component boundaries, module grouping for concurrent develop dispatch, and ARCHITECTURE.md structure.
triggers:
  extensions: []
  files: ["ARCHITECTURE.md"]
  keywords: ["architecture","module","component","design"]
agents: []
active: true
---

# Domain: Architecture & Design (ARCH-DESIGN)

## ARCHITECTURE.md Structure

Every ARCHITECTURE.md must have three sections:

§1 System Context — diagram and description of the system boundary, external actors,
and integration points.

§2 Components — one subsection per module (`## 2.N ComponentName`) with its
responsibilities and owned files. This section drives develop dispatch: each component
becomes a module group whose tasks can run concurrently. Boundaries should reflect
units of work that can be implemented independently without file conflicts.

§3 Key Design Decisions — numbered `### 3.N Title` entries. Each entry includes the
decision itself (one sentence), **Why:** (the constraint or tradeoff that drove it),
and **Consequence:** (what this makes harder or impossible). No entry without a Why.

## Module Boundary Guidance

A module boundary is right when: its files are cohesive (high coupling within, low
coupling across), a developer can implement it without knowing the internals of
another module, and its tasks can run concurrently with tasks in other modules.

Prefer fewer, larger modules over many tiny ones for small projects. A 500-line
codebase does not need six modules.

## Right-Sizing Architecture

Monolith first. Add service boundaries only when the problem requires independent
deployment, separate scaling, or team isolation. These are rare constraints — do not
impose them speculatively.

State management: define where each piece of state lives (in-memory, file, database)
in the Component section. Ambiguous state ownership causes integration failures.

External dependencies: list them in §2 under the component that owns them. Flag any
dependency that requires credentials or network access — the verify stage will need
to mock it.

## Decision Rationale Format

Each `### 3.N Decision Title` entry must include:
- The decision itself (one sentence).
- **Why:** the constraint or tradeoff that drove it.
- **Consequence:** what this makes harder or impossible.
