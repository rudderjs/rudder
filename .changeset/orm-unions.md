---
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
---

feat(orm): `union` / `unionAll` — combine queries (Laravel parity)

`base.union(other)` / `base.unionAll(other)` combine the current query with another (`UNION` removes duplicate rows, `UNION ALL` keeps them). The combined result takes the base query's `ORDER BY` / `LIMIT` / `OFFSET`; `count()` / `paginate()` count the combined rows.

Native engine only — on Drizzle and Prisma these throw with a pointer to the native engine / `DB.select(...)`, consistent with joins/groupBy. `other` must be another native `Model.query()`.
