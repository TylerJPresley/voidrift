# Test-Driven Development (TDD)

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.
```

Write code before the test? Delete it. Start over. No exceptions.

## Red-Green-Refactor Cycle

### 1. RED — Write a Failing Test

Write one test that describes the expected behavior. Run it. Confirm it FAILS for the right reason — not a compile error, but because the feature is genuinely missing.

**Backend (JUnit 5 + AssertJ):**
```java
@Test
void shouldRejectEmptyEmail() {
    var result = userService.createUser(new CreateUserRequest("", "name"));
    assertThat(result.error()).isEqualTo("Email is required");
}
```

**Frontend (Vitest + Vue Test Utils):**
```typescript
test('rejects empty email on submit', async () => {
    const wrapper = mount(LoginForm);
    await wrapper.find('input[type=email]').setValue('');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.text()).toContain('Email is required');
});
```

### 2. GREEN — Minimal Code to Pass

Write the least amount of code that makes the test pass. No extra features, no refactoring other code, no "while I'm here" changes. All tests must pass with clean output.

### 3. REFACTOR — Clean Up

Only after green: remove duplication, improve names, extract helpers. Keep all tests green throughout. Do not add new behavior during refactor.

## Verification Checklist (required before marking a task done)

- [ ] Watched each test FAIL before writing implementation
- [ ] Failure was the expected message, not a compile/syntax error
- [ ] Wrote minimal code — did not over-engineer
- [ ] All tests pass with clean output (`mvn test` / `npm test`)
- [ ] Edge cases and error paths are covered

## Red Flags — Delete Code and Start Over

- Wrote any production code before the test existed
- Test passed immediately without real implementation
- Cannot explain why the test failed during RED
- "I'll add tests after" / "I manually verified it works"
- "Just this once" / "It's too simple to test"

## Bug Fixes

Always reproduce the bug with a failing test first. Then fix it. The test proves the fix is real and prevents future regression. Never fix a bug without a test.
