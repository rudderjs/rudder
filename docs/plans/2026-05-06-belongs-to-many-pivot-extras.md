# Plan: `belongsToMany` pivot-extras read + update

**Filed:** 2026-05-06 by Claude Opus 4.7
**Driver:** pilotiq
**Status:** Done (PR #251, merged 2026-05-06)

---

## Why

Filament's M2M `Repeater` lets users edit pivot-table extra columns
inline (e.g. `role` on a `users_roles` pivot table where each link
has its own role). Pilotiq's `Repeater.relationship` shipped M2M in
2026-05-05 but had to ship without pivot-extras support because the
rudder ORM doesn't surface pivot columns on read.

Concrete user-facing example:

```sql
CREATE TABLE users_roles (
  userId INT,
  roleId INT,
  role TEXT,        -- pivot-extra: each link has a role like 'owner' or 'editor'
  PRIMARY KEY (userId, roleId)
);
```

The user wants the pilotiq Repeater to surface `role` as an editable
column per row. Today it can't — when pilotiq calls
`parent.related('roles').get()`, the join's pivot row is read by the
adapter, but every column except the related id is discarded.

**`attach()` already accepts per-id pivot data** via the
`Record<id, Record<string, unknown>>` map form (see
`packages/orm/src/index.ts:2655` — `AttachInput`). So the *write* side
on insert is already covered. What's missing is **read**, **update**,
and **per-id `sync`**.

Pilotiq plan + memory:
- `~/Projects/pilotiq/docs/plans/repeater-relationship-m2m.md` ("Remaining gaps")
- `project_pilotiq_repeater_relationship.md`
- `feedback_relations_belongstomany_deferred.md`

---

## Current state — rudder

### Read path (the main blocker)

`packages/orm/src/index.ts:2575-2598` —
`_belongsToManyDeferredQb(Related, def, meta, parentVal)`:

```ts
const pivotRows = await adapter.query(meta.pivotTable)
  .where(meta.foreignPivotKey, parentVal)
  .get()
const ids = pivotRows.map(r => r[meta.relatedPivotKey])  // ← drops extras
const q = Related.query().where(meta.relatedKey, 'IN', ids)
return _replayChain(q, recorded)
```

Pivot rows are loaded — the adapter has them in memory — but every
column except `relatedPivotKey` is thrown away before the second-step
query runs. The `Related` rows that come back have no `pivot` field.

The same shape repeats for `_morphToManyDeferredQb` (line 2600) and
`_morphedByManyDeferredQb` (line 2624).

### Update path

There is no API for updating an existing pivot row. Only `attach`
(insert), `detach` (delete), and `sync` (insert + delete diff). To
change a single pivot row's extras today you have to detach + attach,
which is racy under concurrent writes and silently destroys any
columns you don't re-supply.

### `sync` per-id pivot data

`packages/orm/src/index.ts:2723-2726`:

```ts
sync(
  desiredIds: ReadonlyArray<number | string>,
  flatPivot?: Record<string, unknown>,
): Promise<{ attached: unknown[]; detached: unknown[] }>
```

`flatPivot` applies uniformly across every newly-attached row. There's
no per-id map form (which `attach` already has).

---

## Current state — pilotiq

### Load (would consume the new read API)

`packages/pilotiq/src/elements/dispatchForm.ts:1587-1595`:

```ts
export async function loadRelationRows(parentModel, parent, name) {
  const q = resolveRelatedQuery(parentModel, parent, name)
  const result = await q.paginate(1, 10000)
  return result.data
}
```

Today each row in `result.data` is a plain `Related` instance with no
pivot extras. After this plan, with `withPivot()` declared, each row
would carry `row.pivot = { role: 'owner' }`.

### Save (would consume the new update API)

`packages/pilotiq/src/elements/dispatchForm.ts:1561` calls
`m2mAccessor.attach([newPk])` for new rows and
`m2mAccessor.detach([pkVal])` (line 1573) for removed rows. With
pivot-extras editing wired through, the pilotiq pipeline needs:

- **New row with pivot extras**: `attach({ [newPk]: { role: 'owner' } })`
  → already works on the rudder side.
- **Existing row with changed pivot extras**: `updatePivot(id, { role: 'editor' })`
  → does NOT exist today; this plan adds it.
- **Bulk replace**: `sync({ [id1]: {…}, [id2]: {…} })` with per-id
  map → does NOT exist today; this plan adds it.

---

## Proposed API

### 1. `QueryBuilder.withPivot(...columns)` — read projection

Declare which pivot columns to surface on each loaded `Related` row:

```ts
parent.related('roles').withPivot('role', 'assignedAt').get()
// → [{ ...role, pivot: { role: 'owner', assignedAt: '2026-…' } }, …]
```

- Variadic list of column names from the pivot table.
- The deferred QB stores the projection; when it resolves, the
  adapter loads the requested columns from the in-memory pivot rows
  and stamps them onto each related row under `row.pivot = { … }`.
- No-op when not called — no `pivot` field is added; existing
  consumers see unchanged behavior.
- `withPivot()` with no arguments throws (no implicit "all columns" —
  forces the developer to declare the contract explicitly).

Implementation: extend the deferred-QB closure (line 2575) to keep a
`pivotColumns: string[]` slot (recorded alongside the existing
`recorded` chain). When `buildResolved` runs, after the second-step
query returns, walk the loaded rows, look up each row's pivot row
from the in-memory `pivotRows` array (keyed by `relatedKey ↔
relatedPivotKey`), and copy the requested columns onto `row.pivot`.

For polymorphic siblings (`_morphToManyDeferredQb`,
`_morphedByManyDeferredQb`), apply the same shape.

### 2. `BelongsToManyAccessor.updatePivot(relatedId, data)` — update

Update extras on an existing pivot row without touching either side
of the relation:

```ts
parent.roles().updatePivot(roleId, { role: 'editor' })
```

- Locates the pivot row matching
  `(foreignPivotKey = parentVal, relatedPivotKey = relatedId)` and
  applies the patch.
- Returns the number of rows updated (0 if no match — does NOT throw,
  caller decides whether absence is an error).
- Does NOT modify the parent or related rows themselves.
- Does NOT change which pivot columns are tracked — only the columns
  in `data` are written.
- Polymorphic siblings: `MorphToManyAccessor.updatePivot` /
  `MorphedByManyAccessor.updatePivot` take the same shape; the
  morph-discriminator column is implicitly included in the WHERE
  clause (same posture as `detach`).

### 3. `sync` per-id pivot data

Widen `sync()`'s second arg to accept the same `Record<id, Record<…>>`
map shape that `attach` already supports:

```ts
sync(desiredIds, flatPivot?: Record<string, unknown>): Promise<…>
sync(perIdPivot: Record<string | number, Record<string, unknown>>): Promise<…>
```

With the map form, `desiredIds` is implicit (`Object.keys(perIdPivot)`).
Same diff semantics as today — attach the missing, detach what's no
longer present, **update extras on still-present ids** when their
pivot data changed.

Implementation: at line 2759 (`async sync(desiredIds, flatPivot)`),
add an overload + branch: when arg-1 is a non-array object, normalize
to `desiredIds = Object.keys(arg-1)`, derive per-id pivot from the
map. For ids that are already in the current set, run `updatePivot`
to reconcile their extras. For ids being attached, pass the per-id
pivot through `_normalizeAttachInput` (which already handles maps).

Detached counts and the return shape stay the same — add a third key
`updated: unknown[]` to surface diff stats.

### 4. (Stretch — defer if scope creeps) `orderByPivot(column, direction?)`

Filament supports sorting related rows by a pivot column. Pilotiq's
plan-doc lists this under deferred work. **Defer this** — it's a
distinct scope that adds query-builder mechanics (the second-step
query needs to ORDER BY the joined pivot's column, which is more
involved than the projection above). File a follow-up plan if a
consumer asks.

---

## Implementation

### `packages/contracts/src/index.ts`

Add `withPivot(...columns: string[]): this` to the `QueryBuilder<T>`
interface (after `with`, before `withTrashed`).

### `packages/orm/src/index.ts`

#### Read projection (lines 2575–2645)

`_belongsToManyDeferredQb` / `_morphToManyDeferredQb` /
`_morphedByManyDeferredQb`:

1. Add a `pivotColumns: string[] | null = null` slot in the closure.
2. Add `withPivot(...cols)` to the `recorded` chain — but rather than
   replaying it onto the `Related` query (which has no pivot
   awareness), capture it in the closure.
3. After `Related.query().where(meta.relatedKey, 'IN', ids).get()`
   resolves, walk the rows and stamp `row.pivot = pickPivotColumns(
   pivotRowFor(row), pivotColumns)` for each.

Add a small helper `_findPivotRowFor(rows, relatedKey, pivotRows,
relatedPivotKey)` that builds a `Map<relatedKey, pivotRow>` once and
serves lookups in O(1).

#### `updatePivot` (lines 2702–2790, 2823–2843)

Add `updatePivot(relatedId, data)` to `BelongsToManyAccessor` interface
(line 2702) + implementation (line 2737). Same for the two morph
siblings.

```ts
async updatePivot(relatedId, data) {
  return adapter.query(meta.pivotTable)
    .where(meta.foreignPivotKey, parentVal)
    .where(meta.relatedPivotKey, relatedId)
    .update({ /* row matching above */ }, data)  // see note below
}
```

The existing `.update(id, data)` on `QueryBuilder` takes a primary
key, which doesn't fit a composite pivot. Two options:

- **Option A (preferred):** add `updateAll(data)` to `QueryBuilder<T>`
  (parallel to existing `deleteAll()`), which writes `data` to every
  row matching the chained `where`s. Returns the number of rows
  updated. This is broadly useful — pilotiq has other use cases for
  it too — and matches the `deleteAll` precedent already in the
  contract (line 168 of `contracts/src/index.ts`).
- Option B: keep `update(id, data)` and special-case the pivot
  composite key. More work, less general.

Go with A. Add `updateAll(data: Partial<T>): Promise<number>` to
`QueryBuilder<T>`.

#### `sync` per-id pivot data

Overload `sync()` and branch on the first arg's shape (array vs
object). Reuse `_normalizeAttachInput` for the attach side, call
`updatePivot` (or a private helper) for the still-present-but-changed
side.

### Adapters

- **Prisma:** `withPivot` is a no-op at the adapter level — the
  closure pickup runs in `_makeBelongsToManyAccessor` after the
  adapter returns rows, so Prisma adapter doesn't need changes.
  `updateAll` translates to `prisma.<model>.updateMany`.
- **Drizzle:** same — `updateAll` becomes
  `db.update(<table>).set(data).where(<chained where>)`.

### Tests

New file `packages/orm/__tests__/belongs-to-many-pivot.test.ts`
(both adapters via existing harness):

1. `withPivot('col')` projects the column onto loaded rows.
2. `withPivot()` with no args throws.
3. `withPivot` on a row whose pivot has NULL extras → `pivot.col === null`.
4. `updatePivot(id, data)` — successful update, return value, no
   collateral on parent / related.
5. `updatePivot(id, data)` for a non-existent pivot row → returns 0.
6. `sync({ id1: { role: 'owner' }, id2: { role: 'editor' } })` —
   attaches both with correct pivot data, returns
   `{ attached, detached, updated }`.
7. `sync` with mixed (existing + new + dropped) → all three branches
   hit.
8. Polymorphic: same suite against `morphToMany` + `morphedByMany`.
9. `withPivot` + `updateAll` regression — `withPivot` doesn't break
   chains that go through `where`/`orderBy`/`paginate`.

Existing `belongs-to-many.test.ts` (or wherever today's tests live)
should still pass unchanged — this plan is purely additive.

---

## Pilotiq downstream

After this lands, pilotiq does:

1. **In `Repeater.relationship` config** — accept a new
   `.pivotColumns(['role', 'assignedAt'])` setter that the schema
   surfaces in each row's inner schema.
2. **In `pageData.applyRelationshipRepeaterFill`** — pass
   `withPivot(...cfg.pivotColumns)` through to the loader; map
   `row.pivot` onto the row's form values so each row's
   pivot-column field pre-populates.
3. **In `dispatchForm.persistRelationshipRows` (M2M branch)** — when
   a row's pivot data changed, call
   `m2mAccessor.updatePivot(rowPk, { role: newRole })`. New rows go
   through `attach({ [newPk]: pivotData })` (already supported).
4. **`feedback_relations_belongstomany_deferred.md`** memory updated
   to "shipped, pivot-extras supported via withPivot".

That's a follow-up pilotiq PR after this rudder PR merges. The plan
above is self-contained on the rudder side.

---

## Acceptance criteria

1. `QueryBuilder<T>.withPivot(...cols)` exists and is implemented for
   both adapters.
2. `BelongsToManyAccessor.updatePivot(id, data)` exists; same for
   morph siblings.
3. `BelongsToManyAccessor.sync` accepts the per-id-pivot map form;
   return value gains `updated: unknown[]`.
4. `QueryBuilder<T>.updateAll(data)` exists (precedent for future
   bulk-update needs beyond pivots).
5. `withPivot()` with no args throws "withPivot() requires at least
   one column name."
6. The deferred-QB closure correctly stamps `row.pivot` after the
   second-step query resolves; missing pivot rows leave `row.pivot`
   undefined (a `Related` row whose pivot vanished mid-query is rare
   but defensible).
7. Tests pass on both Prisma and Drizzle adapters.
8. No regression in existing `belongsToMany` / `morphToMany` /
   `morphedByMany` tests.

---

## Out of scope (deferred)

- **`orderByPivot(col, dir?)`** — see stretch note above. File a
  follow-up plan if a consumer asks.
- **`wherePivot(col, op, value)`** — filter related rows by a pivot
  column. Same posture: Filament has it, no pilotiq consumer yet.
- **Pivot-extras as their own model** (Laravel's `using(PivotModel)`)
  — too far from the structural-types-only ORM posture.
- **Transactional sync** — current `sync` runs attach + detach
  unwrapped; this plan adds update + still doesn't wrap. Partial
  failure leaves the pivot mid-state. The pilotiq Repeater pipeline
  doesn't wrap either — same posture, document the limitation.
- **`withPivotValue(col, val)` Laravel sugar** — declarative pivot
  filter for relationships that always carry a fixed pivot column
  (e.g. soft-deletes on a pivot). Not in pilotiq's path; defer.

---

## Files to modify

- `packages/contracts/src/index.ts` — `withPivot`, `updateAll` on
  `QueryBuilder<T>`
- `packages/orm/src/index.ts` —
  - `BelongsToManyAccessor.updatePivot` + impl (line ~2737)
  - `MorphToManyAccessor.updatePivot` + impl (line ~2855)
  - `MorphedByManyAccessor.updatePivot` + impl (line ~2924)
  - `_belongsToManyDeferredQb` / `_morphToManyDeferredQb` /
    `_morphedByManyDeferredQb` `withPivot` capture + post-resolve
    stamping (lines 2575, 2600, 2624)
  - `sync()` per-id pivot map overload (line ~2759, plus morph
    siblings)
  - `_findPivotRowFor` helper
- `packages/orm/src/adapters/prisma.ts` — `updateAll` translator
- `packages/orm/src/adapters/drizzle*.ts` — `updateAll` translator
  (per dialect)
- `packages/orm/__tests__/belongs-to-many-pivot.test.ts` — new

---

## Files for reference (pilotiq side, do NOT modify in this rudder PR)

- `~/Projects/pilotiq/packages/pilotiq/src/elements/dispatchForm.ts`
  — `loadRelationRows`, `persistRelationshipRows` M2M branch
- `~/Projects/pilotiq/packages/pilotiq/src/orm/m2mAccessor.ts` —
  `resolveM2MAccessor`
- `~/Projects/pilotiq/docs/plans/repeater-relationship-m2m.md` —
  "Remaining gaps" section
