# ADR-006: Resource Reorganization — Agents, Skills, Templates

**Date:** 2026-03-15
**Status:** Accepted
**Deciders:** Tyler Presley
**Supersedes:** Flat `AGENT.md`, `CONVENTIONS.md`, `SKILLS.md`, `skills/*.md`

## Context

The original resource layout was flat and role-confused:

- Single `AGENT.md` contained all three roles (Analyst, Architect, Developer) — 400+ lines loaded into every session regardless of phase
- `CONVENTIONS.md` duplicated content from AGENT.md with operational rules
- `SKILLS.md` was a static registry that had to be manually synced with skill files
- Skill files used old domain names (`BACKEND.md`, `FRONTEND.md`) that didn't match the expanded scope

## Decision

Reorganize into three directories under `resources/`:

```
resources/
├── agents/          # Role-specific (3 files)
│   ├── ANALYST.md   # Gather phase only
│   ├── ARCHITECT.md # Plan phase, escalations
│   └── DEVELOPER.md # Develop, automate, verify
├── skills/          # Domain conventions (15 files)
│   ├── AI-ETHICS.md
│   ├── ARCH-DESIGN.md
│   ├── ...
│   └── WORKFLOW.md
└── templates/       # Document scaffolding (5 files)
    ├── ADR-TEMPLATE.md
    ├── REQUIREMENTS-TEMPLATE.md
    └── ...
```

MCP tools serve these on demand: `get_agent(role, topic)`, `get_skill(name, topic)`, `get_template(name)`. The static `SKILLS.md` registry was deleted — the MCP server lists skills dynamically from the directory.

## Consequences

- **Positive:** Each phase loads only its role file — no cross-role confusion
- **Positive:** 15 specialized skills replace 11 generic ones — better domain coverage
- **Positive:** No manual registry sync — skills discovered from filesystem
- **Positive:** Section-level retrieval via markdown parser — models get only what they need
- **Negative:** `CONVENTIONS.md` content was distributed across agent files and skill files — no single "rulebook" anymore
- **Negative:** Existing task files referencing old skill tags (`backend`, `frontend`) need updating
