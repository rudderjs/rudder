---
"@rudderjs/orm": minor
---

feat(orm): `whereX` query sugar — `whereIn`/`whereNull`/`whereBetween`/`when`/`unless` + `pluck`/`value`/`sum`/`exists` terminals

Adds Laravel's everyday query-builder sugar to the Model query layer:

```ts
await User.query().whereIn('role', ['admin', 'editor']).get()
await User.query().whereNotNull('verifiedAt').whereBetween('age', [18, 65]).get()

// Conditional clauses — no if-ladders around query building.
await User.query().when(role, (q, r) => q.where('role', r)).get()
await User.query().unless(includeArchived, (q) => q.whereNull('deletedAt')).get()

// Ordering + terminals.
await User.query().latest('createdAt').limit(10).get()
const emails = await User.query().where('active', true).pluck('email')
const total  = await User.query().where('role', 'admin').sum('credits')
if (await User.query().where('email', e).exists()) { … }
```

Full set: `whereIn`/`whereNotIn`/`orWhereIn`/`orWhereNotIn`, `whereNull`/`whereNotNull`/`orWhereNull`/`orWhereNotNull`, `whereBetween`/`whereNotBetween`/`orWhereBetween`/`orWhereNotBetween`, `when`/`unless`, `latest`/`oldest`, and the scalar terminals `pluck`/`value`/`sum`/`max`/`min`/`avg`/`exists`/`doesntExist`. Each is also a `Model` static entry point (`User.whereIn(...)`, `User.sum(...)`, etc.).

Implemented entirely at the Model layer — they compose the existing `where`/`orWhere`/`whereGroup`/`orderBy`/`get`/`first`/`_aggregate` primitives in the hydrating query-builder proxy — so **every adapter (native, Drizzle, Prisma) gets them for free** with no contract or adapter changes. Typed on `HydratingQueryBuilder` (not the `QueryBuilder` contract).
