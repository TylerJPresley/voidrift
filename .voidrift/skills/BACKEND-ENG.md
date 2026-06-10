---
name: BACKEND-ENG
description: Backend engineering principles — API design, service boundaries, data flow, error handling, and testing patterns.
triggers:
  extensions: [".py",".go",".rs",".java"]
  files: []
  keywords: ["api","endpoint","server","backend","database"]
agents: []
active: true
---

# Domain: Backend Engineering (BACKEND-ENG)

## Core Philosophy
- **Narrow interfaces:** Functions and services receive only what they need. Avoid passing full config dicts or god objects.
- **Separation of concerns:** Business logic, data access, and transport are distinct layers. A change to the API format should not require changes to business logic.
- **Test at boundaries:** Write tests for public interfaces, configuration loading, and integration points. Don't mock what you can call directly.
- **Fail explicitly:** Return clear errors with context. Silent failures and swallowed exceptions hide bugs.

## API Design
- Resource-based endpoints with consistent naming conventions.
- Use correct HTTP status codes: 2xx success, 4xx client error, 5xx server error.
- Validate all inputs at the boundary — never trust external data.
- Version APIs when breaking changes are unavoidable.
- Health check endpoints for operational visibility.

## Service Boundaries
- Each service or module owns its data and exposes it through defined interfaces.
- Cross-service communication through explicit contracts (API schemas, message formats).
- Configuration externalized from code — environment variables, config files, or secret stores.
- Secrets never hardcoded, never logged, never returned in API responses.

## Data Flow
- Define where state lives: database, cache, in-memory, or transient.
- Cache with explicit TTLs — stale data is a bug when freshness matters.
- Idempotent operations where possible — safe to retry without side effects.
- Validate data at ingestion, not at consumption.

## Error Handling
- Catch specific exceptions — never bare catch-all.
- Return structured error responses with enough context to diagnose.
- Retry transient failures with backoff. Fail fast on permanent errors.
- Log errors with correlation context (request ID, operation, inputs).

## Testing
- Test public behavior, not internal implementation details.
- Mock at external boundaries (HTTP clients, databases, filesystems), not at internal functions.
- Integration tests for cross-component flows. Unit tests for logic.
- Every bug fix includes a regression test.
