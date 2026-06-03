---
"@rudderjs/orm": minor
---

feat(orm): date helpers (`whereDate`/`whereTime`/`whereDay`/`whereMonth`/`whereYear`) + `whereNot` group-negation on the native engine

Laravel's date-based wheres and `whereNot` arrive on the native query engine:

- **Date helpers** — `whereDate('createdAt', '2026-01-01')`, `whereYear('createdAt', '>=', 2026)`, etc. (+ `orWhere*` forms). Two-arg form is equality; three-arg carries the operator. Compiled through a new per-dialect `Dialect.dateExtract(part, column)` seam: SQLite `strftime` (with `CAST(... AS INTEGER)` for day/month/year), Postgres `::date`/`::time`/`EXTRACT(...)::int`, MySQL `DATE()`/`TIME()`/`DAY()`/`MONTH()`/`YEAR()`. Values bind positionally like any other clause. A `Date` value compares by its UTC components; numeric strings on day/month/year coerce to integers.
- **`whereNot(cb)` / `orWhereNot(cb)`** — negated group: the callback's conditions compile as one parenthesized sub-tree wrapped in `NOT (…)`, reusing the `whereGroup` sub-builder machinery. The callback receives a hydrating sub-builder, so named sugar (`whereIn`, `whereNull`, …) composes inside it.

All methods live on `HydratingQueryBuilder` + as `Model` statics — NOT on the `QueryBuilder` contract (zero adapter/stub churn). On adapters that don't implement them yet (Drizzle, Prisma), the Model-layer proxy throws a clear `<method>() is not supported on this adapter — use whereRaw(...) or DB.select(...)` error instead of a bare TypeError; the Drizzle implementation is a planned follow-up.
