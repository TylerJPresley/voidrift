# Skill: Testing & QA

## Core Principles
- **TDD:** Write a failing test before implementing any functional logic.
- **The Test Pyramid:** Maintain a broad base of Unit tests, fewer Integration tests, and minimal E2E tests.
- **Fast Feedback:** Optimize tests to run quickly as part of the local development loop.

## Implementation Rules
- **Isolation:** Mock or stub external dependencies (DBs, APIs) to ensure tests are deterministic.
- **Seed Data:** Use reproducible datasets for integration tests; avoid shared global state.
- **Coverage:** Aim for 80%+ branch coverage on core business logic.
- **Property-Based:** Use fuzzing or property-based testing for complex edge-case detection.

## Quality Gates
- **Regressions:** Every bug fix must include a regression test.
- **Flakiness:** Identify and fix flaky tests immediately; do not disable them without a plan.
- **Documentation:** Use descriptive test names that serve as functional documentation.
