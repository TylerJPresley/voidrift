# Domain: Architecture & Design (ARCH-DESIGN)

## Core Philosophy
- **Hexagonal Architecture:** Maintain a clean separation between the domain logic and external adapters (UI, DB, APIs).
- **Domain-Driven Design (DDD):** Use bounded contexts and entities to align software with business logic.
- **Robust API Standards:** Use REST (RFC 7807), GraphQL, or gRPC; version all URIs and enforce idempotency.
- **Distributed Resilience:** Design for the "Chaos of the Network" using CQRS, Sagas, and Event Sourcing.

## Implementation Rules
- **API Standards:** Resource-based nouns for endpoints; correct HTTP status codes; mandatory pagination and health checks.
- **Resilience Patterns:** Implement Circuit Breakers, Bulkheads, and Backpressure to prevent cascading failures.
- **Global Readiness (I18N):** Externalize all strings; use Unicode (UTF-8); never hardcode cultural assumptions or formats.
- **State Management:** Explicitly define where state lives (store, persistence, or transient memory).

## Observability
- **Traceability:** Distributed `X-Correlation-ID` must be present across all service-to-service communication.
- **Documentation:** Every major architectural shift requires a Decision Rationale entry in `ARCHITECTURE.md` and an updated Components Table.
