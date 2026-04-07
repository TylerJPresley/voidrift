---
name: QUALITY-QA
description: Test-driven development, evidence-based completion, regression testing, and quality assurance patterns.
---

# Domain: Quality & Verification (QUALITY-QA)

## The Iron Law
```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```
"Should work" is not evidence. Run the command. Read the output. Then — and only then — make the claim.

## Implementation Rules
- **TDD Principle:** Write a failing test before implementing any functional logic.
- **The Test Pyramid:** Maintain a broad base of unit tests, fewer integration tests, and minimal E2E tests.
- **Systematic Debugging:** NO FIXES without root-cause investigation first. Follow the Investigation → Analysis → Hypothesis → Implementation loop.
- **Evidence Standard:** Every task completion must provide logs, test results, or `git diff` as proof of success.

## Quality Gates
- **Regressions:** Every bug fix must include a regression test.
- **Isolation:** Mock/stub external dependencies to ensure tests are deterministic.
- **Documentation:** Use descriptive test names that serve as functional documentation.

## VoidRift Test Conventions

Test files live in `cli/tests/` and are named `test_<module>.py` to match the source
module they cover (e.g. `session.py` → `test_session.py`).

Test classes group tests by requirement or behavior. Class names must match the V-entry
in `REQUIREMENTS.md` §6 — the V-entry's Evidence column names the class (e.g.
`test_agent.py::TestRetryLogic`). If you write a new test class, add a corresponding
V-entry in REQUIREMENTS.md before the task is done.

Use the `tmp_project` and `cloud_model` fixtures from `conftest.py` for any test that
needs a filesystem or a `ModelConfig`. Do not construct paths manually with `os.getcwd()`.

## One Test Per AC

Every public function or class introduced by a task needs at least one test. Structure
tests using Given/When/Then to mirror the AC directly:

```python
def test_context_length_triggers_compact(self, ...):
    # Given — set up agent with a context-length error on first call
    # When — agent.send("hello")
    # Then — assert compaction ran and retry succeeded
```

## Mocking API Calls

Use `patch("voidrift_cli.commands.<cmd>.AgentLoop")` to replace the agent loop in
command tests. Configure `mock_agent.return_value.send.return_value = "response text"`.

Use `helpers.make_openai_response(content="...", tool_calls=[...])` from
`cli/tests/helpers.py` to build mock API responses when testing the agent loop directly.

Use `FauxProvider` in `testing/faux_provider.py` for full OpenAI client round-trips.
Set `VCR_MODE=record` to capture real responses; leave unset for replay.
