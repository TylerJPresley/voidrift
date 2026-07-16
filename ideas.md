# Ideas

Future enhancements that don't belong in core but could be plugins, extensions, or separate tools.

## Plugin Patterns (from Anthropic article)

### Composite Tools for Domains

Plugins should expose high-level operations, not raw API wrappers. Examples:

- **Deployment plugin**: `deploy(env)` that internally builds, pushes, deploys, verifies — not 5 separate tools the model has to chain
- **Testing plugin**: `run_tests(scope)` that runs, parses failures, and returns structured results — not just `execute_command("bun run test")`
- **Git workflow plugin**: `submit_pr(title, description)` that creates branch, commits, pushes, opens PR — one tool, one operation
- **Database plugin**: `query(sql)` that connects, executes, formats results — not connection management exposed to the model

The model should call one tool and get one meaningful result. If your plugin exposes steps, you've built an SDK, not a tool.

### Tool Namespacing via MCP

As users connect MCP servers, tool count grows (50-100+). The preflight classifier handles selection, but the on-demand TOC could group tools by server/domain for easier discovery:

```
## Workspace Tools
- read_file, write_file, edit_file, glob_files, ...

## Research Tools  
- web_search, web_fetch

## MCP: github
- mcp_github_create_pr, mcp_github_list_issues, ...

## MCP: jira
- mcp_jira_create_ticket, mcp_jira_assign, ...
```

This is a presentation concern in the on-demand TOC compiler, not a rename.

## Eval Framework (`@voidrift/eval`)

A separate package that uses `createCore()` to run tasks and measure agent performance.

### Why separate
- It's a consumer of the API, not part of it
- `createCore()` already provides full programmatic access
- Keeps the harness focused on execution, not measurement

### Architecture

```typescript
import { createCore } from "voidrift";
import { loadSuite, runTrial, grade } from "@voidrift/eval";

const core = await createCore({ workspaceRoot });
const suite = loadSuite("./evals/coding.yaml");

for (const task of suite.tasks) {
  const transcript = await runTrial(core, task);  // runs turn, captures messages
  const result = grade(transcript, task.graders); // deterministic + model-based
  report.add(task.id, result);
}

report.print(); // pass@k, error rates, token consumption
```

### Task Format (YAML)

```yaml
id: edit-file-basic
description: "Edit a single function in a TypeScript file"
setup:
  files:
    src/utils.ts: |
      export function add(a: number, b: number) { return a + b; }
input: "Rename the add function to sum"
graders:
  - type: deterministic
    check: file_contains
    path: src/utils.ts
    pattern: "function sum"
  - type: deterministic
    check: file_not_contains
    path: src/utils.ts
    pattern: "function add"
  - type: model
    rubric: "Did the agent rename the function without breaking anything else?"
metrics: [turns, tokens, tool_errors]
```

### Key Concepts (from Anthropic article)

- **pass@k**: success in at least 1 of k trials (capability ceiling)
- **pass^k**: success in ALL k trials (reliability)
- **Grader types**: deterministic (file checks, regex), model-based (rubric), human
- **Transcript capture**: full message array for debugging failures
- **Saturation tracking**: flag evals that hit 100% (no longer useful)
- **Regression vs capability**: separate suites for "don't break" vs "can it do this"

### What VoidRift provides for this

- `createCore()` — programmatic access to the full agent
- `core.session.execute()` — run a turn with streaming
- `core.session.messages()` — get transcript after execution
- Event bus — capture tool calls, errors, timing
- InMemory repositories — isolated test environments

## Domain Skill Packs

Publishable skill collections for specific domains:

- `@voidrift/skills-react` — component patterns, hooks, testing
- `@voidrift/skills-devops` — Docker, CI/CD, infrastructure
- `@voidrift/skills-research` — literature review, citation, synthesis
- `@voidrift/skills-writing` — technical writing, documentation, editing

Each is an npm package that registers skills via the plugin API.

## Computational Sensors (Post-Execution Validation)

Lightweight, deterministic checks that run after tool execution — no LLM judgment needed.

Examples:
- After `edit_file` on a .ts file → run `tsc --noEmit` to verify it still parses
- After `edit_file` on a .py file → run `python -c "import ast; ast.parse(open('file').read())"`
- After `write_file` on JSON → verify `JSON.parse()` succeeds
- After any write → verify file changed against plan's declared `scope.write` — flag out-of-scope edits

Implementation: guardrail plugin that subscribes to `AFTER_TOOL_EXECUTE` and runs validation. Injects warnings back into the model's context if something breaks.

This is a coding-specific feature — belongs in a plugin like `@voidrift/plugin-dev`, not core.


## LLM-as-Judge (Post-Execution Review)

A separate model call that evaluates the agent's output against the original spec/plan after a task completes.

### How it works
1. Agent finishes a turn (writes files, runs commands)
2. Utility-tier model receives: original request + plan + diff of changes
3. Returns structured verdict: pass / fail / concerns
4. If flagged, feedback is injected back — agent can self-correct

### Where it makes sense
- `/goal` mode — long autonomous loops with no human review
- Subagent outputs — review before merge into main worktree
- Plan completion — "all tasks checked, but does the result actually meet Done When?"

### Where it doesn't
- Chat mode — user is already the judge (sees every change)
- Vibe mode — users want speed, not extra review steps
- Simple single-file edits — overhead isn't justified

### Concerns
- Shared blind spots: same architecture judging itself often misses the same errors
- Latency: adds a model call to every turn even when nothing's wrong
- False positives: judge flags correct work → agent "fixes" it → now broken
- Cost: utility tier is cheap (~200 tokens in, ~50 out) but adds up over many turns

### Implementation
Optional guardrail registered via plugin. Subscribes to `TURN_AFTER`, runs only in goal/subagent contexts. Configurable: off by default, enable per-agent or per-plan.


## Team Readiness

Features that make VoidRift viable for multi-developer teams, not just personal use.

### Sensitive-Path Gates
Detect edits to high-risk paths (auth, secrets, dependencies, production config) and escalate approval. Could be policy rules per-project:
```json
"policies": [
  { "tool": "write_file", "pattern": "src/auth/**", "decision": "ask", "label": "Auth module — requires explicit approval" },
  { "tool": "write_file", "pattern": ".env*", "decision": "deny", "label": "Never write secrets" },
  { "tool": "write_file", "pattern": "package.json", "decision": "ask", "label": "Dependency changes require review" }
]
```
The mechanism exists (policy engine + pattern matching). Just needs documented patterns and possibly a `/policy init` command that scaffolds common rules for a project type.

### Directory Ownership
Declare which agents/teams own which paths. Edits outside owned scope require cross-owner approval. Could be a `CODEOWNERS`-style file in `.voidrift/`:
```
src/auth/       @security-team
src/api/        @backend-team
infrastructure/ @platform-team
```
Enforcement via the permission gate — if the active agent doesn't match the owner, escalate.

### Verification Hooks (Plugin)
Post-edit verification as a plugin (`@voidrift/plugin-dev` or per-project):
- After `.ts` edit → `tsc --noEmit`
- After `.py` edit → `python -m py_compile`
- After test file changes → run affected test suite
- After `package.json` change → verify lockfile consistency

Implementation: guardrail plugin subscribing to `AFTER_TOOL_EXECUTE` for write/edit tools. Runs the check, injects result back into context. Not core — domain-specific.

### Evidence Summary
After a multi-step Change Workflow completes, auto-generate:
- Files changed (with diff stats)
- Commands run and their exit codes
- Tests passed/failed
- Risks identified
- Suggested reviewers (from ownership)

Could be a `/summary` command or auto-generated when a plan completes.

### Harness Metrics
Track delivery quality over time:
- First-pass success rate (did the change work without retries?)
- Rework rate (how often does the model redo work after feedback?)
- Tool failure rate (which tools cause the most errors?)
- Average turns per task

`/stats` already tracks some of this per-session. Persisting across sessions and surfacing trends would make it useful for teams.

### Automatic Continuation Checkpoints
After each turn, write a machine-readable checkpoint:
```json
{ "goal": "...", "status": "in-progress", "filesModified": [...], "lastAction": "...", "nextStep": "..." }
```
On session resume, load the checkpoint instead of replaying history. Enables seamless handoffs between team members or between sessions.


## Feedback Sensors Plugin (`@voidrift/plugin-verify`)

Domain-specific verification that runs automatically after tool execution. The harness provides the hooks — the plugin provides the policy.

### How It Works
Subscribes to `AFTER_TOOL_EXECUTE` for write/edit tools. Based on file extension and project config, runs the appropriate verification command. Injects results back into model context via guardrail advisory. Model self-corrects if something breaks.

### Sensor Types

**Computational (fast, deterministic):**
- `.ts`/`.tsx` edit → `tsc --noEmit` (type check)
- `.py` edit → `python -m py_compile` (syntax check)
- `.rs` edit → `cargo check` (compile check)
- `package.json` edit → verify lockfile consistency
- Any edit → run project linter if configured
- Test file edit → run affected test suite

**Inferential (slower, semantic):**
- Multi-file change → lightweight LLM review ("does this follow project conventions?")
- Large function → "this function is now 200 lines, consider splitting"
- New dependency → "is this dependency actively maintained?"

### Configuration
Per-project `.voidrift/config.json`:
```json
"verify": {
  "afterEdit": {
    "*.ts": "npx tsc --noEmit",
    "*.py": "python -m py_compile {file}",
    "*.test.*": "bun run test {file}"
  },
  "afterWrite": {
    "package.json": "bun install --dry-run"
  }
}
```

### Steering Loop Integration
When a sensor fires and the model self-corrects successfully:
1. TraceAnalyzer records the pattern
2. After N occurrences, suggests a skill/memory: "You keep forgetting to handle null returns. Save this as a rule?"
3. Intelligence compounds — the feedforward improves based on feedback.

### Why Plugin, Not Core
VoidRift is domain-neutral. Running `tsc` is a TypeScript decision. Running `cargo check` is a Rust decision. The harness provides `AFTER_TOOL_EXECUTE` + guardrail injection. The plugin decides what to run.


## Prompt Injection Defense Plugin (`@voidrift/plugin-defender`)

Protects against indirect prompt injection — malicious content in tool results (MCP responses, web fetches, file reads) that tries to hijack the model into taking unintended actions.

### Library
`@stackone/defender` — TypeScript native, Apache 2.0, one dependency (nanoid), 22MB ONNX model bundled, ~10ms latency, CPU-only, 90.8% F1 score. Designed specifically for AI tool-calling defense.

### Integration
Plugin registers a guardrail via `core.register.guardrail()`. Scans every tool result before it enters the model's context.

```typescript
import { createPromptDefense } from '@stackone/defender';

export function register(core) {
  const defense = createPromptDefense({ blockHighRisk: true });

  core.register.guardrail(async (tool, args, ctx) => {
    // Only scan external data sources
    if (!['web_fetch', 'read_file', 'execute_command'].includes(tool)) return null;
    // Scan happens after execution — the result is in ctx
    return null; // Guardrails fire pre-execution; need AFTER_TOOL hook instead
  });

  // Better: subscribe to AFTER_TOOL_EXECUTE and sanitize before context injection
  core.events.subscribe('AFTER_TOOL_EXECUTE', async (event) => {
    if (event.payload.status !== 'success') return;
    const result = await defense.defendToolResult(event.payload.output, event.payload.toolName);
    if (!result.allowed) {
      // Emit warning — model will see advisory in next turn
      core.events.emit('WARNING_EMITTED', {
        message: `⚠️ Injection detected in ${event.payload.toolName} output: ${result.detections.join(', ')}`,
        source: 'defender',
        category: 'block',
      });
    }
  });
}
```

### Behavior by Mode
- **Chat mode** — flag and show warning to user, let them decide
- **Vibe mode** — block the content, inject sanitized version into context
- **Goal mode** — block and log, continue with sanitized content

### Why Plugin, Not Core
- 22MB dependency — not everyone needs it
- Opt-in security matches VoidRift's philosophy (user controls everything)
- Can be replaced with a different defense library without touching core
- Some users work in trusted environments (local files only, no MCP, no web)

