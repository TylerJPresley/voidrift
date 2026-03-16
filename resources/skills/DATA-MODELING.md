# Skill: Data Modeling

## Core Philosophy
- **Conceptual Modeling:** Define the core entities and their relationships before choosing a persistence technology.
- **Normalization vs. Denormalization:** Understand the trade-offs between read performance (denormalized) and write integrity (normalized).
- **Single Source of Truth:** Ensure every piece of data has exactly one authoritative representation.

## Implementation Rules
- **Entity-Relationship Design:** Create clear ERDs defining one-to-one, one-to-many, and many-to-many relationships.
- **Schema Evolution:** Design schemas with extensibility in mind; use versioning for complex document structures.
- **Data Integrity:** Enforce constraints (Unique, Not Null, Foreign Keys) at the model level.
- **Type Safety:** Use strong typing for all data models (Pydantic, TypeScript Interfaces, POJOs).

## Abstraction
- **Model vs. Persistence:** Distinguish between domain models (business logic) and persistence models (database tables).
- **Validation:** Implement multi-layered validation (at the model, service, and database levels).
