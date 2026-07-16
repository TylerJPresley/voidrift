# Knowledge Map

VoidRift's static knowledge lives in `docs/`. This file is the entry point — a navigable table of contents that tells you where to look for what.

## Two Knowledge Types

| | Static (`docs/`) | Dynamic (Memory Tool) |
|---|---|---|
| **Source** | Written by humans (or generated) | Learned by the agent |
| **Change** | Version-controlled, explicit | Auto-discovered, auto-stored |
| **Purpose** | System knowledge (how things work) | Session knowledge (what we learned) |
| **Discovery** | Navigated via this map | Loaded via keyword matching |
| **Staleness** | Checked by doc-sync tools | Decays automatically |

**Principle:** The repo is the static memory. The memory tool is the dynamic memory. Both serve the agent.

---

## Three Skill Tiers

VoidRift's skills are organized into three tiers, each with a different intent and lifecycle.

### 1. User Skills (`docs/skills/`)

Domain knowledge for the user's work. These are additive — the user owns them, extends them, and can delete them.

| Skill | Covers |
|-------|--------|
| `BACKEND-ENG.md` | API design, error handling, service boundaries |
| `CLOUD-OPS.md` | Docker, CI/CD, secrets, health checks, Makefile |
| `DATA-ENG.md` | Schema design, migrations, queries, pipelines |
| `PROD-STRATEGY.md` | Commits, versioning, changelogs, README structure |
| `QUALITY-QA.md` | Testing iron law, debugging protocol, evidence standard |
| `SECURITY-TRUST.md` | Auth, authorization, validation, secrets, headers |
| `SYSTEMS-ENG.md` | stdout/stderr, signals, CLI design, packaging |
| `VCS.md` | Branching, commits, merges, tags, workflow state machine |
| `WEB-ENG.md` | Components, rendering, accessibility, performance |
| `WEB-RESEARCH.md` | Search strategy, multi-step navigation, source priority |

### 2. VoidRift System Skills (builtin, overrideable)

How VoidRift operates — the harness's own behavioral knowledge. These ship as defaults, can be overridden by the user, and can be deleted to revert to the default.

| Action | Effect |
|--------|--------|
| **Override** | Place a file in `.voidrift/skills/` with the same name → user version takes precedence |
| **Delete** | Remove the override → reverts to the shipped default |
| **Read** | The default lives in `src/skills/builtins.ts` (compiled) |

These are the skills that make VoidRift self-aware of its own features: planning, memory, tools, agents, sessions, context, etc.

### 3. VoidRift Development Skills (`docs/dev/skills/VOIDRIFT-*`)

How to build a harness like VoidRift. These are reference material for people building their own AI harness (like Claude Code, Kiro, etc.) — not for VoidRift users.

| Skill | Covers |
|-------|--------|
| `VOIDRIFT-AGENTS.md` | Agent registry, resolution cascade, manifest schema |
| `VOIDRIFT-CONTEXT.md` | Four-layer context architecture, compaction, token estimation |
| `VOIDRIFT-DEBUGGING.md` | Audit logs, diagnostic patterns, session files |
| `VOIDRIFT-DEV.md` | Project conventions, adding features, testing, git workflow |
| `VOIDRIFT-TESTING.md` | Vitest setup, test structure, what to test |
| `VOIDRIFT-MCP.md` | MCP engine, OAuth2, credentials, discovery |
| `VOIDRIFT-ORCHESTRATION.md` | Tool loop, subagents, scheduler, run mode |
| `VOIDRIFT-PLUGINS.md` | Plugin API, discovery, CoreAPI surface |
| `VOIDRIFT-PROMPTS.md` | `core.rules`, prompt override cascade, boundary rules |
| `VOIDRIFT-RELEASE.md` | Publishing, versioning, what ships |
| `VOIDRIFT-SECURITY.md` | Policy engine, permission gate, shell classification |
| `VOIDRIFT-SESSION.md` | Session persistence, brain, checkpoints, compaction |
| `VOIDRIFT-SKILLS.md` | Skill system, structure, naming, builtin vs custom |
| `VOIDRIFT-TOOLS.md` | Tool schemas, execution flow, registry pattern |
| `VOIDRIFT-UI.md` | Ink/TUI architecture, panels, streaming UX |

---

## Navigation

### Start Here — `ARCHITECTURE.md`

The system overview. Covers all core subsystems, data flow, design decisions, and the three surfaces. Read this first to understand how VoidRift works as a whole.

### Drill Down

| Need | Go To |
|------|-------|
| Feature reference | `FEATURES.md` |
| How to use a feature | Relevant `VOIDRIFT-*.md` skill |
| How to build a harness | Relevant `VOIDRIFT-*.md` skill |
| Domain knowledge | Relevant `skills/*.md` |
| What we learned | `memory` tool (dynamic knowledge) |

### Other Docs
- **`CONTRIBUTING.md`** — Setup, workflow, PR guidelines
- **`PLUGINS.md`** — Plugin development guide, CoreAPI reference
- **`SECURITY.md`** — Supported versions, vulnerability reporting
- **`CODE_OF_CONDUCT.md`** — Contributor covenant

---

## How to Use This Map

1. **Start with `ARCHITECTURE.md`** — understand the system
2. **Find a feature** → read `FEATURES.md`
3. **Find how it works** → read the relevant `VOIDRIFT-*.md` skill
4. **Find domain knowledge** → read the relevant `skills/*.md`
5. **Find what was learned** → use the `memory` tool (dynamic knowledge)

**Static knowledge = read from `docs/`. Dynamic knowledge = query via memory tool.**