# `orm/index.ts` extractions — split relation internals into siblings

> **Status:** ready
> **Date:** 2026-05-13
> **Scope:** internal refactor of `@rudderjs/orm`. No public API change. No changeset.
> **Companion finding:** `check orm code quality / docs improvements` review on 2026-05-13.
> **Reference precedent:** [`agent.ts` split (#410)](./2026-05-13-ai-agent-ts-extractions.md) — same shape, four narrow phases, type-only callback seams.

---

## TL;DR

`packages/orm/src/index.ts` is 3270 lines and holds: `ModelRegistry`, the `Model` class (1723 LOC), all relation internals (whereHas, deferred pivot proxy, three pivot accessors), and the auto-install hooks. The relation internals (~1150 LOC, lines 2117–3268) are genuinely self-contained — they only touch `Model` through public-shaped statics + the QueryBuilder contract — and naturally split into three sibling files behind a shared `src/utils.ts`.

```
Phase 0 → src/utils.ts                       (~30 LOC out, 3 shared helpers)
Phase 1 → src/relations/where-has.ts         (~220 LOC out, predicate builder)
Phase 2 → src/relations/pivot-deferred.ts    (~250 LOC out, deferred read Proxy)
Phase 3 → src/relations/pivot-accessors.ts   (~500 LOC out, attach/detach/sync)
```

After all four phases: `index.ts` shrinks from 3270 → ~2270 (–30%). Splitting the remaining `Model` class is **out of scope** here — it's a separate plan once the relation extraction lands.

Run after each phase:
```bash
pnpm --filter @rudderjs/orm typecheck && pnpm --filter @rudderjs/orm test
```

All existing tests must stay green at every checkpoint.

---

## Goals / Non-goals

**Goals**
- Shrink `index.ts` by ~1000 LOC by moving relation internals behind clean module seams.
- Collapse the three near-identical pivot accessor factories (`_makeBelongsToManyAccessor`, `_makeMorphToManyAccessor`, `_makeMorphedByManyAccessor` — ~95% duplicate code today) behind a shared `_makePivotAccessor(..., morphConstraint?)` factory once they're co-located in `pivot-accessors.ts`.
- Export `_camelHead` from a shared `utils.ts` so `aggregate.ts` and the new relation files don't each redefine it.

**Non-goals (this plan)**
- Splitting the `Model` class itself (1723 LOC at index.ts:393–2116). Needs its own plan — likely along `model-query.ts` / `model-serialization.ts` / `model-events.ts` lines, but the relation extraction must land first to make the seams visible.
- Tightening the **38** `as unknown as` casts in `index.ts` (mostly around `Model._q()` and aggregate methods). Symptom of the `QueryBuilder<T>` contract diverging from the hydrating Proxy `_q()` actually returns. Address in a separate hygiene PR — `_q()` return type needs to widen, callers need to narrow.
- Moving decorators (`Hidden`/`Visible`/`Appends`/`Cast` at index.ts:322–392) and `ModelRegistry` to siblings. Both are small (<100 LOC each) and cleanly defined; not worth the seam.
- Touching `src/aggregate.ts` — already a sibling file, already well-organized. (The `orWhere` fix shipped separately in the same branch as this plan was authored.)

---

## Pre-flight

From `packages/orm/`:

```bash
pnpm typecheck   # expect clean
pnpm test        # expect green
```

Baseline must be green before starting. If anything fails on `main`, stop and investigate.

---

## Phase 0 — Extract `src/utils.ts`

Three tiny helpers that are about to be needed from two new sibling files plus the existing `aggregate.ts`. Extracting first avoids each new sibling re-importing through `index.js`.

**Symbols to move:**

| Symbol | Current location | Notes |
|---|---|---|
| `_camelHead` | `index.ts:2140`, `aggregate.ts:129` | Defined **twice today**. Dedupe in this phase. |
| `_attrEqual` | `index.ts:2117` | Used by dirty tracking + relation code. |
| `_capitalize` | `aggregate.ts:101` | Used by aggregate suffix generator + (about to be used by) pivot accessors. |

**New file shape:**

```ts
// src/utils.ts
export function camelHead(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

export function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function attrEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
  }
  return false
}
```

Drop the leading `_` — these are now module-public. Internal-only naming was a `// @internal` convention that doesn't survive cross-file imports cleanly.

**Seam in `index.ts` and `aggregate.ts`:** replace each local definition with `import { camelHead, attrEqual, capitalize } from './utils.js'`. Confirm via grep that no third site exists.

**Verify:** `pnpm typecheck && pnpm test` — green.

---

## Phase 1 — Extract `src/relations/where-has.ts`

The relation-existence predicate builder and the four `_attach*` mounting helpers. All operate purely on the QueryBuilder contract; the only `Model` coupling is via `typeof Model` statics (`primaryKey`, `table`, `softDeletes`).

**Symbols to move (index.ts → relations/where-has.ts):**

| Symbol | Lines in index.ts | Notes |
|---|---|---|
| `type _HasOrBelongsToDef` | 2301–2307 | Pull through, rename to `HasOrBelongsToDef` (no longer file-private). |
| `_resolveBelongsToFor` | 2309–2352 | |
| `_captureConstraintWheres` | 2247–2299 | The recording Proxy that captures `where()` calls. **Includes the `orWhere` throw at line 2272–2278** — leave that error message untouched. |
| `_attachWhereHas` | 2354–2375 | |
| `_buildRelationPredicate` | 2377–2485 | The biggest piece. Handles all relation types' `RelationExistencePredicate` shape (parent/related cols, morph extraEquals, pivot through). |
| `_attachWithWhereHas` | 2487–2505 | |
| `_attachWhereBelongsTo` | 2507–2525 | |

**New file shape:**

```ts
// src/relations/where-has.ts
import type { QueryBuilder, RelationExistencePredicate, WhereClause } from '@rudderjs/contracts'
import type { Model, RelationDefinition } from '../index.js'   // type-only — no runtime cycle
import { camelHead } from '../utils.js'

export type HasOrBelongsToDef = Exclude<RelationDefinition, { type: 'belongsToMany' | 'morphMany' | 'morphOne' | 'morphTo' | 'morphToMany' | 'morphedByMany' }>

export function resolveBelongsToFor(/* ... */) { /* ... */ }
export function captureConstraintWheres(/* ... */): WhereClause[] { /* ... */ }
export function buildRelationPredicate(/* ... */): RelationExistencePredicate { /* ... */ }
export function attachWhereHas<TQ>(/* ... */) { /* ... */ }
export function attachWithWhereHas<TQ>(/* ... */) { /* ... */ }
export function attachWhereBelongsTo<TQ>(/* ... */) { /* ... */ }
```

**Seam in `index.ts`:** replace the moved blocks with `import { attachWhereHas, attachWithWhereHas, attachWhereBelongsTo } from './relations/where-has.js'` near the existing imports. The three `_attach*` functions are called from `Model.whereHas` / `Model.withWhereHas` / `Model.whereBelongsTo` static methods (search the file for callsites — they're inside the `Model` class block).

**Risk to watch:** `_buildRelationPredicate` calls `def.model() as typeof Model`. Moving it out doesn't break the closure (the thunk is already deferred), but the **type** import of `Model` must be type-only (`import type`) to avoid a runtime cycle.

**Verify:** `pnpm typecheck && pnpm test` — green. The canonical coverage is `whereHas.test.ts` (471 LOC).

---

## Phase 2 — Extract `src/relations/pivot-deferred.ts`

The Proxy that lets pivot reads stay chainable while deferring the actual lookup to terminal evaluation. Three deferred-QB builders, one for each pivot relation type.

**Symbols to move:**

| Symbol | Lines in index.ts | Notes |
|---|---|---|
| `const _CHAIN_METHODS` | 2527–2528 | |
| `const _TERMINAL_METHODS` | 2530–2531 | |
| `const _UNSUPPORTED_TERMINALS` | 2533–2545 | |
| `type QbAsDict` | 2546 | |
| `_replayChain` | 2548–2555 | |
| `interface DeferredProxyHooks` | 2557–2566 | |
| `_makeDeferredProxy` | 2567–2617 | |
| `_stampPivotOnRows` | 2619–2642 | |
| `_stampPivotOnResult` | 2644–2668 | |
| `_belongsToManyDeferredQb` | 2670–2701 | Uses `BelongsToManyMeta` (from index.ts:2129). Move that interface here too, or re-export from `pivot-accessors.ts` — see below. |
| `_morphToManyDeferredQb` | 2703–2733 | |
| `_morphedByManyDeferredQb` | 2735–2772 | |
| `interface BelongsToManyMeta` | 2129–2135 | |
| `interface MorphToManyMeta` | 2179–2191 | |
| `interface MorphedByManyMeta` | 2193–2205 | |
| `_resolveBelongsToManyMeta` | 2162–2174 | |
| `_resolveMorphToManyMeta` | 2207–2221 | |
| `_resolveMorphedByManyMeta` | 2223–2245 | |
| `_morphParentQuery` | 2144–2161 | Used by `Model.related()` for `morphMany` / `morphOne`. Stays usable from index.ts via re-export. |

**New file shape:**

```ts
// src/relations/pivot-deferred.ts
import type { QueryBuilder } from '@rudderjs/contracts'
import type { Model, RelationDefinition } from '../index.js'
import { camelHead } from '../utils.js'

export interface BelongsToManyMeta { /* ... */ }
export interface MorphToManyMeta   { /* ... */ }
export interface MorphedByManyMeta { /* ... */ }

export function resolveBelongsToManyMeta(/* ... */): BelongsToManyMeta { /* ... */ }
export function resolveMorphToManyMeta(/* ... */):   MorphToManyMeta   { /* ... */ }
export function resolveMorphedByManyMeta(/* ... */): MorphedByManyMeta { /* ... */ }

export function morphParentQuery(/* ... */): QueryBuilder<Model> { /* ... */ }
export function belongsToManyDeferredQb(/* ... */): QueryBuilder<Model> { /* ... */ }
export function morphToManyDeferredQb(/* ... */):   QueryBuilder<Model> { /* ... */ }
export function morphedByManyDeferredQb(/* ... */): QueryBuilder<Model> { /* ... */ }
```

The chain-method registries and the Proxy factory stay file-private inside `pivot-deferred.ts` — only the three `*DeferredQb` builders are the public-to-`index.ts` surface (plus `morphParentQuery` for the non-pivot `morphMany`/`morphOne` `related()` path).

**Seam in `index.ts`:** the three deferred builders are called from `Model.related(name)` (search the file). Replace with imports. The morph parent query is called from the same dispatch.

**Verify:** `pnpm typecheck && pnpm test` — green. Coverage in `belongs-to-many-pivot.test.ts`, `morph-many-to-many.test.ts`, `morph.test.ts`.

---

## Phase 3 — Extract `src/relations/pivot-accessors.ts`

The three pivot-mutation accessors (`attach` / `detach` / `sync`) and the auto-install hooks. **This is where the dedup happens** — the three accessor factories share ~95% of their bodies today.

**Symbols to move:**

| Symbol | Lines in index.ts | Notes |
|---|---|---|
| `type AttachInput` | 2774 | |
| `_normalizeAttachInput` | 2776–2805 | |
| `_idsFromAttachInput` | 2807–2820 | |
| `interface BelongsToManyAccessor` | 2822–2863 | Already exported. |
| `interface MorphToManyAccessor` | 2995–3013 | Already exported. |
| `interface MorphedByManyAccessor` | 3015–3029 | Already exported. |
| `_makeBelongsToManyAccessor` | 2865–2972 | |
| `_makeMorphToManyAccessor` | 3031–3132 | |
| `_makeMorphedByManyAccessor` | 3134–3242 | |
| `_installBelongsToManyMethods` | 2974–2993 | Called by `Model` static init / first-query hook. |
| `_installMorphPivotMethods` | 3244–3267 | |

**Required dedup step (the value of moving this code):**

```ts
// src/relations/pivot-accessors.ts
// Extract the shared core:
function makePivotAccessor(
  parent:   Model,
  related:  typeof Model,
  meta:     PivotMeta,                       // unified shape across the three variants
  morphConstraint?: { typeColumn: string; typeValue: string },
): PivotAccessor { /* attach / detach / sync — single implementation */ }

export function makeBelongsToManyAccessor(/* ... */): BelongsToManyAccessor {
  return makePivotAccessor(parent, related, meta) as BelongsToManyAccessor
}

export function makeMorphToManyAccessor(/* ... */): MorphToManyAccessor {
  return makePivotAccessor(parent, related, meta, { typeColumn, typeValue: ownerType }) as MorphToManyAccessor
}

export function makeMorphedByManyAccessor(/* ... */): MorphedByManyAccessor {
  return makePivotAccessor(parent, related, meta, { typeColumn, typeValue: relatedType }) as MorphedByManyAccessor
}
```

The unified `PivotMeta` is the union of the three `*Meta` interfaces from Phase 2 — just `{ pivotTable, foreignPivotKey, relatedPivotKey, parentKey, relatedKey }` since both morph variants already extend that shape.

**Seam in `index.ts`:** the three `_install*` functions are called from `Model.related()` or the first-query lifecycle hook. Replace with imports.

**Risk to watch:** the auto-install hooks mutate `ModelClass.prototype` (define a method named after the relation). Crossing module boundaries doesn't change this — methods are still installed on the correct prototype because the install function receives the class by reference. Don't try to tighten to a static-only install during this extraction.

**Verify:** `pnpm typecheck && pnpm test` — green. The dedup means slight code-coverage shape changes; eyeball `belongs-to-many-pivot.test.ts` + `morph-many-to-many.test.ts` to confirm both still cover all three accessor variants (they should — tests call through `.attach()` etc., not the factory directly).

---

## Wrap-up

After all four phases:

```bash
pnpm --filter @rudderjs/orm typecheck
pnpm --filter @rudderjs/orm test
pnpm --filter @rudderjs/orm build        # clean dist/
```

**Sanity greps** — confirm no stragglers:

```bash
# These should be empty (all moved out)
grep -nE 'function _camelHead|function _attrEqual|function _captureConstraintWheres' packages/orm/src/index.ts
grep -nE 'function _buildRelationPredicate|function _attachWhereHas' packages/orm/src/index.ts
grep -nE 'function _makeDeferredProxy|function _belongsToManyDeferredQb' packages/orm/src/index.ts
grep -nE 'function _makeBelongsToManyAccessor|function _makeMorphToManyAccessor|function _makeMorphedByManyAccessor' packages/orm/src/index.ts

# These should each have exactly one definition site
grep -rn 'export function camelHead' packages/orm/src/
grep -rn 'export function buildRelationPredicate' packages/orm/src/
grep -rn 'function makePivotAccessor' packages/orm/src/
```

**Expected new line counts** (approximate):
- `index.ts`: 3270 → ~2270 (–30%)
- `src/utils.ts`: ~30 LOC (new)
- `src/relations/where-has.ts`: ~220 LOC (new)
- `src/relations/pivot-deferred.ts`: ~250 LOC (new)
- `src/relations/pivot-accessors.ts`: ~430 LOC (new — smaller than the sum of three factories because of dedup)

**Test script note** — per memory `feedback_orm_test_script_explicit_files.md`, `packages/orm/package.json` test script enumerates each `dist-test/*.test.js`. **No new test files are added by this plan** — the existing suite (`whereHas.test.ts`, `belongs-to-many-pivot.test.ts`, `morph-many-to-many.test.ts`, `morph.test.ts`, `aggregate.test.ts`) covers all moved code. If a regression surfaces during execution, add the test and the package.json entry in the same commit.

**Public API check** — confirm `git diff main -- packages/orm/src/index.ts` after Phase 3 still re-exports the same surface. The `export type { ... }` block at the top of `index.ts` (lines 17–34) must stay byte-identical. If `BelongsToManyAccessor` / `MorphToManyAccessor` / `MorphedByManyAccessor` move out, add `export type { ... } from './relations/pivot-accessors.js'` to compensate.

**PR title:** `refactor(orm): split index.ts relation internals into utils / relations/{where-has,pivot-deferred,pivot-accessors}`

**Changeset:** none. Pure internal refactor — public exports unchanged, no behavioral change.

**Recommended PR strategy:** single PR with the four phases as four commits. Same justification as the `agent.ts` split — cohesive multi-piece work, test suite covers every checkpoint.

---

## Risk notes

- **Type-only cycle.** `where-has.ts`, `pivot-deferred.ts`, `pivot-accessors.ts` all need `Model` and `RelationDefinition` types from `index.ts`. **Always use `import type`** — runtime imports would create a true cycle (Model class evaluates → relation files → Model class). Same pattern used in `agent.ts` split for `LoopContext`.
- **Adapter contract surface.** `_buildRelationPredicate` writes the `RelationExistencePredicate` interface defined in `@rudderjs/contracts`. Moving it doesn't change the adapter contract — both Prisma and Drizzle adapters call into the same shape. No adapter changes needed.
- **`Model.hydrate()` and `_q()` callers.** The hydrating QueryBuilder Proxy (introduced in PR #111) wraps adapter results. Relation code at `_makeDeferredProxy` builds *its own* Proxy for pivot reads — these are distinct mechanisms but use overlapping naming. Don't try to unify them during the extraction; they have different invariants (hydration is read-time wrapping, deferred is terminal-time evaluation).
- **`AggregateConstraintBuilder` is out of scope.** Already in its own file (`aggregate.ts`). The `orWhere` cleanup ships separately. If the index split lands after that PR merges, no conflict; if it lands before, the `aggregate.ts` re-export is unchanged.
