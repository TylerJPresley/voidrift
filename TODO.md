# TODO — Backlog

Work items that need doing. Grouped by area, ordered by priority within each group.

---

## Task System — Orphaned References

The task system was rewritten (ManifestManager + task files) but several requirements and docs still reference the old TASKS.md/TASKS-DONE.md/TaskStore patterns.

- [x] **REQ-P-5** — replaced with pointer to REQ-TM-4.
- [x] **REQ-P-11** — rewritten to reference manifest.yml and task files.
- [x] **REQ-D-14 verification entries** — V-D-10 and V-D-13 now point to test_manifest.py.
- [x] **ARCHITECTURE.md verify section** — updated to reference manifest.yml.
- [x] **Appendix A** — updated with tasks/, ideas/, manifest.yml, history.log.

---

## Task System — Unvalidated Code Paths

Code exists but hasn't been tested against a real model or with integration tests.

- [ ] **Architect consultation on failure** — `_consult_architect()` is wired into `_run_task()` failure path in develop.py. When a task produces no writes after retry, it calls the architect, appends the fix plan to the task file, and re-queues as `planned`. No test covers this full path. The retry test (`test_no_writes_triggers_retry`) only tests the retry, not the escalation. Need a test where retry also fails and architect is consulted. Location: `cli/src/voidrift_cli/commands/develop.py` lines ~318-330, test in `cli/tests/test_commands.py` class `TestDevelopRetryEscalation`.

- [ ] **Bug creation from verify** — `ManifestManager.add_bug()` exists and is tested (test_manifest.py), but the verify command doesn't call it yet. When verify fails a task's ACs, it should create a BUG-{id}.md and link it via manifest refs. Location: `cli/src/voidrift_cli/commands/verify.py`, REQ-TM-7.

- [ ] **Task archival flow** — `ManifestManager.archive()` moves verified tasks to `archived/`, removes from manifest, appends to history.log. Tested in test_manifest.py. But nothing in the codebase calls `archive()` yet — there's no trigger after verify marks a task as verified. Need to wire this into the verify or develop post-processing. Location: `cli/src/voidrift_cli/manifest.py` method `archive()`.

---

## Idea System — Unvalidated

The `/idea` and `/done` handlers are wired into the chat loop in main.py but have never been run.

- [ ] **`/idea` new flow** — Creates IDEA-{id}.md, injects IDEA prompt overlay into agent system prompt, sends initial message. The handler exists at `_handle_idea()` in main.py (~line 540). The IDEA prompt section exists in `resources/prompts/chat.md`. ManifestManager.add_idea() works (6 tests). But the full flow hasn't been validated — the agent receiving the overlay and driving the 4-stage conversation is untested. Risk: the overlay injection mutates `agent.messages[0]["content"]` which may not persist correctly across turns.

- [ ] **`/idea <id>` load flow** — Reads existing idea file, injects content + overlay, asks agent to summarize. Same handler, different branch. Risk: if the idea file is large, injecting it into the system prompt may consume significant context.

- [ ] **`/done` flow** — Asks operator for now/next/later category via prompt_toolkit, then asks the agent to write the final idea file via write_framework_file. The `_finish_idea()` handler exists but: (1) it uses `prompt_toolkit.prompt()` which may conflict with the existing PromptSession, (2) it sends a message to the agent but doesn't actually trigger `agent.send()` — it just appends to messages, so the agent never executes the write. This is a bug. Location: main.py `_finish_idea()` ~line 560.

---

## Plan Command — Task File Generation

- [ ] **`_build_task_files()` is fragile** — It uses TaskStore to parse TASKS.md, then creates task files from the parsed data. But TaskStore was designed for the old format and may not handle all edge cases the model produces (multi-line descriptions, nested code blocks in task text, etc.). The function also doesn't extract dependencies from task text — all tasks get `depends: []`. Plan's stage 2 prompt should instruct the model to specify dependencies, and `_build_task_files()` should parse them. Location: `cli/src/voidrift_cli/commands/plan.py` function `_build_task_files()`.

- [ ] **Plan prompt doesn't know about task files** — The plan stage 2 prompt (`resources/prompts/plan.md` PLAN-TASKS section) still tells the model to write TASKS.md. It doesn't know that TASKS.md gets post-processed into individual files. This works but means the model can't optimize for the new format (e.g., writing richer per-task context that would go into the ticket body). Future: have the model write task files directly via write_framework_file, eliminating the TASKS.md intermediate.

---

## Deploy Command

- [ ] **Deploy is a renamed stub** — `automate.py` was renamed to `deploy.py` but the implementation is unchanged. The command generates IaC from requirements and architecture. No new functionality was added during the rename. REQ-A-1 through REQ-A-5 define the current scope. Future scope (release management, CI/CD) is undefined — needs requirements before implementation.

---

## Test Quality

- [ ] `TestContextBuild` tests string concatenation in the test, not the actual gather code. Rewrite to call real `_build_context_block()` or equivalent.
- [ ] `TestSourceRequirementsDirect` uses a `FakeAgent` instead of mocking through the real gather pipeline. Replace with integration test that mocks at the OpenAI boundary.
- [ ] `test_preamble_stripped_from_final_response` reimplements regex logic inline. Should call the actual stripping function from gather.
- [ ] Audit all command-level tests for "testing the test" pattern — tests that reimplement logic inline instead of exercising the real code path.

---

## Display Bugs

- [ ] Multi-spinner in concurrent develop mode shows duplicate completed task lines for the same task. Likely `ms.done()` called multiple times for the same descriptor, or Rich Live not clearing previous renders properly. Investigate `_MultiSpinner._render()` and the develop dispatch loop task completion flow.

---

## Future

- [ ] history.log rotation strategy tied to release planning in deploy. Rotate on release boundaries rather than size/date.
- [ ] Kanban-style board view for `voidrift status` — Rich table grouped by status columns (planned, in-progress, implemented, verified, failed/blocked). Data from manifest.yml.
