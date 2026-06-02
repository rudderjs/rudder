---
"@rudderjs/orm": minor
---

Relations: `hasOneThrough` / `hasManyThrough` (Laravel parity). A parent reaches a distant relation through an intermediate model — e.g. `Country → hasManyThrough(Post, User)` walks `countries.id = users.countryId` then `users.id = posts.userId`.

Declared as object literals on `static relations` (same shape as the other relation types): `{ type: 'hasManyThrough', model: () => Post, through: () => User, firstKey?, secondKey?, localKey?, secondLocalKey? }`. Keys default by Laravel convention — `firstKey` = `${camelCase(Parent)}Id`, `secondKey` = `${camelCase(Through)}Id`, `localKey`/`secondLocalKey` = each model's primary key.

Both access paths resolve the two hops with batched `WHERE … IN` queries (no join SQL), entirely in the Model layer — so every adapter gets them with no contract/adapter change:

- **Lazy** — `parent.related('posts')` returns a deferred QueryBuilder (reuses the pivot deferred-proxy machinery); chain `where`/`orderBy`/etc. and terminate with `get`/`first`.
- **Eager** — `Model.with('posts')` via the Model-layer batched loader (`attachHasThrough`); always routed to the Model layer regardless of adapter eager strategy (no adapter can express the two-hop walk natively).

`whereHas` / `withCount` on a through relation throw a clear "not supported yet" error (a two-level EXISTS / aggregate is deferred) pointing at `with()` / `related()`.
