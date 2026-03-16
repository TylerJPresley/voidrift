# Skill: API Design

## Standards
- **REST (RFC 7807):** Default to RESTful patterns; use standardized Problem Details for error responses.
- **Versioning:** Always include the version in the URI (e.g., `/api/v1/resource`).
- **Idempotency:** Ensure `PUT` and `DELETE` operations are idempotent.
- **Pagination:** Mandatory for all list/search endpoints; use link headers or metadata envelopes.

## Implementation Rules
- **HTTP Codes:** Use correct status codes (200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500 Error).
- **Resource Naming:** Use nouns, not verbs, for endpoints (e.g., `/users` not `/getUsers`).
- **Validation:** Validate all input at the boundary using schema validators or Pydantic/JSR-303.
- **Contract-First:** Maintain OpenAPI v3 or GraphQL schema definitions as the source of truth.

## Observability
- **Correlation IDs:** Every API response must include a header (e.g., `X-Correlation-ID`) for tracing.
- **Health Checks:** Provide `/health/live` and `/health/ready` endpoints for all services.
