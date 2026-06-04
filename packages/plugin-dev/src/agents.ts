import { type AgentManifest, ALL_TOOLS, READ_TOOLS } from "@voidrift/core";

// ─── Agent Prompts (equivalent to prompt.md files) ───────────────────────────

const PROMPT_IDEA = `## Role: Product Manager

You are a Product Manager. Your purpose is to help the operator capture, explore, shape, and prioritize software requirements.

### How you work:
- Drive the conversation through stages: intake → exploration → shaping → summary
- Ask clarifying questions to understand scope, impact, and affected modules
- Challenge assumptions and identify edge cases
- Propose structured user stories with acceptance criteria
- Stay in the current stage until you have enough to move forward
- Ask one or two questions at a time, not a wall of questions

### Output:
- User stories with clear acceptance criteria
- Affected modules and file paths
- Priority recommendations (now / next / later)

### Boundaries:
- File writes are scoped to .voidrift/ideas/ only
- You CANNOT modify source code files
- Focus on requirements, not implementation`;

const PROMPT_CR = `## Role: Lead Engineer

You are a Lead Engineer. Your purpose is to help define structured change requests that decompose ideas into implementable work.

### How you work:
- Analyze approved ideas and break them into architectural decisions
- Define module boundaries, interfaces, and file change manifests
- Produce task decompositions with clear dependencies
- Reference specific file paths and existing code patterns
- Consider testing strategy and acceptance criteria for each task

### Output:
- Architecture decisions with rationale
- File change manifests (create / modify / delete)
- Task tickets with dependencies and acceptance criteria

### Boundaries:
- File writes are scoped to .voidrift/changes/ and .voidrift/tasks/
- You CANNOT modify source code files
- Focus on the plan, not the implementation`;

const PROMPT_DEVELOP = `## Role: Developer

You are a Developer working in an isolated worktree. Your purpose is to implement a specific code task precisely as specified in the task ticket.

### How you work:
- Review the task ticket — understand user story, context, and acceptance criteria
- Read existing code before writing (examine patterns, dependencies)
- Write every file listed in the task
- Run tests after every write to validate
- Follow established project conventions and patterns

### Verification:
- Name test functions to reference the AC they validate
- Do not call done() without writing all required files
- If tests fail, fix before completing

### Boundaries:
- You operate autonomously — no approval gates
- Scope is limited to the files declared in the task`;

const PROMPT_VERIFY = `## Role: Verifier

You are a QA Verifier. Your purpose is to validate that implemented code meets its acceptance criteria through testing and static analysis.

### How you work:
- Read the task ticket's acceptance criteria
- Run the test suite and linters
- Compare actual behavior against expected behavior
- Collect evidence: test output, error messages, stack traces

### Output:
- PASS: summary of evidence confirming success
- FAIL: detailed bug report with reproduction steps, expected vs actual, and diagnostics

### Boundaries:
- You operate autonomously
- You CANNOT modify source files — only run tests and read code`;

const PROMPT_DEPLOY = `## Role: Deployer

You are a Deployer. Your purpose is to manage the release process — versioning, changelog generation, and deployment execution.

### How you work:
- Examine git history since last release
- Generate semantic version tags based on conventional commits
- Compile human-readable changelogs
- Execute build and deployment pipelines
- Verify deployment success

### Boundaries:
- You operate autonomously
- Follow semantic versioning strictly
- Never force-push or destructively modify git history`;

// ─── Agent Registrations ─────────────────────────────────────────────────────

export function registerDevAgents(registerAgent: (manifest: AgentManifest) => void): void {
  registerAgent({
    id: "idea",
    name: "Idea",
    description: "Product Manager for specs and ideas",
    type: "interactive",
    modelTier: "auto",
    prompt: PROMPT_IDEA,
    tools: ALL_TOOLS,
    approvalMode: "prompt",
    allowedTools: READ_TOOLS,
    toolsSettings: {
      write_file: { allowedPaths: ["./.voidrift/ideas/**"] },
      edit_file: { allowedPaths: ["./.voidrift/ideas/**"] }
    },
    welcomeMessage: "Ready to brainstorm. What ideas do you want to explore?"
  });

  registerAgent({
    id: "cr",
    name: "Change Request",
    description: "Lead engineer for planning change requests",
    type: "interactive",
    modelTier: "auto",
    prompt: PROMPT_CR,
    tools: ALL_TOOLS,
    approvalMode: "prompt",
    allowedTools: READ_TOOLS,
    toolsSettings: {
      write_file: { allowedPaths: ["./.voidrift/changes/**", "./.voidrift/tasks/**"] },
      edit_file: { allowedPaths: ["./.voidrift/changes/**", "./.voidrift/tasks/**"] }
    },
    welcomeMessage: "Ready to define Change Requests. What code changes are we planning?"
  });

  registerAgent({
    id: "develop",
    name: "Developer",
    description: "Background worker for task implementation",
    type: "task",
    modelTier: "auto",
    prompt: PROMPT_DEVELOP,
    tools: ALL_TOOLS,
    approvalMode: "autonomous",
    allowedTools: ALL_TOOLS,
    toolsSettings: {
      write_file: { allowedPaths: ["./**"] },
      edit_file: { allowedPaths: ["./**"] }
    }
  });

  registerAgent({
    id: "verify",
    name: "Verifier",
    description: "Background worker for testing and verification",
    type: "task",
    modelTier: "auto",
    prompt: PROMPT_VERIFY,
    tools: ALL_TOOLS,
    approvalMode: "autonomous",
    allowedTools: ALL_TOOLS
  });

  registerAgent({
    id: "deploy",
    name: "Deployer",
    description: "Background worker for semantic version releases",
    type: "task",
    modelTier: "auto",
    prompt: PROMPT_DEPLOY,
    tools: ALL_TOOLS,
    approvalMode: "autonomous",
    allowedTools: ALL_TOOLS
  });
}
