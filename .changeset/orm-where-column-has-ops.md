---
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/contracts": minor
---

feat(orm): `whereColumn` + `whereHas` OR/count operators — finishing the where/existence families

- **`whereColumn(a, b)` / `whereColumn(a, op, b)`** (+ `orWhereColumn`) — compare two
  columns with both sides identifier-quoted per dialect (unlike `whereRaw`, which is
  verbatim). Native real (new column-vs-column compiler clause); Drizzle real (column
  refs through `sql`); Prisma throws and points at `DB.select`/`whereRaw`.
- **`orWhereHas` / `orWhereDoesntHave`** — OR-rooted relation-existence predicates.
- **`has(rel, op, n)` / `orHas`** — count comparison on a relation (`has('posts', '>=', 3)`),
  compiled as `(SELECT COUNT(*) …) op n`. Defaults to `>= 1` (≡ `whereHas`).
- OR/count are **native-only**; Drizzle and Prisma throw a clear pointer (their query
  APIs can't express a count filter or an OR-rooted existence join). Plain
  `whereHas`/`whereDoesntHave` are unchanged on every adapter.

`whereColumn`/`has`/`orWhereHas` are surfaced as Model statics and on the hydrating
query builder. `RelationExistencePredicate` gains optional `boolean` + `count` fields.
