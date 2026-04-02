# TODO — Backlog

Work items that need doing. Grouped by area, ordered by priority within each group.

---

## Task System — Orphaned References

- [x] **REQ-P-5** — replaced with pointer to REQ-TM-4.
- [x] **REQ-P-11** — rewritten to reference manifest.yml and task files.
- [x] **REQ-D-14 verification entries** — V-D-10 and V-D-13 now point to test_manifest.py.
- [x] **ARCHITECTURE.md verify section** — updated to reference manifest.yml.
- [x] **Appendix A** — updated with tasks/, ideas/, manifest.yml, history.log.

---

## Task System — Unvalidated Code Paths

- [x] **Architect consultation on failure** — test added (`test_no_writes_with_architect_escalates`). Covers full path: no writes → retry → no writes → architect consulted → fix plan appended → task re-queued.

- [x] **Bug creation from verify** — `_update_manifest()` in verify.py creates BUG entries in manifest for failed test cases, links them to tasks via req-to-task mapping, marks linked tasks as `failed`.

- [x] **Task archival flow** — `_update_manifest()` checks implemented tasks after verify. If all reqs pass, sets status to `verified` and calls `archive()`.

---

## Idea System — Unvalidated

- [x] **`/done` bug** — fixed. Messages now flow through normal `agent.send()` path instead of being appended without sending. ID assigned at `/done` time, not at creation.

- [ ] **`/idea` new flow** — Injects IDEA prompt overlay into agent system prompt, returns message for agent.send(). Handler exists at `_handle_idea()` in main.py. Untested against a real model. Risk: overlay injection mutates `agent.messages[0]["content"]` which may not persist correctly across turns.

- [ ] **`/idea <id>` load flow** — Reads existing idea file, injects content + overlay, asks agent to summarize. Same handler, different branch. Risk: if the idea file is large, injecting it into the system prompt may consume significant context.

- [ ] **`/done` prompt_toolkit conflict** — `_finish_idea()` uses `prompt_toolkit.prompt()` for category selection which may conflict with the existing PromptSession. Needs manual testing.

---

## Plan Command — Task File Generation

- [x] **Dependency extraction** — `_build_task_files()` now parses `depends:` metadata from TASKS.md and passes it to ManifestManager.

- [ ] **`_build_task_files()` edge cases** — TaskStore was designed for the old format and may not handle all edge cases the model produces (multi-line descriptions, nested code blocks in task text, etc.). Location: `cli/src/voidrift_cli/commands/plan.py`.

- [ ] **Plan prompt doesn't know about task files** — The plan stage 2 prompt still tells the model to write TASKS.md. Future: have the model write task files directly via write_framework_file, eliminating the TASKS.md intermediate.

---

## Gather Command — Code/Reqs Mismatch

- [x] **Gather uses `--path` and `--idea`** — positional `<path>` changed to `--path` option, `--idea <id>` added, help message when neither provided. `_gather_from_idea()` implements idea mode with ANALYSIS-REQS skill, records reqs + diff in idea file.

---

## Deploy Command

- [ ] **Deploy is a renamed stub** — `automate.py` was renamed to `deploy.py` but the implementation is unchanged. REQ-A-1 through REQ-A-5 define the current scope. Future scope (release management, CI/CD) is undefined — needs requirements before implementation.

---

## Test Quality

- [x] `TestContextBuild` — rewritten to call `build_context_block()` from gather.py.
- [x] `TestSourceRequirementsDirect` — rewritten to call `strip_preamble()` from gather.py. FakeAgent test removed.
- [x] `test_preamble_stripped_from_final_response` — calls real `strip_preamble()`.
- [x] Audit all command-level tests — scanned all test files. FakeAgent usage in web_fetch tests is correct (injected via `agent_loop_cls` parameter). One minor inline formula test (`test_retry_tokens_floor_at_256`) but the retry logic isn't extracted as a function. No other offenders found.

---

## Display Bugs

- [x] **Multi-spinner duplicates** — `done()` now guards against being called for a descriptor already moved from active to completed.

---

## Future

- [ ] history.log rotation strategy tied to release planning in deploy. Rotate on release boundaries rather than size/date.
- [ ] Kanban-style board view for `voidrift status` — Rich table grouped by status columns (planned, in-progress, implemented, verified, failed/blocked). Data from manifest.yml.
