# VOIDRIFT-TESTING

Guardrails for testing VoidRift.

## Framework

- **vitest** — not bun test. Bun's runner has chokidar timing issues.
- Run: `bun run test` (executes `vitest run`)
- Watch: `bun run test:watch`

## Structure

- Tests live in `tests/` mirroring `src/` directory structure
- `tests/tools/executors.test.ts` tests `src/tools/executors.ts`
- Many tests passing

## Rules

- Every new feature needs tests. No exceptions.
- Test the public interface, not internals. If you're importing private functions, redesign.
- Mock the model (LangChain client) — never make real API calls in tests.
- Mock the filesystem for file operation tests — use temp dirs or in-memory.
- Don't mock the EventBus — it's cheap and testing real event flow catches integration bugs.
- Shell command tests: use known safe commands (echo, true, false). Never rm/chmod in tests.

## What to Test

| Layer | Test type |
|-------|-----------|
| Tool executors | Unit — given args, returns expected output |
| Policy engine | Unit — given tool+args+mode, returns correct decision |
| Context manager | Unit — layer operations maintain invariants |
| Skill manager | Unit — trigger matching logic |
| Compactor | Unit — message reduction preserves diagnostics |
| Graph/orchestration | Integration — mock model, verify tool loop behavior |
| Commands | Integration — verify output and state changes |

## What NOT to Test

- Ink/React rendering (too brittle, too slow)
- LangChain internals (their problem)
- MCP server responses (mock the SDK client)
- File watcher timing (flaky by nature)
