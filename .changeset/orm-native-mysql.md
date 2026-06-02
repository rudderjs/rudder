---
"@rudderjs/orm": minor
---

feat(orm): native MySQL dialect + driver (Phase 7.8)

Adds MySQL to the built-in native engine, mirroring the shipped Postgres path
(7.7). Native now drives SQLite, Postgres, **and** MySQL with one query/DDL/
introspection/types pipeline.

- **`MysqlDialect`** — backtick identifier quoting, `?` placeholders, `1`/`0`
  boolean literals, and the MySQL column-type map (`t.id()` →
  `bigint AUTO_INCREMENT PRIMARY KEY`, `boolean` → `tinyint(1)`, `json` → `json`,
  `uuid` → `char(36)`, `dateTime`/`timestamp` → `datetime`/`timestamp`, etc.).
- **`MysqlDriver`** (`mysql2`, optional peer) — pooled; autocommit statements run
  on the pool, `transaction()` reserves a connection (BEGIN/COMMIT/ROLLBACK) and
  nested transactions map to SAVEPOINTs on that pinned connection.
- **No-RETURNING write path** — MySQL 8 has no `RETURNING`, so the query builder
  branches on `dialect.supportsReturning`: it reads `insertId` / `affectedRows`
  from the driver's result metadata (a new native-only `AffectingExecutor` seam)
  and re-SELECTs by primary key for terminals that return a row. SQLite/Postgres
  keep their exact existing `RETURNING *` path.
- **Introspection + type generation** — `information_schema` reads scoped to
  `DATABASE()` and a `mysqlTypeToTs` mapper, so `rudder schema:types` /
  post-`migrate` generation works against MySQL (`tinyint` → `number`, refined to
  `boolean` by a declared cast; `decimal` → `string`; `json` → `unknown`).
- **Provider gate reconciled** — the `engine: 'native'` config path previously
  hard-rejected every non-sqlite driver, leaving the shipped Postgres engine
  unreachable via `config/database.ts` (and `rudder migrate`, which boots through
  the provider). The gate now validates the driver name and accepts `sqlite` /
  `pg` / `mysql` (pg + mysql enabled together); `NativeAdapter.make` then loads
  the matching optional peer with a clear install/connection error.
- `mysql2` added as an optional peer dependency (lazy-imported only —
  `pnpm test:client-bundle` stays green).
