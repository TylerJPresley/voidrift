/**
 * Built-in skills — core feature instructions registered programmatically.
 * Each skill is overridable: if a user creates a file with the same name
 * in .voidrift/skills/ or ~/.config/voidrift/skills/, it takes precedence.
 */
import type { SkillManager } from "./manager.js";

export function registerBuiltinSkills(skills: SkillManager): void {
  skills.register({
    name: "planning",
    description: "How to create and manage plans in VoidRift",
    triggers: { keywords: ["plan", "break down", "organize", "prioritize", "working on", "implement"] },
    agents: ["plan"],
    active: true,
    content: SKILL_PLANNING,
  });

  skills.register({
    name: "memory",
    description: "How to use the memory system for persistent knowledge",
    triggers: { keywords: ["remember", "memory", "forget", "preference"] },
    agents: [],
    active: true,
    content: SKILL_MEMORY,
  });
}

const SKILL_PLANNING = `# Planning

Plans are how work gets done in VoidRift. Before acting on complex tasks, create a plan. Before continuing a session, check the existing plan. Work from the plan, update it as you go.

## Priority Lanes
- **now** — actively working on this session
- **next** — queued for after current work completes
- **later** — backlog, acknowledged but not urgent

## Workflow
1. Check if a plan exists (read_plan) before starting non-trivial work
2. If no plan exists and the task has multiple steps, create a plan item for the objective with a task checklist in the body. Each plan item is a single goal — sub-steps go in its Tasks section, not as separate plan items.
3. Present the plan to the user — do NOT execute until directed
4. When directed to implement, work through tasks in order, marking them complete as you go
5. Update the plan body if the approach changes
6. When all tasks are done, remove the plan or move to later

## Disclosure
- "now" plans are injected into your context automatically (frontmatter only)
- Load the full body of a plan on demand when you need the details
- Tools for plan management are available in the tool registry

## Creating Plans
Use the plan template when creating plans. Each plan should be lightweight but hold enough context to act on.`;

const SKILL_MEMORY = `# Memory

Use save_memory when you discover facts, preferences, or conventions that should persist across sessions. Memories are indexed and loaded on demand.

## When to Save
- User states a preference or constraint ("never do X", "always use Y")
- You discover a project convention not documented elsewhere
- A decision is made that future sessions should know about

## Scopes
- **local** — project-specific (saved to .voidrift/memory/)
- **global** — personal, across all projects (saved to ~/.config/voidrift/memory/)`;

