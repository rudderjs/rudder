---
'@rudderjs/contracts': minor
'@rudderjs/orm': minor
'@rudderjs/orm-prisma': minor
'@rudderjs/orm-drizzle': minor
---

Nested AND/OR query groups via `whereGroup(fn)` and `orWhereGroup(fn)`.

```ts
User.query()
  .where('status', 'active')
  .whereGroup(g => g
    .where('priority', 'high')
    .orWhere('starred', true))
// WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
```

- **`QueryBuilder.whereGroup(fn)` / `orWhereGroup(fn)`** — the callback receives a fresh sub-builder. Calls inside it compose into a single grouped clause that's spliced back into the parent under AND or OR. Sub-builders are themselves `QueryBuilder<T>`, so `whereGroup` nests arbitrarily deep and `whereHas` works inside the callback.
- **Sub-builder terminals throw** — calling `get`/`first`/`find`/`count`/`paginate`/etc. on the inner builder errors with `Sub-builder is for where* chaining only — call get() on the parent builder.` Empty groups (`whereGroup(g => g)`) are a no-op.
- **Adapters** — Prisma emits `AND: [...]` / `OR: [...]` array form only when groups are present, so the existing flat-spread shape is preserved for code that doesn't use the new API. Drizzle wraps the captured clauses with `and()` / `or()` SQL helpers and appends to the parent.

Pure addition — no behavior change for existing `where`/`orWhere` chains. Mirrors the callback shape of the existing `whereHas(rel, fn)` API.
