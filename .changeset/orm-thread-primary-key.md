---
'@rudderjs/contracts':  minor
'@rudderjs/orm':        minor
'@rudderjs/orm-prisma': patch
'@rudderjs/orm-drizzle': patch
---

Thread `Model.primaryKey` through the `OrmAdapter` contract so models with
`static primaryKey = 'uuid'` (or any non-`id` PK) work on both adapters.

`OrmAdapter.query(table, opts?)` now accepts an optional `OrmAdapterQueryOpts`
with a `primaryKey` field. `Model._q()` + `Model.query()` thread the model's
configured `primaryKey` through it. The Prisma adapter, which previously
hardcoded `where: { id }` on every mutation method, now emits
`where: { [primaryKey]: id }` — fixing `find` / `update` / `delete` / `restore`
/ `forceDelete` / `increment` / `decrement`. The Drizzle adapter, which
previously read a single adapter-global `primaryKey` from `drizzle()` config,
now lets the per-query opts override it — so monorepos with mixed PKs
(`users.id` + `subscriptions.uuid`) work without forcing every model onto the
same PK.

The contract widen is fully backwards-compatible: `opts` is optional, both
adapters fall back to the historical `'id'` (Prisma) / adapter-global
(Drizzle) when no opts are threaded. Third-party adapters that haven't
been updated keep working for `id`-PK models.

Closes Phase 2 of `docs/plans/2026-05-21-framework-orm-correctness.md`.
Required prerequisite for the Phase 1 `find()` fix shipped in #582 to work
correctly with non-`id` PK models.
