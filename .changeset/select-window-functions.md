---
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

feat: typed window functions on the native engine — `selectWindow(fn, { as, partitionBy, orderBy })` adds `ROW_NUMBER` / `RANK` / `DENSE_RANK` / `PERCENT_RANK` / `CUME_DIST` … `OVER (PARTITION BY … ORDER BY …)` projections. Additive (rows still hydrate as full models with the alias as an extra attribute), identifier-quoted throughout, identical SQL on SQLite 3.25+/Postgres/MySQL 8. Available as a `Model` static and on query chains; Drizzle/Prisma throw the forward-or-throw guard error. Aggregates-OVER / lag / lead / frames stay on the documented `selectRaw` recipe.
