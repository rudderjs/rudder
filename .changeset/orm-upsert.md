---
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/contracts": minor
---

feat(orm): `Model.upsert(rows, uniqueBy, update?)` — bulk insert-or-update across native, Drizzle, and Prisma

Adds Laravel's bulk upsert. Insert every row; on a unique-key conflict (the
`uniqueBy` columns) update the `update` columns from the incoming values instead
of failing. `update` defaults to every inserted column except `uniqueBy`; an
empty list means insert-or-ignore. Returns the number of rows affected.

```ts
await User.upsert(
  [{ email: 'a@x.com', name: 'Ada' }, { email: 'b@x.com', name: 'Bob' }],
  'email',     // uniqueBy (single column or string[])
  ['name'],    // overwrite on conflict; omit → all inserted columns minus uniqueBy
)
```

- **native** — one atomic statement: `ON CONFLICT (…) DO UPDATE / DO NOTHING`
  (SQLite/Postgres) or `ON DUPLICATE KEY UPDATE` (MySQL), via a new
  `Dialect.upsertClause()` seam + `compileInsert({ upsert })`.
- **Drizzle** — `onConflictDoUpdate` / `onConflictDoNothing` (SQLite/Postgres) or
  `onDuplicateKeyUpdate` (MySQL).
- **Prisma** — no portable bulk ON CONFLICT, so each row maps to a single-row
  `delegate.upsert` batched in one `$transaction`.
- **`@rudderjs/contracts`** — new optional `QueryBuilder.upsert?(rows, uniqueBy,
  update)`; the Model layer throws an adapter-named error if an adapter omits it.

Like `insertMany`, upsert is a bulk write: `fillable`/`guarded` do **not** apply
(write-side casts/mutators still do) and observer events do **not** fire. A
matching UNIQUE constraint on `uniqueBy` must exist. MySQL's returned count is
rows-touched (1 per insert, 2 per update), not rows-distinct.
