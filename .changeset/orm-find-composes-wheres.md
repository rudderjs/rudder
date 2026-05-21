---
'@rudderjs/orm-prisma': patch
'@rudderjs/orm-drizzle': patch
---

fix(orm): `find(id)` composes accumulated wheres / scopes / soft-deletes

Previously, `Model.find(id)` bypassed the query chain entirely on both adapters. `User.where('tenantId', t).find(5)` would return rows across tenants — a cross-tenant data leak by default. Drizzle honored the soft-delete scope but ignored everything else; Prisma ignored all of it.

The fix:

- **Prisma**: `find()` now uses `findFirst` (was `findUnique`) so the PK match can be AND-composed with the accumulated where chain, soft-delete filter, global scopes, and relation predicates. Empty chain stays as `{ id }` — no needless `AND` wrapper.
- **Drizzle**: `find()` now uses the same `buildConditions()` aggregator that `get()` does, so it composes wheres + orWheres + soft-delete + `whereGroup` / `whereRelationExists` subqueries with the PK match. Drops the manual soft-delete-only branch.

Regression tests added on both adapters:
- Drizzle (real in-memory sqlite via integration suite): `where('age', '>=', 31).find(aliceId)` returns null when Alice is 30; `where('age', '>=', 30).find(aliceId)` resolves her.
- Prisma (capturing client): asserts `findFirst` (not `findUnique`) is called; verifies the composed `{ AND: [{ id }, { tenantId }] }` shape; confirms unchained `find(id)` stays as plain `{ id }`.

Note: this fix uses the existing `id` literal as the primary key column. The companion plan phase (`docs/plans/2026-05-21-framework-orm-correctness.md` Phase 2) covers threading `Model.primaryKey` through the adapter contract for non-`id` PK models.
