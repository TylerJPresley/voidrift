---
name: DATA-ENG
description: Database design, migrations, query patterns, data pipelines, and data integrity rules.
triggers:
  extensions: [".sql"]
  files: []
  keywords: ["pipeline","etl","schema","migration","sql","database","query"]
agents: []
active: true
---

# DATA-ENG

## Schema Design

```sql
-- ✅ Explicit constraints, audit columns, soft delete
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ❌ No constraints, no types, no audit trail
CREATE TABLE users (id SERIAL, email VARCHAR, name VARCHAR);
```

## Migrations

- One migration per change. Never modify an existing migration after it's been applied.
- Migrations must be reversible (include `down`/rollback)
- Test migrations against a copy of production data before applying
- Name migrations with timestamps: `20240615_add_users_email_index.sql`

## Queries

```sql
-- ✅ Parameterized, indexed columns in WHERE
SELECT * FROM orders WHERE user_id = $1 AND status = $2;

-- ❌ String interpolation (SQL injection)
SELECT * FROM orders WHERE user_id = '${userId}';

-- ❌ SELECT * in application code (breaks on schema change)
-- ✅ SELECT id, name, email FROM users
```

- Index columns used in WHERE, JOIN, and ORDER BY
- Use EXPLAIN ANALYZE to verify query plans before shipping
- Prefer JOINs over N+1 queries. Paginate with cursor-based pagination for large sets.

## Data Integrity

- Foreign keys enforced at the database level, not just application logic
- Use transactions for multi-table writes. No partial state.
- Soft deletes (`is_deleted`) for business entities. Hard deletes only for truly ephemeral data.
- Validate at ingestion. Never trust upstream data.

## Pipelines

- Idempotent: running the same pipeline twice produces the same result
- Schema validation at pipeline boundaries (source → transform → sink)
- Dead letter queues for failed records — don't drop data silently
- Monitor pipeline lag, throughput, and error rate

## Stored Decisions (check memory first)

Before asking the user, check if these are already stored:
- ORM/query builder (Prisma, Drizzle, TypeORM, raw SQL)
- Migration tool
- Timestamp format (UTC, with timezone)
- Naming convention (snake_case, camelCase for columns)
- Soft delete policy

If missing, ask once and store as a directive memory.
