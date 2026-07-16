---
name: QUALITY-QA
description: Test-driven development, evidence-based completion, regression testing, and verification discipline.
triggers:
  extensions: [".test.ts",".spec.ts",".test.js",".test.tsx"]
  files: []
  keywords: ["test","tdd","coverage","regression","qa","vitest","jest"]
agents: []
active: true
---

# QUALITY-QA

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
```

"Should work" is not evidence. Run the command. Read the output. Then — and only then — make the claim.

## Test Structure

```typescript
// ✅ Descriptive name, Given/When/Then structure
test("createUser returns error when email already exists", async () => {
  // Given
  await createUser({ email: "test@example.com" });
  // When
  const result = await createUser({ email: "test@example.com" });
  // Then
  expect(result.error).toBe("EMAIL_EXISTS");
});

// ❌ Vague name, no structure
test("user test", () => {
  expect(createUser({})).toBeTruthy();
});
```

## What to Test

- Public interfaces and behavior — not internal implementation
- Edge cases: empty input, null, boundary values, concurrent access
- Error paths: what happens when dependencies fail?
- Every bug fix includes a regression test proving the fix

## What NOT to Test

- Private implementation details (refactoring breaks tests)
- Third-party library internals
- Simple getters/setters with no logic

## Mocking

```typescript
// ✅ Mock at external boundaries
vi.mock("./http-client", () => ({
  fetch: vi.fn().mockResolvedValue({ status: 200, data: mockUser }),
}));

// ❌ Mock internal functions (couples test to implementation)
vi.spyOn(service, "_generateId").mockReturnValue("123");
```

- Mock external dependencies (HTTP, database, filesystem)
- Don't mock what you can call directly
- Prefer integration tests over heavily-mocked unit tests

## Debugging Protocol

When a test fails:
1. Read the error message completely
2. Reproduce the failure — confirm it's deterministic
3. Identify root cause before attempting a fix
4. Fix the cause, not the symptom
5. Verify the fix AND run the full suite

After 3 failed attempts: stop, restate assumptions, try a different approach.

## Evidence Standard

Task completion must provide one of:
- Test output showing pass
- Command output confirming success
- Git diff showing the change

Never claim "done" based on intent. Only verified results count.

## Stored Decisions (check memory first)

Before asking the user, check if these are already stored:
- Test runner (vitest, jest, mocha)
- Test file location and naming pattern
- Coverage threshold
- E2E tool (Playwright, Cypress)
- Mock strategy preferences

If missing, ask once and store as a directive memory.
