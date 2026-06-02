---
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm": minor
"@rudderjs/contracts": minor
---

feat(orm-drizzle): real eager loading for `Model.with()` on the Drizzle adapter

`Model.with('relation').get()` now actually eager-loads direct relations on the
Drizzle adapter, replacing the throw added in #826. Drizzle's adapter can't
resolve a relation from its name alone (its relational query API needs
pre-declared `relations()` schemas the adapter doesn't hold), so resolution
moves to the ORM's Model layer:

- `@rudderjs/contracts` — new optional `OrmAdapter.eagerLoadStrategy?: 'native' |
  'model-layer'`. Omitted/`'native'` (Prisma) forwards relation names to the
  adapter's `with()`/`include`; `'model-layer'` routes direct relations into the
  Model-layer batched loader.
- `@rudderjs/orm` — `partitionEagerLoads` gains a strategy param and a `direct`
  lane; a new `attachDirectRelations` fires one batched `WHERE … IN` query per
  relation against the related model and stitches the results onto each parent
  (mirroring the existing polymorphic loader). Covers `hasOne`, `hasMany`,
  `belongsTo`, `belongsToMany`. Undeclared / nested (`'a.b'`) names throw a clear
  error. Foreign-key conventions match the lazy `related()` accessor.
- `@rudderjs/orm-drizzle` — `DrizzleAdapter` advertises
  `eagerLoadStrategy: 'model-layer'`, so `Model.with(...)` works. The QB-level
  `with()` still throws, but only via the `withWhereHas` constrained-eager
  fallback, which Drizzle still can't satisfy — use `whereHas` + `related()`
  there.

Prisma is unaffected (it omits `eagerLoadStrategy`, keeping native `include`).
