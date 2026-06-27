---
"@rudderjs/database": minor
"@rudderjs/contracts": minor
---

feat(database): bulk write terminals that return the RETURNING rows (updateAllReturning / upsertReturning)

`NativeQueryBuilder.updateAll` / `upsert` return only an affected-row count, even though on a RETURNING-capable dialect (Postgres/SQLite) they already execute `RETURNING *` and have the written rows in hand. Two new optional terminals return those rows instead:

- `updateAllReturning(data): Promise<T[]>` — the updated rows in their real post-write state (DB coercion, defaults, triggers), for any primary-key shape, with no re-select.
- `upsertReturning(rows, uniqueBy, update): Promise<T[]>` — the upserted rows, including a DB default that filled an omitted conflict column.

Both are additive; the existing count variants are unchanged. They are declared as optional methods on the `QueryBuilder<T>` contract (alongside `upsert?`). A no-`RETURNING` dialect (MySQL) has no rows to return and no captured keys for a bulk re-select, so the methods throw a `NativeOrmError` with code `NATIVE_RETURNING_UNSUPPORTED` rather than returning a stale or empty set. This lets the neutral `@universal-orm/*` adapters honour their "return the row(s)" contract from a bulk write without a primary-key-dependent re-read.
