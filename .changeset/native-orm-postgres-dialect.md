---
"@rudderjs/orm": minor
---

Native ORM engine: add Postgres support — Phase 7.7. The native engine (`@rudderjs/orm/native`) now runs against Postgres in addition to SQLite.

- **`PgDialect`** — maps the portable schema-builder column types to Postgres storage types (`bigserial` PK, `varchar(n)`, `jsonb`, `timestamptz`, native `uuid`/`bytea`, `numeric(p,s)`, `double precision`), with `"`-quoted identifiers, `$n` placeholders, and `RETURNING` support. Adds a `Dialect.booleanLiteral(value)` seam so a boolean column `DEFAULT` renders correctly per dialect (Postgres `true`/`false`; SQLite/MySQL `0`/`1`).
- **`PostgresDriver`** — a `Driver` over the `postgres` package (porsager, a new optional peer dependency), with pooled connections and real transactions/savepoints. `int8`/`bigserial` columns parse as JS numbers so a model's `id` matches the SQLite engine.
- **Driver selection** — `native({ driver: 'pg', url })` wires the Postgres driver + dialect; `SchemaBuilder.hasTable`/`hasColumn` introspect via `information_schema` on Postgres.

Opt-in and additive — SQLite apps are unaffected. MySQL (7.8) is a separate follow-up.
