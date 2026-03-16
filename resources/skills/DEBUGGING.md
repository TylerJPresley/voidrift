# Skill: Systematic Debugging

## Core Principle
```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```
Fixing a symptom without understanding the cause is not debugging — it's guessing. Guessing wastes time and hides real problems.

## The Four Phases

### Phase 1: Investigation
1. Read the **full** error message and stack trace.
2. Reproduce the issue with the smallest possible isolated test case.
3. Check recent changes (`git log`, `git diff`) and environmental factors.

### Phase 2: Analysis
- Trace data flow backward from the point of failure to its origin.
- Identify the exact state or input that violates the system's contract.
- Compare the failing scenario with a working one to identify deltas.

### Phase 3: Hypothesis
- Form one specific, falsifiable hypothesis.
- Test it with a single, targeted change or diagnostic log.
- If the hypothesis is disproven, revert and form a new one.

### Phase 4: Implementation
- Write a failing test that reproduces the bug.
- Apply the fix and verify it passes while maintaining all existing tests.
- Re-run the full verification suite.

## Red Flags
- Making multiple changes at once.
- "Try and see" coding without a hypothesis.
- Proposing a fix before identifying the root cause.
