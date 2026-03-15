# Systematic Debugging

## Core Principle

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
```

Fixing a symptom without understanding the cause is not debugging — it's guessing. Guessing wastes time and hides real problems.

## The Four Phases

### Phase 1: Root Cause Investigation

1. Read the **full** error message and stack trace — not just the first line
2. Reproduce the issue with the smallest possible case
3. Check recent changes: `git log -n 10 --oneline`, `git diff HEAD~1`
4. Trace data flow **backward** from the failure through the call stack
5. Gather evidence from logs and metrics before touching any code

### Phase 2: Pattern Analysis

- Find a working example of the same pattern elsewhere in the codebase
- Compare line by line — identify **all** differences
- Check all dependencies: versions, configuration, environment variables
- Verify the database schema, API response shape, or external contract hasn't changed

### Phase 3: Hypothesis and Testing

- Form **one** specific, falsifiable hypothesis
- Test it with **one** minimal change
- Verify the result fully before moving on
- If it works and you don't understand why — keep investigating. Accidental fixes become future bugs.

### Phase 4: Implementation

- Write a failing test that reproduces the bug (follow `TDD.md`)
- Implement the **single** fix that addresses the root cause
- Run the full test suite: `mvn test` (backend), `npm test` (frontend)

## Red Flags — Stop and Restart Investigation

- Proposing a fix before tracing the full data flow
- Making more than one change at a time
- "Let me just try this and see what happens"
- Three or more failed attempts → stop and question the architecture before continuing

## When Stuck

Escalate to the Architect before making architectural changes.
