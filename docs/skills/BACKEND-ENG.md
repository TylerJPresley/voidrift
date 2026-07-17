---
name: BACKEND-ENG
description: Backend engineering — API design, error handling, data flow, service boundaries, and testing patterns.
triggers:
  extensions: [".py",".go",".rs",".java"]
  files: []
  keywords: ["api","endpoint","server","backend","database","service"]
agents: []
active: true
---

# BACKEND-ENG

## API Design

```
✅ GET /users/:id          → 200 with user, 404 if missing
✅ POST /users             → 201 with created resource, 422 on validation failure
❌ GET /getUser?id=123     → 200 with error message in body
❌ POST /users             → 200 with { success: false, error: "..." }
```

- Resources are nouns, not verbs
- Status codes carry meaning — don't tunnel errors through 200
- Validate all inputs at the boundary with schemas (Zod, Pydantic, JSON Schema)
- Version when breaking changes are unavoidable: `/v1/users`

## Error Handling

```
✅ Specific catch with context:
catch (err) {
  throw new ServiceError("Failed to create user", { cause: err, userId, operation: "create" });
}

❌ Swallowed error:
catch (err) { return null; }

❌ Generic catch-all:
catch (err) { throw new Error("Something went wrong"); }
```

- Return structured errors: `{ error: { code, message, details } }`
- Retry transient failures (network, 503) with exponential backoff
- Fail fast on permanent errors (400, 401, 404) — no retry
- Log with correlation context (request ID, operation, relevant IDs)

## Service Boundaries

- Each module owns its data. No reaching into another module's database/state.
- Cross-module communication through explicit interfaces (function calls, API contracts, events)
- Configuration externalized: env vars or config files, never hardcoded
- Secrets: never in code, never in logs, never in API responses

## Data Flow

- Define where each piece of state lives: database, cache, in-memory, transient
- Cache with explicit TTLs. Stale data without a TTL is a bug.
- Idempotent operations where possible — safe to retry without side effects
- Validate at ingestion, trust internally

## Testing

```
✅ Test the public interface:
test("createUser returns user with generated ID", async () => {
  const user = await service.createUser({ name: "test" });
  expect(user.id).toBeDefined();
});

❌ Test internal implementation:
test("createUser calls _generateId internally", () => { ... });
```

- Mock at external boundaries (HTTP clients, databases), not internal functions
- Every bug fix includes a regression test
- Integration tests for cross-component flows, unit tests for logic
