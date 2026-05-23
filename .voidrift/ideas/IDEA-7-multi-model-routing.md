---
id: IDEA-7
status: draft
category: now
created: 2026-04-26
---

# Multi-Model Task Routing (Three-Tier Architecture)

## Summary
A task classification and routing system that assigns models to specialized roles. Light tasks go to the fast/cheap model, complex tasks to the heavy cloud model. The utility model (local) acts as the "manager" that handles most interactive work.

## Context

VoidRift supports multiple model endpoints, each with different cost, speed, and capability profiles. The routing system classifies incoming tasks and dispatches them to the appropriate model. This avoids wasting expensive compute on simple tasks while ensuring complex work gets the capability it needs.

### The Three-Tier Model

| Tier | Model | Role | Task Types | Characteristics |
|------|-------|------|------------|-----------------|
| **Flash** | Fast, cheap (local) | Scout | File reads, simple edits, summarization, scraping, formatting, image parsing | Low latency, small context, fast turnaround |
| **Utility (MoE)** | Mid-tier (local MoE) | Collaborator | Chat interactions, analysis, planning, medium tasks, knowledge work | Good reasoning, fast enough for interactive work |
| **Dense/Cloud** | Heavy model (cloud) | Architect | Complex reasoning, long-term planning, extensive code generation, cross-file architecture, deep codebase understanding | Deep reasoning, large context, slow but capable |

### Core Principles

1. **User always feels responsive.** Flash handles simple stuff instantly. The utility model keeps the user engaged.
2. **Expensive compute is reserved.** The dense model is used only when actually needed.
3. **Cost is proportional to complexity.** Simple tasks cost pennies. Complex tasks cost more — but you only pay when it matters.
4. **Context is shared.** The utility model "remembers" what the flash model did. Context is not lost when switching models.

### Task Classification

Classification determines the tier:
- **Flash tasks:** Read a file, summarize text, format output, extract data, simple edits, image processing, web scraping
- **Utility tasks:** Chat, analysis, planning, code review, medium-sized refactors, knowledge work
- **Dense tasks:** Architecture design, multi-file changes, cross-module understanding, deep debugging, complex feature implementation

Classification can start keyword-based and improve with heuristics:
- Keyword matching (e.g., "summarize" → flash, "plan" → utility, "design" → dense)
- Task length (short tasks → flash/utility, long tasks → dense)
- Context requirements (small scope → flash, large scope → dense)
- Heuristics based on history (what worked before)

### Classification Rules

| Trigger | Classification | Model |
|---------|---------------|-------|
| "summarize" | simple | flash |
| "read file" | simple | flash |
| "scrape" | simple | flash |
| "format" | simple | flash |
| "edit one file" | medium | utility |
| "explain" | medium | utility |
| "refactor" | medium | utility |
| "plan" | complex | utility → dense |
| "design" | complex | dense |
| "debug" | complex | utility → dense |
| "code generation" | complex | dense |

Classification is config-driven (`.voidrift/router.json`) so operators can customize which model handles which tasks.

### Escalation

When a task starts in one tier but reveals complexity beyond its capability, it can "escalate":

1. **Flash → Utility:** The scout discovers a task is more complex than expected and passes it to the collaborator.
2. **Utility → Dense:** The collaborator encounters a problem requiring deep reasoning and passes it to the architect.
3. **Dense → Utility:** The architect makes a decision that the collaborator then executes (e.g., architecture design returned for implementation).

**When to escalate:**
- Flash discovers the task requires more context than it has
- Utility encounters a problem requiring cross-file analysis
- Dense identifies a pattern that utility can handle more efficiently
- The user explicitly requests escalation

**Escalation mechanics:**
- The current model's work product is preserved
- Context is passed to the next model (file paths, summaries, decisions made)
- The user is not aware of the escalation (it's transparent)
- The escalation log is kept for transparency/debugging

### Delegation

The utility model acts as the "manager." It can delegate simple tasks to the flash model:
- "Hey, read these 5 files for me and return the structure"
- "Summarize this 200-line function"
- "Find all references to `APIClient` in the codebase"

**Delegation rules:**
- Flash can only read and return — it cannot write or execute code
- The utility model sets the task boundaries and validates results
- Flash returns structured results, not raw output
- Failed flash tasks are escalated upward

### Context Sharing

When switching between models, context is preserved:
- **Shared filesystem:** All models read/write from the same project files
- **Shared in-memory state:** Results from flash tasks are cached for the utility model
- **Explicit handoff:** Utility model explicitly reads flash model's work product
- **Session context:** All models in a session see the same conversation history

## Acceptance Criteria

- [ ] Given a user request, When the router classifies it, Then it returns the correct TaskType (flash/utility/dense)
- [ ] Given a TaskType, When routing looks up the config, Then it returns the correct model alias
- [ ] Given a routed model alias, When a session is created, Then it uses the correct ContentGenerator
- [ ] Given a flash task (e.g., summarize), When the session runs, Then the flash model handles the request
- [ ] Given a dense task (e.g., design), When the session runs, Then the dense model handles the request
- [ ] Given an unrecognized task, When routing falls back, Then it uses the fallback model (utility)
- [ ] Given a flash task, When it discovers more complexity, Then it escalates to the utility model
- [ ] Given a utility task, When it encounters complex reasoning, Then it escalates to the dense model
- [ ] Given an escalation, When it occurs, Then the user is not aware (it's transparent)
- [ ] Given context sharing, When switching models, Then conversation history and file references are preserved

## Affected Modules

@voidrift/core (new `task-router.ts`, `escalation.ts`, `delegation.ts`), @voidrift/tui (integration point), @voidrift/analyze-command (consumer)

## Notes

- Classification can start keyword-based and improve with heuristics over time
- Routing table is config-driven (`.voidrift/router.json`) so operators can customize
- `AgentSession` instances are created per-task with the routed ContentGenerator
- This builds on the existing `subagent` package but adds the routing/escalation layer
- The utility model is the central hub — all tasks flow through it, even when delegated to flash
