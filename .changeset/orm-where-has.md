---
'@rudderjs/orm': minor
'@rudderjs/orm-prisma': minor
'@rudderjs/orm-drizzle': minor
'@rudderjs/contracts': minor
---

Eloquent-style relation predicates — `whereHas` / `whereDoesntHave` /
`withWhereHas` / `whereBelongsTo` (Laravel parity #2 PR3).

Filter a query by whether a relation has at least one matching row.
The optional callback narrows the relation predicate further — chain
plain `where()` calls inside it.

```ts
await User.whereHas('posts', q => q.where('published', true)).get()
await User.whereDoesntHave('posts').get()
await User.withWhereHas('posts', q => q.where('published', true)).get()
await Post.whereBelongsTo(user).get()
await Comment.whereBelongsTo(post, 'post').get()
```

Supported relation types: `hasMany`, `hasOne`, `belongsTo`,
`belongsToMany`, `morphMany`, `morphOne`, `morphToMany`, `morphedByMany`.
`morphTo` is intentionally not supported — the related table is dynamic,
so a single subquery can't represent it. Filter on `{morphName}Id` /
`{morphName}Type` directly when you need that semantic.

The four chainable methods are also exposed on `QueryBuilder` so
they compose with flat `where()`/`orderBy()`/etc.

**Adapter changes:**

- New `RelationExistencePredicate` type in `@rudderjs/contracts` —
  carries the structural metadata adapters need (related table, parent /
  related columns, constraint wheres, optional `extraEquals` for morph
  discriminators, optional `through` for pivot relations).
- New `whereRelationExists(predicate)` method on `QueryBuilder<T>`
  (required). Out-of-tree adapters need to implement it.
- New optional `withConstrained(relation, wheres)` method on
  `QueryBuilder<T>` for constrained eager-load.
- `@rudderjs/orm-prisma` uses native `some` / `none` filters for direct
  relations (`hasMany`/`hasOne`/`belongsTo`) — those relations must be
  declared in `schema.prisma` with the same name. Polymorphic and pivot
  paths route through a 2-step lookup so they work without a Prisma-
  declared relation. `withConstrained` maps to nested `include: { rel:
  { where } }`.
- `@rudderjs/orm-drizzle` builds correlated `EXISTS (...)` /
  `NOT EXISTS (...)` subqueries via `exists()` / `notExists()`. Every
  related table referenced from a `whereHas` call must be registered via
  `tables: { ... }` on `drizzle()` config or
  `DrizzleTableRegistry.register(name, table)`. `withConstrained` is not
  yet implemented on Drizzle — `withWhereHas` falls back to plain
  `with(relation)`.

Additive — no migration needed for existing calls.
