---
"@rudderjs/orm": minor
---

Native ORM engine: add the Postgres DDL dialect (`PgDialect`) — Phase 7.7a. Maps the portable schema-builder column types to Postgres storage types (`bigserial` PK, `varchar(n)`, `jsonb`, `timestamptz`, native `uuid`/`bytea`, `numeric(p,s)`, `double precision`), with `"`-quoted identifiers, `$n` placeholders, and `RETURNING` support. Adds a `Dialect.booleanLiteral(value)` seam so a boolean column `DEFAULT` renders correctly per dialect (Postgres `true`/`false`; SQLite/MySQL `0`/`1`). Pure / dialect-only — the Postgres driver and live introspection land in follow-ups.
