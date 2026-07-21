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
    triggers: { keywords: ["plan", "break down", "organize", "prioritize", "working on", "implement", "multi-step"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_PLANNING,
  });

  skills.register({
    name: "memory",
    description: "How to use the memory system for persistent knowledge",
    triggers: { keywords: ["remember", "memory", "forget", "preference"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_MEMORY,
  });

  skills.register({
    name: "delegation",
    description: "How to delegate work to background agents",
    triggers: { keywords: ["delegate", "background", "subagent", "task", "parallel", "repetitive"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_DELEGATION,
  });

  skills.register({
    name: "workspace",
    description: "How to explore and search the workspace",
    triggers: { keywords: ["workspace", "file tree", "search", "find files", "explore", "directory"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_WORKSPACE,
  });

  skills.register({
    name: "context-budget",
    description: "How context layers work and when to compact",
    triggers: { keywords: ["context", "compaction", "token", "budget", "layer", "volatile"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_CONTEXT_BUDGET,
  });

  skills.register({
    name: "tasks",
    description: "How to create and run reusable task definitions",
    triggers: { keywords: ["task", "register_task", "invoke_task", "reusable", "template"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_TASKS,
  });

  skills.register({
    name: "model-escalation",
    description: "How to use model escalation for complex tasks",
    triggers: { keywords: ["escalate", "deescalate", "model", "escalation", "help", "stuck", "reasoning"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_MODEL_ESCALATION,
  });

  skills.register({
    name: "routines",
    description: "How to create and manage repeatable routines",
    triggers: { keywords: ["routine", "routines", "repeatable", "recipe", "runbook"] },
    agents: [],
    active: true,
    sourcePlugin: "builtin",
    content: SKILL_ROUTINES,
  });
}

const SKILL_PLANNING = `# Planning

Plans are how multi-step work gets tracked in VoidRift. They persist across sessions, survive compaction, and give the user editorial control over what happens next.

## When to Plan
- The task has 3+ distinct steps that modify different files or systems
- The user asks you to "plan", "break down", "organize", or "implement" something complex
- You're resuming a session and need to check what was in progress

Do NOT plan for: single-file edits, direct questions, quick fixes, or tasks you can complete in one tool call.

## Workflow
1. **Check first** — call read_plan() before starting non-trivial work. If a plan exists, present it to the user and wait for direction.
2. **Create** — if no plan exists and the task warrants one, create a single plan item with a task checklist in the body.
3. **Present** — show the plan to the user. Do NOT execute until they direct you to.
4. **Execute** — work through tasks in order. Before marking a checkbox complete, verify the result: re-read the modified file, run the relevant test, or confirm the output matches intent. Attempted ≠ done. A tool call succeeding ≠ the task being correct. Only check the box when you have evidence it worked.
5. **Finish** — when all tasks are done, remove the plan item or move to "later."

This workflow applies when **starting new multi-step work**. It does NOT apply to simple plan operations (list, remove, reprioritize) — just do those directly when asked.

## Single-Result Rule
When a request produces multiple subtasks that contribute to the **same output** (one file, one report, one analysis), create a **SINGLE plan item** with subtasks as checklist items in the body.

**NEVER** create separate plan items for subtasks that share the same output file, analysis goal, or deliverable.

**DO** create separate plan items only when subtasks have fundamentally different goals or outputs.

**"For each X" or "for every X" → checklist.** Do NOT create a plan item per X.

## Plan Item Structure
\`\`\`
name: lowercase-hyphenated-slug
description: One sentence (under 20 words) — enough to understand without loading body
priority: now | next | later
body: (uses template sections)
  ## Why — the problem or motivation
  ## Overview — approach, affected areas
  ## Constraints — what to avoid, dependencies
  ## Tasks — ordered checklist (THIS is the progress tracker)
  ## Done When — clear exit condition
\`\`\`

## Scope Declaration (Optional)

When creating a plan for multi-file work, declare the **scope** — which files you intend to write and which commands you intend to run. This lets the harness auto-approve actions within scope without prompting the user on every call.

\`\`\`
add_plan(
  name: "auth-refactor",
  description: "Refactor auth module to use JWT RS256",
  priority: "now",
  body: "## Why\\n...\\n## Tasks\\n- [ ] ...",
  scope: { write: ["src/auth/**"], execute: ["bun run test"] }
)
\`\`\`

If you don't declare scope, the plan still works — the user just approves actions individually as today. Scope is a convenience, not a requirement. Use it when you know the affected files upfront.

## Priority Lanes
- **now** — actively working on this session
- **next** — queued for after current work completes
- **later** — backlog, acknowledged but not urgent

## Disclosure
- "now" plan descriptions are injected into your context automatically (Orbit layer)
- Load the full body with read_plan(name) when you need task details
- The user can reprioritize or remove items at any time — respect their edits`;

const SKILL_MEMORY = `# Memory

Memories are persistent facts that compound over time. They survive across sessions without the user repeating themselves.

## When to Save
- User states a preference or constraint ("always use X", "never do Y")
- You discover a project convention not documented elsewhere
- A key decision is made that future sessions should know about
- You learn something about the codebase architecture that isn't obvious from the code

Do NOT save: transient task state (use plans), file contents (use read_file), or things already in documentation.

## Type Decision
- **directive** — rules and preferences that should load EVERY session automatically. Use sparingly. ("Use snake_case for API fields", "Tests must use mock DB")
- **reference** — facts loaded on demand when keywords match. Default choice. ("Auth module is being deprecated", "Deploy requires VPN")

## Scope Decision
- **local** (.voidrift/memory/) — project-specific facts. Most memories go here.
- **global** (~/.config/voidrift/memory/) — personal preferences across all projects. ("Prefer functional patterns", "Use descriptive variable names")

## Keywords
Choose 2-4 keywords that would appear in a user's message when this memory is relevant. Keywords drive automatic discovery — bad keywords mean the memory never loads.

## When to Delete
- The fact is no longer true (dependency removed, convention changed)
- The user explicitly says to forget something
- You notice a memory contradicts current project state

## Tools
- save_memory(title, content, keywords, scope, type) — create
- delete_memory(id) — remove outdated
- list_memory() — browse all saved memories

## Form-and-Values Pattern

When working in a domain that involves repeatable project decisions (test runner, framework, deploy target, auth provider, styling approach, etc.):

1. **Check memory first** — call list_memory() to see if the decision was already stored
2. **If found** — use the stored value. Don't ask again.
3. **If missing** — ask the user once, then store their answer as a directive memory

Examples of decisions worth storing:
- "Test runner: vitest, files in src/**/*.test.ts"
- "Auth: Supabase SSR, cookie-based, RS256 JWTs"
- "Styling: Tailwind CSS, no CSS modules"
- "Deploy: Docker → ECR → ECS Fargate"
- "Database: PostgreSQL via Prisma, UTC timestamps"
- "API format: REST, snake_case fields, structured errors"

This prevents the same question from being asked every session. One decision, stored once, applied forever.`;

const SKILL_DELEGATION = `# Delegation

Delegation lets you offload work to background agents without burning your own context. Use it when a task is repetitive, long-running, or can be done in parallel.

## When to Delegate
- Processing many items (N files, N URLs, N checks)
- Long-running operations (builds, tests, data fetching)
- Parallelizable work (transforming multiple files independently)
- Work that doesn't need your active reasoning

Do NOT delegate: decisions requiring judgment, work that depends on intermediate results, anything that needs user approval.

## Tool Decision

| Need | Tool |
|------|------|
| Run a shell command in background | background_exec() |
| Delegate a structured task to an agent | spawn_subagent() |
| Run a registered task repeatedly | invoke_task() |
| Schedule work for later | schedule() |

## spawn_subagent — When to Use

Use when you need an agent to work on specific files in isolation:

\`\`\`
spawn_subagent(
  task: "Fetch all URLs from README and validate they return 200",
  files: ["README.md", "docs/guide.md"]
)
\`\`\`

The agent runs in an isolated worktree, merges results back on completion.

## invoke_task — When to Use

Use when you've defined a reusable task and want to run it with different inputs:

\`\`\`
invoke_task(
  name: "fetch-url",
  vars: { url: "https://example.com", output: "results.md" }
)
\`\`\`

Tasks are defined once with register_task(), then invoked with different variables.

## background_exec — When to Use

Use for simple shell commands that run longer than a few seconds:

\`\`\`
background_exec(command: "bun run test --coverage")
// Returns task ID immediately
check_task(id) // Poll for results
\`\`\`

## Key Constraints
- Agents run in isolated worktrees — they can't see your workspace
- Results merge back automatically — you get the output, not the worktree
- No user interaction — agents can't prompt the user
- Context budget — each agent burns its own context, not yours`;

const SKILL_WORKSPACE = `# Workspace

The workspace tools give you awareness of the file tree and code structure. Use them before reading, editing, or making changes.

## The Rule

**Never guess what exists.** Always check the workspace before acting. If you can't name what's affected, you don't understand the change well enough to make it.

## Tool Decision

| Need | Tool |
|------|------|
| Explore directory structure | workspace_map(path, depth) |
| Find files by pattern | glob_files(pattern) |
| Search file contents | search_contents(pattern, include) |
| Read file content | read_file(path, offset, limit) |

## workspace_map — When to Use

Explore the file tree without reading every file:

\`\`\`
workspace_map()           // Root overview
workspace_map(path: "src/", depth: 2)  // Nested structure
\`\`\`

Returns directory structure and file symbols. Use to orient yourself before reading specific files.

## glob_files — When to Use

Find files matching a pattern:

\`\`\`
glob_files("**/*.ts")           // All TypeScript files
glob_files("src/**/*.test.ts")  // All test files
glob_files("docs/**/*.md")      // All docs
\`\`\`

Narrow patterns reduce noise. Always narrow when possible.

## search_contents — When to Use

Find content inside files:

\`\`\`
search_contents("class.*Manager", path: "src/")
search_contents("TODO", include: "*.ts")
\`\`\`

Returns matching lines with file paths and line numbers. Use regex patterns.

## read_file — When to Use

Read actual file content. Always read before editing.

\`\`\`
read_file("src/main.ts")                    // Entire file
read_file("src/main.ts", offset: 50, limit: 20)  // Specific section
\`\`\`

Returns up to 1000 lines by default. For large files, use offset/limit for targeted reads.

## Key Constraints
- The workspace file tree is NOT in your context — you must use these tools
- File symbols from workspace_map are summaries — call read_file for real content
- search_contents returns line numbers — use them to understand context
- Never assume a file exists — verify with glob or workspace_map first`;

const SKILL_CONTEXT_BUDGET = `# Context Budget

Your context has four layers with ascending volatility. Understanding this determines what you can rely on across sessions vs. what disappears on compaction.

## The Layers

| Layer | Volatility | What's Stored | Survives Compaction? |
|-------|-----------|---------------|---------------------|
| Agent | Highest | Current turn state | No |
| Orbit | High | "now" plan descriptions, focused files | No |
| Drift | Medium | Plan summaries, skill summaries | Partial |
| Void | Lowest | Full file content, memories, skills | Yes |

## The Rule

**Drift files are summaries only.** Always call read_file(path, offset, limit) for real content before quoting or editing. Never assume a file's content is in your context.

## When to Compact

Compact when:
- You're running low on context budget
- The user explicitly asks
- A session has been running for a long time with many turns

Do NOT compact when:
- You're in the middle of a multi-step task
- Plans are actively being worked on
- The user is reviewing work

## Token Estimation

Before acting, estimate token cost:
- Reading a file: ~500 tokens per 100 lines
- Tool call arguments: ~100-200 tokens per call
- Inline content in tool calls: expensive — prefer scripts
- Large content (>50 lines): write to .voidrift/cache/ first

## Key Constraints
- "now" plan descriptions are auto-injected (Orbit layer)
- Memories are loaded on demand when keywords match (Void layer)
- Skills load via keyword/extension/file triggers (Void layer)
- File content must be read on demand — it's never assumed to be present
- .voidrift/cache/ is cheap — use it for intermediate artifacts`;

const SKILL_TASKS = `# Tasks

Tasks are reusable definitions that can be invoked repeatedly with different inputs. Use them for repetitive work patterns.

## When to Use Tasks
- You find yourself doing the same operation on multiple files
- A workflow has a fixed pattern but variable inputs
- You want to delegate repetitive work to agents without rewriting instructions

Do NOT use tasks for: one-off operations, decisions requiring judgment, work with variable outcomes.

## Workflow

### 1. Register a Task

Define the task once with a template:

\`\`\`
register_task(
  name: "validate-readme",
  description: "Validate README links and formatting",
  instruction: "Check {file} for broken links and proper formatting",
  output: "results.md",
  append: true
)
\`\`\`

Variables use {variable} syntax in the instruction template.

### 2. Invoke with Inputs

Run the task with specific variables:

\`\`\`
invoke_task(
  name: "validate-readme",
  vars: { file: "README.md" }
)
\`\`\`

Each invocation runs as an isolated subagent with its own context.

### 3. Results

Results are written to the output file (append or overwrite based on append flag).

## Key Constraints
- Tasks are registered once, invoked many times
- Each invocation is isolated — agents don't share context between invocations
- Output files accumulate results (use append: true for multiple invocations)
- Task names are lowercase-hyphenated slugs
- Variables are passed as JSON objects in vars`;

const SKILL_MODEL_ESCALATION = `# Model Escalation

A more capable model is available as a lifeline. You are the primary model — you handle all work. When stuck or facing something beyond your capacity, you can escalate.

## How It Works

- Call \`escalate(reason)\` → the harness swaps to the escalation model immediately (same turn, no approval needed)
- The escalation model calls \`deescalate()\` when done → control returns to you
- The model switch happens mid-turn — full context and tool results carry over

## Mechanical Enforcement

The harness enforces escalation in specific cases:
- **Plan creation is blocked on the primary model.** If you call \`add_plan\` while escalation is configured, the harness rejects it and tells you to escalate. The escalation model creates plans, you execute them.
- **2 consecutive failures trigger auto-escalation.** The harness swaps to the escalation model when you're stuck.

## When to Escalate

Call \`escalate\` when:
- Designing systems, structures, or workflows from scratch
- Complex analysis spanning multiple interconnected components
- Novel problem solving requiring exploration of multiple approaches
- You've failed the same approach twice — hand it off, don't retry

## When to Deescalate

Call \`deescalate\` when:
- Plan is created and execution begins
- Design decision made — remaining work is mechanical
- Analysis complete — findings documented, action items clear

## Key Constraints
- Only available when an escalation model is configured
- Escalation auto-approves — no user confirmation needed
- The escalation model should deescalate once reasoning is done — don't stay escalated for routine work
- After deescalating, you pick up with the full context from the escalated phase`;


const SKILL_ROUTINES = `# Routines

Routines are repeatable instructions that persist permanently. They never get consumed or marked complete — they're standing recipes you execute on demand.

## When to Create a Routine
- The user asks you to create a routine, recipe, or runbook
- A task pattern is repeating and the user wants to save it
- The user says "save this as a routine" or "make this repeatable"

Do NOT create routines for: one-off tasks, plans (use add_plan), or model-internal batch work (use register_task).

## How to Create

Write a markdown file to \`.voidrift/routines/<name>.md\` with this structure:

\`\`\`markdown
---
description: Short description of what this routine does
---

## Steps
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Done When
Clear verification criteria
\`\`\`

Use write_file to create the file. The name should be lowercase with hyphens (e.g. \`deploy-staging.md\`).

## Key Rules
- Routines live in \`.voidrift/routines/\` — always write there
- The frontmatter MUST have \`description:\`
- Steps should be concrete and verifiable
- "Done When" tells the executor how to verify success
- The user manages routines via \`/routines\` panel or \`/run routine <name>\`

## Execution
When a routine is executed (via \`/run routine <name>\`), the harness reads the file and passes the body to an autonomous execution loop. The steps are followed in order and verified at the end.

## What NOT to Do
- Don't use npm/npx/bun commands to "create" routines — just write the file
- Don't create shell scripts — routines are markdown instructions for the AI
- Don't put routines in \`.voidrift/plan/\` — that's for workflow plans
- Don't put routines in \`.voidrift/tasks/\` — that's for model batch templates`;
