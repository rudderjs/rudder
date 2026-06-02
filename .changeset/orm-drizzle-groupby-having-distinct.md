---
'@rudderjs/orm-drizzle': minor
---

Real `groupBy` / `having` / `distinct` on the Drizzle adapter

`groupBy(...cols)`, `having`/`orHaving`/`havingRaw`/`orHavingRaw`, and `distinct()` now build native Drizzle queries instead of throwing — mapping onto Drizzle's `.groupBy()`, `.having()` and `.selectDistinct()`. `count()`/`paginate()` of a grouped or distinct builder wrap the projection as a subquery and `COUNT(*)` its rows, so they return the group count / distinct-row count (Laravel parity). The grouped count path projects just the GROUP BY keys for strict-dialect portability. Aggregate projections (`COUNT(*) AS total`) still require `selectRaw` (which throws on Drizzle) → filter aggregates with `havingRaw('COUNT(*) > ?', [n])`. `union`/`unionAll` remain a separate follow-up.
