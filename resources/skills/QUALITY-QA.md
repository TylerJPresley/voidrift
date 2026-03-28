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
