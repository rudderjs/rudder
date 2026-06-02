---
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
---

feat(orm): `distinct()` — SELECT DISTINCT (Laravel parity)

`Model.query().distinct().get()` de-duplicates the result rows; pair it with `select(...)` to de-duplicate on specific columns. With `distinct()`, `count()` / `paginate()` count the distinct rows.

Native engine only — on Drizzle and Prisma it throws with a pointer to the native engine / `DB.select(...)`, consistent with joins / groupBy / union.
