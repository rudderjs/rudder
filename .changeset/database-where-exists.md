---
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

feat: arbitrary EXISTS subqueries on the native engine — `whereExists` / `whereNotExists` / `orWhereExists` / `orWhereNotExists` on query chains (+ `Model.whereExists`/`whereNotExists` statics). The subquery is another native query (`Model.query()` chain — correlate to the outer table via qualified `whereColumn('orders.userId', 'users.id')`) or a raw SQL string with `?` placeholders + bindings. Compiles to a `[NOT] EXISTS (…)` predicate at its position in the WHERE (composes with groups, `orWhere`, sugar); for relation-shaped checks prefer `whereHas`. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
