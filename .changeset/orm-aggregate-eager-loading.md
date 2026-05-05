---
'@rudderjs/orm': minor
'@rudderjs/orm-prisma': minor
'@rudderjs/orm-drizzle': minor
'@rudderjs/contracts': minor
---

Aggregate eager loading — `withCount` / `withSum` / `withMin` / `withMax` / `withAvg` / `withExists` on the QueryBuilder + `loadCount` / `loadSum` / `loadMin` / `loadMax` / `loadAvg` / `loadExists` / `loadMissing` on instances (Laravel parity #2 plan #3).

Closes the N+1 footgun for hot list pages without dropping into the adapter. Result columns are stamped onto each parent under deterministic camelCase aliases (`postsCount`, `postsSumViews`, `subscriptionExists`).

```ts
// Multi-row aggregate (parent query)
await User.query().withCount('posts').get()                              // user.postsCount
await User.query().withSum('posts', 'views').paginate(1)                 // user.postsSumViews
await User.query().withCount({
  posts: q => q.where('published', true).as('publishedPosts'),
}).get()                                                                  // user.publishedPostsCount

// Per-instance aggregate
const user = await User.find(1)
await user!.loadCount('posts')
console.log(user!.postsCount)

// Eager-load only what's missing
await user!.loadMissing('profile', 'posts')
```

**Notes:**

- `withCount` on `belongsTo` throws (always 0 or 1; use `withExists` instead). On `morphTo` throws (related table is dynamic).
- Aggregate columns are tagged on a `Symbol.for('rudderjs.orm.aggregates')` Set so `model.save()` strips them before write — they never reach the underlying schema.
- Soft deletes on the related model are applied automatically — the adapter ANDs `deleted_at IS NULL` into the aggregate subquery.
- Closure constraints (`q => q.where(...).as(...)`) cover the same surface as `whereHas` constraints.

**Adapter changes:**

- New `withAggregate(requests: AggregateRequest[])` method on `QueryBuilder<T>` (required). Out-of-tree adapters implement this single normalized shape — the public `withCount` / `withSum` / etc. overloads collapse into `AggregateRequest[]` in the orm Model layer.
- New `_aggregate(fn, column?)` method on `QueryBuilder<T>` (required, `@internal`) — single-scalar terminal used by the per-instance `loadCount` / `loadSum` / etc.
- `QueryState.aggregates: AggregateRequest[]` extends the existing state shape.
- `@rudderjs/orm-prisma` uses Prisma's native `_count.select` for direct count/exists (no second round-trip) and second-batch `groupBy` for polymorphic / pivot / numeric aggregates.
- `@rudderjs/orm-drizzle` emits one correlated subselect per aggregate in the SELECT list. Pivot-mediated aggregates JOIN through the pivot table when soft-deletes / constraints / numeric columns are involved.

Additive — no migration needed for existing calls.
