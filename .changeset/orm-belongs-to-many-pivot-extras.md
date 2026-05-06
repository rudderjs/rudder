---
'@rudderjs/contracts': minor
'@rudderjs/orm': minor
'@rudderjs/orm-prisma': minor
'@rudderjs/orm-drizzle': minor
---

Read, update, and per-id sync of pivot-table extra columns on `belongsToMany` (and morph siblings).

- **`QueryBuilder.withPivot(...columns)`** — declare which pivot columns to surface on each loaded related row. Stamps `row.pivot = { col: value, ... }` after the second-step query resolves. No-op when not called; calling with zero args throws so the contract is explicit. Works on `belongsToMany`, `morphToMany`, and `morphedByMany`.
- **`BelongsToManyAccessor.updatePivot(relatedId, data)`** — patch extras on an existing pivot row without detach/re-attach. Locates the pivot row by `(foreignPivotKey = parentVal, relatedPivotKey = relatedId)` and writes only the supplied columns; returns the number of rows updated (0 when the link doesn't exist). Same shape on the morph siblings — the discriminator column is included in the WHERE.
- **`sync(perIdPivotMap)` overload** — `sync({ id1: { role: 'owner' }, id2: { role: 'editor' } })` reconciles a desired set with per-id pivot data. Return value gains `updated: unknown[]` alongside the existing `attached` / `detached`. The single-`Record` (`flatPivot`) form is unchanged.
- **`QueryBuilder.updateAll(data)`** — bulk update every row matching the chained `where`s. Returns the affected row count. Prisma routes through `updateMany`; Drizzle uses `update().set().where()`. Parallels the existing `deleteAll()`.

Pure addition — no behavior change for code that doesn't call the new APIs. Adapter test fixtures and in-memory `QueryBuilder` test doubles pick up the two new method stubs.
