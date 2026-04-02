# TODO — Backlog

Items that don't belong in FEATURES.md (planned work) or REQUIREMENTS.md (contract) but need doing.

## Test Quality

- [ ] `TestContextBuild` tests string concatenation in the test, not the actual gather code. Rewrite to call real `_build_context_block()` or equivalent.
- [ ] `TestSourceRequirementsDirect` uses a `FakeAgent` instead of mocking through the real gather pipeline. Replace with integration test that mocks at the OpenAI boundary.
- [ ] `test_preamble_stripped_from_final_response` reimplements regex logic inline. Should call the actual stripping function from gather.
- [ ] Audit all command-level tests for "testing the test" pattern — tests that reimplement logic inline instead of exercising the real code path.

## Display Bugs

- [ ] Multi-spinner in concurrent develop mode shows duplicate completed task lines for the same task. Likely `ms.done()` called multiple times for the same descriptor, or Rich Live not clearing previous renders properly. Investigate `_MultiSpinner._render()` and `_develop_module` task completion flow.

## Future — Release Planning

- [ ] history.log rotation strategy tied to release planning in automate. Rotate on release boundaries rather than size/date.

## Future — Status Display

- [ ] Kanban-style board view for `voidrift status` — Rich table grouped by status columns (planned, in-progress, implemented, verified, failed/blocked). Data from manifest.yml.
