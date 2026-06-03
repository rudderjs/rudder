---
'@rudderjs/orm-drizzle': minor
---

Date-component predicates (`whereDate` / `whereTime` / `whereDay` / `whereMonth` / `whereYear` + `orWhere*` forms) and `whereNot` / `orWhereNot` negated groups are now real on the Drizzle adapter — same surface and semantics as the native engine. The per-dialect extraction SQL mirrors the native `Dialect.dateExtract` (sqlite `strftime` with `CAST(... AS INTEGER)` for day/month/year, pg `::date`/`::time`/`EXTRACT(...)::int`, mysql `DATE()`/`TIME()`/`DAY()`/`MONTH()`/`YEAR()`); `Date` values compare by their UTC components and numeric strings coerce on day/month/year. `whereNot` wraps the callback's conditions in `NOT (...)` via Drizzle's `not()`; named sugar (`whereIn`, `whereNull`, ...) composes inside the callback.
