---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
---

feat(orm): query-builder breadth — joins, structured `select()`, `groupBy` / `having`

Adds Laravel-style joins, column projection, and grouping to the query builder. The native engine fully supports them:

- **Joins** — `join` / `leftJoin` / `rightJoin` / `crossJoin`, with column-vs-column `on()` and bound `where()` conditions. Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.
- **Projection** — `select('users.id', 'posts.title')` (quoted, qualified columns; combines with `selectRaw`).
- **Grouping** — `groupBy(...columns)` + `having(col, op, value)` / `orHaving` / `havingRaw('COUNT(*) > ?', [3])` / `orHavingRaw`. With a `GROUP BY` present, `count()` / `paginate()` count the number of groups (wrapped subquery), matching Laravel.

Each is also a `Model` static (`User.join(...)`, `User.select(...)`, `User.groupBy(...)`, `User.having(...)`).

On the Drizzle and Prisma adapters these throw with a pointer to the native engine or the `DB` facade — their typed clients can't map a join/projection/grouping result back to a single hydrated model (the same reason `selectRaw` throws there). Use `@rudderjs/orm/native`, or `DB.select(sql, bindings)`.

`JoinClause` (the join-callback sub-builder type) is exported from `@rudderjs/contracts` and re-exported from `@rudderjs/orm`.
