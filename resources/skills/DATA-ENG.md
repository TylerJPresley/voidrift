---
name: DATA-ENG
description: Data pipeline design, storage patterns, processing constraints, and data quality principles for data engineering work.
---

# Domain: Data Engineering (DATA-ENG)

## Core Philosophy
- **Conceptual Modeling:** Define core entities and their relationships (ERD) before choosing a persistence technology.
- **Single Source of Truth:** Every piece of data has exactly one authoritative representation.
- **Integrity & ACID:** Ensure atomicity, consistency, isolation, and durability for all core transactional state.

## Implementation Rules
- **Schema Evolution:** Design schemas with extensibility in mind; use automated migration tools (Alembic, Flyway).
- **Persistence Patterns:** Abstract data access behind Repositories; use connection pooling and proactive indexing.
- **Relational vs. NoSQL:** Use PostgreSQL for transactional integrity; Redis for caching; NoSQL for document-based scale.
- **Validation:** Multi-layered validation at the model, service, and database levels; enforce strong typing (Pydantic/TS).

## Safety & Compliance
- **No Raw SQL:** Use ORMs or query builders to prevent SQL injection.
- **Soft Deletes:** Prefer `is_deleted` flags over permanent deletion for core business entities.
- **Audit Logs:** Track `created_at`, `updated_at`, and `created_by` for all core records.
