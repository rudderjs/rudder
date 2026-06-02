---
"@rudderjs/orm": minor
---

feat(orm): `chunk()` / `lazy()` — memory-bounded iteration over large result sets

Adds Laravel's `chunk` and `lazy` to the query builder (and as Model statics), so
you can process huge tables without loading every row at once.

```ts
// Pages of 200; return false to stop early.
await User.query().orderBy('id').chunk(200, async (users) => { … })

// Async iterator, 1000 rows per page by default.
for await (const user of User.query().orderBy('id').lazy()) { … }
```

Both page the query via the existing `LIMIT`/`OFFSET` primitives at the Model
layer — no adapter or contract changes, so every adapter (native, Prisma,
Drizzle) supports them. `chunk` re-queries per page and resolves `true` (ran to
completion) or `false` (callback bailed); `lazy(size?)` returns an async
generator. Add an `orderBy` for stable paging (offset paging needs a consistent
sort, same as Laravel's `chunk`).
