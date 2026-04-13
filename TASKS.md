# Follow-Up Tasks

Improvements identified during the 2026-04-09 through 2026-04-12 development session. These apply START.md's principles to VoidRift's own command pipeline — the framework should scrutinize the projects it builds with the same rigor the operator applies to the framework itself.

Tasks are ordered by dependency — complete them in sequence.

---

## TASK-F1: Task-scoped ACs decomposed from requirement ACs

**Status:** ✅ Complete (REQ-P-16)

**Problem:** Tasks currently carry ACs that are either too vague ("environment variable substitution works") or copied verbatim from requirements ("the system shall display weather data"). Task ACs should be scoped to what that specific task does — independently verifiable, collectively covering the requirement. This is the foundation — every other improvement depends on tasks having proper ACs.

**What this changes:**
- The PLAN-TASK prompt explicitly instructs: "Write acceptance criteria scoped to this task only. Each AC must be verifiable by examining only the files this task produces. The requirement-level AC is verified by `voidrift verify` — the task AC is verified by the develop agent."
- The task template format section is updated to reinforce: "ACs are observable behaviors of the code this task writes, not the system as a whole."
- Example in the prompt: Requirement says "display weather with temperature, conditions, alerts." Task for the API client says "returns a dict with `temp` (float), `conditions` (str), `alerts` (list[str]) fields." Task for the endpoint says "GET /api/weather returns 200 with `{temp, conditions, alerts}` schema." Each is independently testable.

**Affected components:**
- `resources/prompts/plan.md` — PLAN-TASK prompt and template format section

**Design constraint:** Prompt-layer change only. No code changes. The quality of task ACs depends on the plan model's ability to decompose — stronger models will produce better decompositions.

---

## TASK-F2: Develop agent self-review against ACs

**Status:** ✅ Complete (REQ-D-22)

**What was done:** After the agent writes its first file, a one-time steering message is injected asking it to re-read each AC, confirm satisfaction, and score confidence 0–100%. Below 90% triggers self-correction before calling done.

---

## TASK-F3: Develop reads before writing

**Status:** ✅ Complete (REQ-D-23)
**Depends on:** F1 (better ACs give the agent clearer targets when reading existing code)

**Problem:** The develop agent reads the task and starts writing immediately. It doesn't understand what code already exists, what patterns are established, or how its changes fit into the existing codebase. This leads to inconsistencies — new code that doesn't follow established patterns, duplicate functionality, or conflicts with existing files.

**What this changes:**
- Update the develop TASK prompt to add a step between "review the task" and "write files": "Read the existing files listed in the task's `depends` and any files in the same directory as your target files. Understand the established patterns before writing."
- This is a prompt-layer change. The agent already has `read_source_file` in its tool set. The prompt currently says "Use `read_source_file()` to examine existing project code as needed" — but "as needed" is too weak. The instruction should be directive: read first, then write.

**Affected components:**
- `resources/prompts/develop.md` — TASK section step ordering

**Design constraint:** Keep it to reading files in the immediate scope — not the entire project. The agent should read files it depends on and files adjacent to its targets, not do a full codebase survey.

---

## TASK-F4: Plan traceability — tasks carry REQ references

**Status:** ✅ Complete (REQ-P-17)
**Depends on:** F1 (task ACs must trace to requirements for traceability to be meaningful)

**Problem:** There's no traceability from requirements to tasks to code. If a requirement is missed during task generation, nobody notices until verify or the operator catches it. Plan generates tasks from architecture, but the link back to specific requirements is implicit.

**What this changes:**
- Tasks carry a `reqs:` field in frontmatter listing the requirement IDs the task's ACs satisfy.
- The `reqs:` field is metadata for traceability. It is NOT injected into the develop agent's context — the develop agent only sees the task ACs.
- Plan's post-generation verification uses the `reqs:` field to check coverage — every REQ ID in REQUIREMENTS.md should appear in at least one task's `reqs:` list. Uncovered REQs are reported as warnings.

**Affected components:**
- `resources/prompts/plan.md` — PLAN-TASK template adds `reqs:` to frontmatter format
- `cli/src/voidrift_cli/commands/plan.py` — post-generation coverage verification
- `cli/src/voidrift_cli/manifest.py` — manifest schema accepts `reqs` field

**Design constraint:** The `reqs:` field is populated by the task-writing agent from what it already sees in the module arch. No additional context is injected. The coverage check is a warning, not a blocker.

---

## TASK-F5: Per-stage verification in each command

**Status:** ✅ Complete (REQ-D-21 develop file check, REQ-P-17 plan coverage, REQ-G-22 gather triage coverage)
**Depends on:** F1 (plan coverage check needs good task ACs), F4 (plan coverage check uses `reqs:` field)

**Problem:** Verification only happens at the end via `voidrift verify`. Plan doesn't check that its tasks cover all requirements. Errors compound through the pipeline and are only caught at integration time — or by the operator.

**What remains:**
- **Plan:** After generating all tasks, a verification pass checks that every requirement in REQUIREMENTS.md has at least one task covering it (via `reqs:` field from F4). Missing coverage is reported as a warning.
- **Gather:** After consolidation, verify that every source file categorized in triage appears in ANALYSIS.md. Missing entries are logged.
- **Develop file list check:** ✅ Already done (REQ-D-21).

**Affected components:**
- `cli/src/voidrift_cli/commands/plan.py` — post-task-generation verification pass
- `cli/src/voidrift_cli/commands/gather.py` — post-consolidation coverage check

**Design constraint:** These are warnings, not blockers. The operator decides whether to act on them. No approval gates in automated commands.

---

## TASK-F6: Documentation verification in verify command

**Status:** ✅ Complete (REQ-VF-17)

**Problem:** Plan generates README. Develop changes interfaces, endpoints, configuration — but never updates the README. By the time all tasks complete, the README is stale. The operator has to manually reconcile documentation with the actual implementation.

**Revised approach:** Instead of giving develop write access to framework files, verify catches stale documentation. A new Stage 0 in verify checks that documented endpoints, environment variables, and configuration keys match the actual source code. Stale docs become bug reports — same as test failures.

**What this changes:**
- Add a documentation verification stage as the first stage of `voidrift verify`, before the current test planning stage.
- The stage reads README.md and ARCHITECTURE.md, reads the source code, and checks for mismatches: documented endpoints vs implemented endpoints, documented env vars vs env vars referenced in code, documented config keys vs config schema.
- Mismatches are reported as bug reports in `.voidrift/bugs/` — same format as test failures.
- The operator fixes stale docs via `voidrift chat` (which already has `write_framework_file`).

**Affected components:**
- `cli/src/voidrift_cli/commands/verify.py` — new Stage 0 before existing Stage 1
- `resources/prompts/verify.md` — new prompt section for documentation verification

**Design constraint:** This is an agent-based check, not a code-level parser. The verify agent reads docs and source code and identifies mismatches. It uses the same sub-agent pattern as the existing test case execution. The develop command boundary is preserved — develop never writes to `.voidrift/`.

---

## TASK-F7: Chat diagnose-before-acting prompt

**Status:** ✅ Complete (REQ-U-24)

**Problem:** The chat agent jumps to action without understanding the request. "Let's look at the verify result" triggers file writes instead of reading VERIFY.md. The agent interprets intent and acts on it in the same turn, often incorrectly. START.md step 1: "Trace the root cause. Understand the full impact before proposing anything."

**What this changes:**
- Update the chat system prompt (`resources/prompts/chat.md`) to instruct the model: before making any changes, read the relevant files and understand the current state. Do not write, edit, or run commands until you understand what the operator is asking and have confirmed your understanding.
- The instruction should be in the CHAT-ROLE section of `system.md` or the chat-specific prompt, reinforcing the existing "do not infer write intent" rule with a positive instruction: read first, understand, then propose.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. The model should still be able to act quickly on clear, direct requests ("write a function that does X"). The instruction targets ambiguous requests where the model needs to gather context before acting.

---

## TASK-F8: Chat propose-before-writing

**Status:** ✅ Complete (REQ-U-25)
**Depends on:** F7 (diagnose comes before propose)

**Problem:** The chat agent goes straight from understanding to executing. It decides what to do and does it — the operator only finds out what happened after the fact (or via permission prompts that show tool names without context). START.md step 2: "Present a high-confidence solution — what changes, where, and why. Wait for approval."

**What this changes:**
- Update the chat system prompt to instruct: before writing or editing files, tell the operator what you plan to change and why. List the files, describe the changes, and wait for confirmation. Only proceed after the operator approves.
- This complements the permission gate (REQ-U-22) — the gate asks "allow this tool call?" while the proposal asks "is this the right approach?" The proposal happens before any tool calls are attempted.
- For simple, unambiguous requests ("add a docstring to this function"), the model can act directly. The proposal step is for multi-file changes, architectural decisions, or ambiguous requests.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. Must not slow down simple requests. The model should use judgment about when a proposal is needed — single-file edits with clear intent don't need a proposal; multi-file changes or ambiguous requests do.

---

## TASK-F9: Chat post-action summary

**Status:** ✅ Complete (REQ-U-26)

**Problem:** After the model executes tool calls, the operator often gets no summary of what happened. The model writes 3 files, edits 2 more, and returns empty text or a vague response. The operator has to check git diff to understand what changed. START.md step 12: "Files changed, ACs satisfied, open questions."

**What this changes:**
- Update the chat system prompt to instruct: after completing any tool calls that modify files or run commands, provide a summary listing what was done — files created, files modified, commands run, and their outcomes. If anything failed or was unexpected, note it.
- This is a prompt instruction, not a structural enforcement. The empty response fallback (REQ-UI-14) catches the case where the model says nothing at all, but this addresses the case where the model responds with vague text instead of a concrete summary.

**Affected components:**
- `resources/prompts/chat.md` or `resources/prompts/system.md` (CHAT-ROLE section)

**Design constraint:** Prompt-layer only. The summary should be concise — a bullet list of changes, not a narrative. The model should not repeat file contents in the summary.

---

## TASK-F10: Add delete_source_file tool to develop

**Status:** ✅ Complete (REQ-D-24)

**Problem:** The develop agent can create and modify files but cannot delete them. When requirements change in a later run and a file is no longer needed — a module removed, a file replaced, direction changed — the agent has no way to clean up. Dead files accumulate and confuse future agents and operators.

**What this changes:**
- Add `delete_source_file(path)` tool to the develop agent's tool set.
- The tool deletes a file within the project root, subject to the same path sandboxing as `write_source_file` (REQ-SEC-1) and `protected_paths` checks.
- The tool logs the deletion and records it in the snapshot system for rollback (REQ-D-15) — if the task fails, deleted files are restored from the snapshot.
- Task frontmatter `files:` field supports `(delete)` annotation: `- backend/old_module.py (delete)`.
- The file list verification (REQ-D-21) includes `(delete)` — warns if a file annotated for deletion still exists after the task completes.

**Affected components:**
- `cli/src/voidrift_cli/tools/filesystem.py` — new `delete_source_file` handler
- `cli/src/voidrift_cli/tools/registry.py` — tool schema for `delete_source_file`
- `cli/src/voidrift_cli/commands/develop.py` — add to `AGENT_TOOLS`, snapshot integration
- `resources/prompts/develop.md` — mention deletion in the steps
- `resources/prompts/plan.md` — PLAN-TASK template documents `(delete)` annotation

**Design constraint:** Deletion is sandboxed to the project root. Protected paths cannot be deleted. Snapshots must capture the original file content before deletion for rollback. The tool should refuse to delete directories — files only.
