# Skill: Data Persistence

## Core Standards
- **Relational (SQL):** Prefer PostgreSQL for structured data and transactional integrity.
- **NoSQL:** Use Redis for caching and transient state; MongoDB or DynamoDB for document-based storage.
- **ACID:** Ensure atomicity, consistency, isolation, and durability for all financial or core state changes.

## Implementation Rules
- **Migrations:** Use automated migration tools (Flyway, Alembic, Liquibase); never apply schema changes manually.
- **Repository Pattern:** Abstract data access behind Repositories to enable mocking in tests.
- **Indexing:** Proactively index fields used in `WHERE`, `JOIN`, and `ORDER BY` clauses.
- **Connection Pooling:** Always use a connection pool (HikariCP, SQLAlchemy pool) to manage database resources.
- **Audit Logs:** Track `created_at`, `updated_at`, and `created_by` for all core entities.

## Safety Rules
- **No Raw SQL:** Use ORMs or query builders to prevent SQL injection unless performance requires raw queries.
- **Soft Deletes:** Use `is_deleted` flags for important data rather than permanent deletion.
