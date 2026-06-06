# Pivot `sync()` (and id-based pivot ops) need loose id comparison

**Filed by:** pilotiq agent, 2026-06-06
**Package:** `@rudderjs/orm` — `src/relations/pivot-accessors.ts`
**Severity:** runtime 500 on a mainstream path (HTML form → M2M sync on numeric-PK models)

## Symptom

`UNIQUE constraint failed: article_tag.articleId, article_tag.tagId` when calling
`parent.tags().sync(["1", "3"])` on a parent whose pivot rows store **numeric** ids.

## Root cause

`sync()` diffs desired vs current with strict `Set.has()`:

```ts
const current = new Set(currentRows.map(r => r[meta.relatedPivotKey]))  // numbers from the DB
const desired = new Set<unknown>(desiredIds)                            // strings from a form body
for (const id of desired) if (!current.has(id)) attached.push(id)       // "3" !== 3 → re-attach
```

Anything that flows ids out of an HTML form (pilotiq's
`SelectField.multiple().relationship()`, any user code that syncs from a request body)
hands over strings. On string-PK models (ULIDs) this is invisible; on
autoincrement-PK models every sync with an already-attached id throws.

## Suggested fix

1. **Diff with String() normalization** in `sync()`:
   `const currentByStr = new Map(currentRows.map(r => [String(r[key]), r[key]]))` —
   compare on the string form, but keep the **raw DB value** for the detach `IN (...)`
   list and the per-id pivot-extras map lookup (`perIdMap` keys arrive as strings via
   `Object.keys` already — today's `/^\d+$/ → Number` re-parse there is the same
   normalization done halfway).
2. **Coerce attach ids to the observed PK type** when inserting: if current rows (or the
   related model's PK column) are numeric and the incoming id is a numeric string,
   insert the number. SQLite affinity forgives a string here; the Prisma/Drizzle
   adapters won't.
3. Sweep the sibling ops for the same comparison: `attach()` (consider de-duping against
   existing rows instead of relying on the UNIQUE constraint), `detach([ids])`,
   `updatePivot(relatedId, …)`, and `syncWithoutDetaching` if/when it lands.

## Workaround shipped pilotiq-side (can be reverted once fixed)

`@pilotiq/pilotiq@0.31.1` `syncRelationshipSelect` (src/elements/dispatchForm.ts) loads
the current relation rows itself, String()-diffs, calls `attach`/`detach` with
type-corrected ids, and only falls back to `accessor.sync()` when it can't read the
rows. Once the ORM diff is loose, that fallback path becomes safe everywhere and the
manual diff can be deleted.

## Repro

pilotiq-demo (`~/Projects/pilotiq-demo`): articles ↔ tags via `belongsToMany` with
`pivotTable: 'article_tag'`, numeric autoincrement PKs, unique index on
`(articleId, tagId)`. Edit an article that already has tags, submit the tags
multi-select unchanged → pre-0.31.1 pilotiq calls `sync(["1","3"])` → UNIQUE violation.
