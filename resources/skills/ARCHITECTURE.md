# Skill: Architecture

## Core Principles
- **Hexagonal Architecture:** Maintain a clean separation between the domain logic and external systems (adapters).
- **Domain-Driven Design (DDD):** Align software models with business logic; define bounded contexts and entities.
- **Decoupling:** Inject interfaces rather than concrete implementations (SOLID).
- **State Management:** Explicitly define where state lives (store, database, or transient memory).

## Implementation Rules
- **Domain Purity:** The core domain logic must not depend on frameworks, databases, or UI libraries.
- **Boundaries:** Use DTOs to cross architectural boundaries; do not leak persistence models to the UI.
- **Service Layer:** Business logic belongs in Services, not Controllers or Repositories.
- **Event-Driven:** Prefer asynchronous communication for cross-module interactions to reduce coupling.

## Documentation & Metadata
- **ADR Required:** Every major architectural shift requires an Architecture Decision Record.
- **Components Table:** Keep a high-level table of system components and their responsibilities in `ARCHITECTURE.md`.
