# ADR-006: Resource Organization — Agents, Skills, Templates

**Date:** 2026-03-15
**Status:** Accepted

## Context

The framework serves three distinct roles (Analyst, Architect, Developer) across five phases. Each role needs different guidance, and loading all guidance into every session wastes context window. Skills and templates need to be discoverable without a manual registry.

## Decision

Organize resources into three directories:

```
resources/
├── agents/          # Role-specific guidance (3 files)
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

MCP tools serve these on demand: `get_agent(role, topic)`, `get_skill(name, topic)`, `get_template(name)`. Skills are discovered dynamically from the directory — no static registry to maintain.

## Consequences

- Each phase loads only its role file — no cross-role confusion
- 15 specialized skills cover distinct engineering domains
- Skills discovered from filesystem — adding a skill is just adding a file
- Section-level retrieval via markdown parser — models get only what they need
- Task skill tags reference filenames (lowercase, without `.md` extension)
