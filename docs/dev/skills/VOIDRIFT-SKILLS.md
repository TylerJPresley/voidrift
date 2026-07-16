# VOIDRIFT-SKILLS

Development guidelines for building VoidRift's skill system.

## Naming Convention

VoidRift development skills are prefixed with `VOIDRIFT-*`. Any skill starting with `VOIDRIFT-` is internal development guidance for building VoidRift itself — not user-facing.

## Three Tiers of Skills

### 1. User Skills (workspace/global)

Files in `.voidrift/skills/` or `~/.config/voidrift/skills/`. User-provided.

Purpose: Encode domain knowledge for the user's work. Not about VoidRift — about their project.

Properties:
- Varies by project or personal preference
- Added, removed, or overridden freely by the user
- Ship as examples in `docs/skills/` — users copy to activate

Examples: BACKEND-ENG, SECURITY-TRUST, WEB-ENG, VCS

### 2. System Skills (builtin, overrideable)

Registered in `src/skills/builtins.ts`. Compiled into the binary.

Purpose: Govern how to USE VoidRift's own features. Every core feature gets a corresponding builtin skill.

Properties:
- Loaded when the user is actively using that feature (keyword/description-triggered)
- Detailed: workflows, decision points, ✅/❌ examples
- Overridable via filesystem (`.voidrift/skills/<name>.md` takes precedence)
- No agent binding — triggers only

When to add a new system skill:
- A new VoidRift feature is added. Every feature gets a skill. No exceptions.

Examples: planning, memory, delegation, workspace, context-budget, tasks, model-escalation

### 3. Development Skills (`docs/dev/skills/VOIDRIFT-*`)

Source of truth: `docs/dev/skills/`. Copied to workspace for active use.

Purpose: Guardrails for building VoidRift itself. Not for users — for developers working on the harness.

Properties:
- Prefixed with `VOIDRIFT-*`
- Tracked in git (ships in repo, not in npm package)
- Activated by copying to `.voidrift/skills/` or `~/.config/voidrift/skills/`
- Define rules for working on specific subsystems

When to add a new dev skill:
- A new VoidRift subsystem needs development guardrails
- Developers keep making the same mistakes in an area

Examples: VOIDRIFT-DEV, VOIDRIFT-TOOLS, VOIDRIFT-ORCHESTRATION, VOIDRIFT-SECURITY

## Skill Structure

```markdown
---
name: SKILL-NAME
description: One sentence (appears in skill discovery index)
triggers:
  extensions: [".ts"]
  files: ["Dockerfile"]
  keywords: ["keyword1", "keyword2"]
agents: []
active: true
---

# SKILL-NAME

## When This Applies
Scope statement.

## Rules/Patterns
Concrete guidance with ✅/❌ examples.

## Stored Decisions (if applicable)
Project decisions to check in memory before asking.
```

## Guidelines

- **Under 100 lines** — context budget matters
- **Actionable** — tells the model what to DO
- **Concrete** — at least 2-3 ✅/❌ examples
- **Triggered precisely** — keywords must not fire on unrelated turns
- **No agent binding** — skills load via keyword/extension/file triggers only

## Core Feature → Skill Mapping

Every core feature needs BOTH a brief pointer in `core.rules` AND a builtin skill:

| Feature | core.rules (awareness) | Builtin skill (competence) |
|---------|----------------------|---------------------------|
| Planning | "Use add_plan(), read_plan()..." | `planning` — full workflow |
| Memory | "Use save_memory(), delete_memory()..." | `memory` — decision framework |
| Delegation | "Use spawn_subagent(), invoke_task()..." | `delegation` — tool decision matrix |
| Workspace | "Use workspace_map(), glob_files()..." | `workspace` — exploration patterns |
| Context | Layer names, "summaries only" | `context-budget` — layer management |
| Tasks | "Use register_task(), invoke_task()..." | `tasks` — reusable definitions |

## When NOT to Make a Skill

| Situation | Where it goes |
|-----------|--------------|
| Universal behavioral rule | `core.rules` |
| One-time instruction | Plan item |
| Stored project decision | Memory directive |
| Only applies to one file | Code comment |

## The Principle

`core.rules` makes the model AWARE a feature exists.
The builtin skill makes it COMPETENT to use it correctly.
Custom skills make it an EXPERT in the user's domain.
