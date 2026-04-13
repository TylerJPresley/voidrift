# Follow-Up Tasks

Improvements identified during the 2026-04-09 through 2026-04-12 development session. These apply START.md's principles to VoidRift's own command pipeline — the framework should scrutinize the projects it builds with the same rigor the operator applies to the framework itself.

---

## TASK-F1: Per-stage verification in each command

**Problem:** Verification only happens at the end via `voidrift verify`. Plan doesn't check that its tasks cover all requirements. Develop doesn't check that its code satisfies the task ACs. Errors compound through the pipeline and are only caught at integration time — or by the operator.

**What this changes:**
- **Plan:** After generating all tasks, a verification pass checks that every requirement in REQUIREMENTS.md has at least one task with ACs that trace to it. Missing coverage is reported as a warning with the uncovered REQ IDs.
- **Develop:** After each task completes (files written, before marking implemented), a lightweight check confirms the written files match the `files:` list in the task frontmatter. Missing files trigger a warning.
- **Gather:** After consolidation, verify that every source file categorized in triage appears in ANALYSIS.md. Missing entries are logged.

**Affected components:**
- `cli/src/voidrift_cli/commands/plan.py` — post-task-generation verification pass
- `cli/src/voidrift_cli/commands/develop.py` — post-task file list check in `_run_task`
- `cli/src/voidrift_cli/commands/gather.py` — post-consolidation coverage check

**Design constraint:** These are warnings, not blockers. The operator decides whether to act on them. No approval gates in automated commands.

---

## TASK-F2: Develop agent self-review against ACs

**Problem:** The develop agent writes code and calls `done` without ever re-reading the acceptance criteria. It satisfies what it remembers from the initial read, which may be incomplete or misinterpreted. The env.list problem (4 vars instead of 8) is a direct result — the agent wrote code that "worked" but didn't satisfy the full AC.

**What this changes:**
- After the develop agent writes all files and before calling `done`, inject a steering message: "Re-read the acceptance criteria in the task. For each AC, confirm the code you wrote satisfies it. If any AC is not satisfied, fix it now."
- This uses the existing `get_steering_messages` hook on the AgentLoop. The hook fires after each tool round. When the agent has written at least one file, inject the self-review prompt once.
- The self-review is a prompt injection, not a structural check. The agent may still miss things, but it gets a second pass at the ACs with the written code fresh in context.

**Affected components:**
- `cli/src/voidrift_cli/commands/develop.py` — `get_steering_messages` hook in `_run_task`

**Design constraint:** One injection per task. Must not trigger on every tool round — only after writes have occurred and before the agent exits. Use a flag similar to `_write_nudge_count`.

---

## TASK-F3: Plan traceability — tasks carry REQ references

**Problem:** There's no traceability from requirements to tasks to code. If a requirement is missed during task generation, nobody notices until verify or the operator catches it. Plan generates tasks from architecture, but the link back to specific requirements is implicit.

**What this changes:**
- Task frontmatter gets a `reqs:` field listing the requirement IDs the task covers (e.g. `reqs: [REQ-WX-1, REQ-WX-2]`).
- The PLAN-TASK prompt instructs the task-writing agent to include `reqs:` based on which requirements from REQUIREMENTS.md the task's ACs trace to.
- Plan's post-generation verification (TASK-F1) uses the `reqs:` field to check coverage — every REQ ID in REQUIREMENTS.md should appear in at least one task's `reqs:` list.
- The `reqs:` field is metadata for traceability. It is NOT injected into the develop agent's context — the develop agent only sees the task ACs.

**Affected components:**
- `resources/prompts/plan.md` — PLAN-TASK template adds `reqs:` to frontmatter format
- `cli/src/voidrift_cli/commands/plan.py` — coverage verification reads `reqs:` fields
- `cli/src/voidrift_cli/manifest.py` — manifest schema accepts `reqs` field

**Depends on:** TASK-F1 (the verification pass that consumes the traceability data)

---

## TASK-F4: Develop reads before writing

**Problem:** The develop agent reads the task and starts writing immediately. It doesn't understand what code already exists, what patterns are established, or how its changes fit into the existing codebase. This leads to inconsistencies — new code that doesn't follow established patterns, duplicate functionality, or conflicts with existing files.

**What this changes:**
- Update the develop TASK prompt to add a step between "review the task" and "write files": "Read the existing files listed in the task's `depends` and any files in the same directory as your target files. Understand the established patterns before writing."
- This is a prompt-layer change. The agent already has `read_source_file` in its tool set. The prompt currently says "Use `read_source_file()` to examine existing project code as needed" — but "as needed" is too weak. The instruction should be directive: read first, then write.

**Affected components:**
- `resources/prompts/develop.md` — TASK section step ordering

**Design constraint:** Keep it to reading files in the immediate scope — not the entire project. The agent should read files it depends on and files adjacent to its targets, not do a full codebase survey.

---

## TASK-F5: Documentation as a develop deliverable

**Problem:** Plan generates a README. Develop changes interfaces, adds endpoints, modifies configuration — but never updates the README. By the time all tasks complete, the README is stale. The operator has to manually reconcile documentation with the actual implementation.

**What this changes:**
- Tasks that create or modify user-facing interfaces (API endpoints, CLI commands, configuration keys, environment variables) include `readme_update: true` in frontmatter.
- The PLAN-TASK prompt instructs the task-writing agent to set this flag when the task affects user-facing behavior.
- When `readme_update: true`, the develop agent's system prompt includes an additional instruction: "After implementing the task, update README.md to reflect any changes to endpoints, configuration, environment variables, or usage instructions."
- The develop agent gets `write_framework_file` access (already in AGENT_TOOLS via `read_framework_file` — need to check if write is included for `.voidrift/README.md`).

**Affected components:**
- `resources/prompts/plan.md` — PLAN-TASK template adds `readme_update` to frontmatter
- `resources/prompts/develop.md` — conditional README update instruction
- `cli/src/voidrift_cli/commands/develop.py` — read `readme_update` from frontmatter, inject instruction

**Design constraint:** The README lives in `.voidrift/README.md`. The develop agent already has `read_framework_file`. It needs `write_framework_file` to update it — verify this is in the develop tool set. If not, add it scoped to README.md only.

---

## TASK-F6: Task-scoped ACs decomposed from requirement ACs

**Problem:** Tasks currently carry ACs that are either too vague ("environment variable substitution works") or copied verbatim from requirements ("the system shall display weather data"). Task ACs should be scoped to what that specific task does — independently verifiable, collectively covering the requirement.

**What this changes:**
- The PLAN-TASK prompt explicitly instructs: "Write acceptance criteria scoped to this task only. Each AC must be verifiable by examining only the files this task produces. The requirement-level AC is verified by `voidrift verify` — the task AC is verified by the develop agent."
- The task template format section is updated to reinforce: "ACs are observable behaviors of the code this task writes, not the system as a whole."
- Example in the prompt: Requirement says "display weather with temperature, conditions, alerts." Task for the API client says "returns a dict with `temp` (float), `conditions` (str), `alerts` (list[str]) fields." Task for the endpoint says "GET /api/weather returns 200 with `{temp, conditions, alerts}` schema." Each is independently testable.

**Affected components:**
- `resources/prompts/plan.md` — PLAN-TASK prompt and template format section

**Design constraint:** This is a prompt-layer change only. No code changes. The quality of task ACs depends on the plan model's ability to decompose — stronger models will produce better decompositions.


---

## TASK-F7: Add delete_source_file tool to develop

**Problem:** The develop agent can create and modify files but cannot delete them. When requirements change in a later run and a file is no longer needed — a module removed, a file replaced, direction changed — the agent has no way to clean up. Dead files accumulate and confuse future agents and operators.

**What this changes:**
- Add `delete_source_file(path)` tool to the develop agent's tool set.
- The tool deletes a file within the project root, subject to the same path sandboxing as `write_source_file` (REQ-SEC-1) and `protected_paths` checks.
- The tool logs the deletion and records it in the snapshot system for rollback (REQ-D-15) — if the task fails, deleted files are restored from the snapshot.
- Task frontmatter `files:` field supports `(delete)` annotation: `- backend/old_module.py (delete)`.
- The file list verification (TASK-F1 develop check) includes `(delete)` — warns if a file annotated for deletion still exists after the task completes.

**Affected components:**
- `cli/src/voidrift_cli/tools/filesystem.py` — new `delete_source_file` handler
- `cli/src/voidrift_cli/tools/registry.py` — tool schema for `delete_source_file`
- `cli/src/voidrift_cli/commands/develop.py` — add to `AGENT_TOOLS`, snapshot integration
- `resources/prompts/develop.md` — mention deletion in the steps
- `resources/prompts/plan.md` — PLAN-TASK template documents `(delete)` annotation

**Design constraint:** Deletion is sandboxed to the project root. Protected paths cannot be deleted. Snapshots must capture the original file content before deletion for rollback. The tool should refuse to delete directories — files only.

**Depends on:** None (can be done independently, but the verification check from TASK-F1 should be updated to handle `(delete)` once this ships).


---

## TASK-F8: Chat diagnose-before-acting prompt

**Problem:** The chat agent jumps to action without understanding the request. "Let's look at the verify result" triggers file writes instead of reading VERIFY.md. The agent interprets intent and acts on it in the same turn, often incorrectly. START.md step 1: "Trace the root cause. Understand the full impact before proposing anything."

**What this changes:**
- Update the chat system prompt (`resources/prompts/chat.md`) to instruct the model: before making any changes, read the relevant files and understand the current state. Do not write, edit, or run commands until you understand what the operator is asking and have confirmed your understanding.
- The instruction should be in the CHAT-ROLE section of `system.md` or the chat-specific prompt, reinforcing the existing "do not infer write intent" rule with a positive instruction: read first, understand, then propose.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. The model should still be able to act quickly on clear, direct requests ("write a function that does X"). The instruction targets ambiguous requests where the model needs to gather context before acting.

---

## TASK-F9: Chat propose-before-writing

**Problem:** The chat agent goes straight from understanding to executing. It decides what to do and does it — the operator only finds out what happened after the fact (or via permission prompts that show tool names without context). START.md step 2: "Present a high-confidence solution — what changes, where, and why. Wait for approval."

**What this changes:**
- Update the chat system prompt to instruct: before writing or editing files, tell the operator what you plan to change and why. List the files, describe the changes, and wait for confirmation. Only proceed after the operator approves.
- This complements the permission gate (REQ-U-22) — the gate asks "allow this tool call?" while the proposal asks "is this the right approach?" The proposal happens before any tool calls are attempted.
- For simple, unambiguous requests ("add a docstring to this function"), the model can act directly. The proposal step is for multi-file changes, architectural decisions, or ambiguous requests.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. Must not slow down simple requests. The model should use judgment about when a proposal is needed — single-file edits with clear intent don't need a proposal; multi-file changes or ambiguous requests do.

---

## TASK-F10: Chat post-action summary

**Problem:** After the model executes tool calls, the operator often gets no summary of what happened. The model writes 3 files, edits 2 more, and returns empty text or a vague response. The operator has to check git diff to understand what changed. START.md step 12: "Files changed, ACs satisfied, open questions."

**What this changes:**
- Update the chat system prompt to instruct: after completing any tool calls that modify files or run commands, provide a summary listing what was done — files created, files modified, commands run, and their outcomes. If anything failed or was unexpected, note it.
- This is a prompt instruction, not a structural enforcement. The empty response fallback (REQ-UI-14) catches the case where the model says nothing at all, but this addresses the case where the model responds with vague text instead of a concrete summary.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. The summary should be concise — a bullet list of changes, not a narrative. The model should not repeat file contents in the summary.
