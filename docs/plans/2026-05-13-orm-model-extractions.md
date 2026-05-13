# `orm/index.ts` — Model class extractions

> **Status:** deferred 2026-05-13 — marginal win (16% LOC) not worth the churn. Plan is ready if revisited.
> **Date:** 2026-05-13
> **Scope:** internal refactor of `@rudderjs/orm`. No public API change. No changeset.
> **Companion finding:** ORM code-quality audit, follow-up to the index.ts relation-internals split (#414), cast tightening (#415), and test-cast cleanup (#416).
>
> **Pickup condition:** revisit only if `index.ts` size becomes real friction, or as the warm-up before the larger `#privateField` → TS `private` conversion that unlocks the deferred dirty/serialization/persistence cluster (~450 LOC). The plan below is intact — phases, deltas, risk notes ready to execute.

---

## TL;DR

The remaining 2150-LOC `packages/orm/src/index.ts` is dominated by a 1710-LOC `Model` class. **A full split is hard** — `Model` uses ECMAScript private fields (`#original`, `#changes`, `#instanceHidden`, `#instanceVisible`) that can't be accessed from sibling modules. The relation-internals split (#414) succeeded because that code only used public statics on `Model`.

This plan proposes a **conservative 3-phase extraction** of the parts that *don't* touch private fields, leaving the persistence / dirty-tracking / serialization code on the class. Expected delta: index.ts 2150 → ~1800 LOC (-15%). Smaller win than #414 but at the same risk level.

```
Phase 0 → src/model/events.ts          (~90 LOC out — observer dispatch + withoutEvents)
Phase 1 → src/model/mass-assignment.ts (~30 LOC out — _isFillable / _filterFillable)
Phase 2 → src/model/upsert.ts          (~80 LOC out — firstOrCreate / updateOrCreate)
```

Phases 3–5 (`dirty`, `serialization`, `persistence`) are **explicitly out of scope** in this plan — see the deferred section below.

Run after each phase:
```bash
pnpm --filter @rudderjs/orm typecheck && pnpm --filter @rudderjs/orm test
```

---

## Why a full Model split is hard

`Model` uses ECMAScript private fields:

```ts
#instanceHidden?: string[]
#instanceVisible?: string[]
#original: Record<string, unknown> = {}
#changes: Record<string, unknown> = {}
```

These are *not* accessible from sibling files — that's the language guarantee. Any method that reads or writes them must remain on the class. The methods involved:

- **Dirty tracking** (`isDirty`, `isClean`, `wasChanged`, `getOriginal`, `getChanges`, `getDirty`) — read `#original` and `#changes`.
- **Persistence** (`save`, `update`, `delete`, `restore`) — write `#original` via `_syncOriginal()`.
- **Serialization** (`toJSON`) — read `#instanceHidden` / `#instanceVisible`.
- **`makeHidden` / `makeVisible`** — write the instance arrays.

Three escape hatches exist, none clean:

1. **Convert `#privateField` to TS `private field`** — caller can still bypass via `(this as any)`, ESLint will need new disables. Loses the runtime guarantee.
2. **Add accessor getters** like `_dirtyState()` — leaks the abstraction, every sibling file needs the getter call.
3. **WeakMap state outside the class** — overkill, breaks devtools introspection.

None of these justify the churn. **Keep the private-field-touching methods on the class.** That's the honest constraint.

---

## What's actually movable

Members that touch only public class statics or pure arguments:

| Member | Lines | Why movable |
|---|---|---|
| `static _fireEvent` | 703–731 | Reads `_observers` / `_listeners` (TS private — accessible via parameter) |
| `static observe` / `on` / `clearObservers` / `withoutEvents` | 685–737, 1221 | Same |
| `static _isFillable` / `_filterFillable` | 1240–1258 | Pure static (reads `fillable` / `guarded` arrays) |
| `static firstOrCreate` / `updateOrCreate` | 1177–1219 | Composes existing static methods; no private state |
| `_applyMutators` (static) | 2030 | Reads `attributes` config |

Everything else stays on the class for the private-field reason.

---

## Pre-flight

From `packages/orm/`:

```bash
pnpm typecheck   # expect clean
pnpm test        # expect 383/383 green
```

Baseline must be green before starting.

---

## Phase 0 — Extract `src/model/events.ts`

The observer dispatch + event muting. Self-contained surface used by every `*Quietly()` method and every CRUD path.

**Symbols to move:**

| Symbol | Lines |
|---|---|
| `interface ModelObserver` (already exported) | 163–180 |
| `type ModelEvent` (already exported) | 156–162 |
| `_fireEvent` (private static) | 703–731 |
| `observe` (static) | 685–691 |
| `on` (static) | 693–701 |
| `clearObservers` (static) | 732–737 |
| `withoutEvents` (static) | 1221–1238 |

**New file shape:**

```ts
// src/model/events.ts
import type { Model } from '../index.js'

export type ModelEvent =
  | 'retrieved' | 'creating' | 'created' | 'updating' | 'updated'
  | 'saving' | 'saved' | 'deleting' | 'deleted' | 'restoring' | 'restored'

export interface ModelObserver { /* same shape as today */ }

// State lives ON THE MODEL CLASS — passed in as the first parameter so
// each Model subclass has its own observer/listener registries (already
// the current behavior via `Object.prototype.hasOwnProperty.call`).
export function fireEvent(
  ModelClass: typeof Model,
  event: ModelEvent,
  ...args: unknown[]
): Promise<unknown> { /* ... */ }

export function observe(ModelClass: typeof Model, ObserverClass: new () => ModelObserver): void { /* ... */ }
export function on(ModelClass: typeof Model, event: ModelEvent, handler: (...a: unknown[]) => unknown): void { /* ... */ }
export function clearObservers(ModelClass: typeof Model): void { /* ... */ }
export async function withoutEvents<T>(ModelClass: typeof Model, fn: () => T | Promise<T>): Promise<T> { /* ... */ }
```

**Seam in `index.ts`:** the static methods on `Model` become thin wrappers:

```ts
class Model {
  static observe(ObserverClass: new () => ModelObserver): void {
    return observe(this, ObserverClass)
  }
  static on(event: ModelEvent, handler: (...a: unknown[]) => unknown): void {
    return on(this, event, handler)
  }
  // ...etc
  private static async _fireEvent(event: ModelEvent, ...args: unknown[]): Promise<unknown> {
    return fireEvent(this, event, ...args)
  }
}
```

**Risk to watch:**
- `_fireEvent` mutates `result` based on observer/listener return values. The existing logic must round-trip identically — observer can transform args, listener with `return false` aborts.
- `Object.prototype.hasOwnProperty.call(this, '_observers')` is the per-subclass guard that prevents observers from inheriting up the prototype chain. Must preserve this exact check on the function's `ModelClass` parameter.

**Verify:** `pnpm typecheck && pnpm test` — 383/383 green. Observer coverage lives in `index.test.ts`.

---

## Phase 1 — Extract `src/model/mass-assignment.ts`

The fillable/guarded enforcement. Tiny but self-contained — purely reads two static arrays.

**Symbols to move:**

| Symbol | Lines |
|---|---|
| `_isFillable` (private static) | 1240–1249 |
| `_filterFillable` (private static) | 1251–1258 |

**New file shape:**

```ts
// src/model/mass-assignment.ts
import type { Model } from '../index.js'

/**
 * Returns true when `key` is writable under the Model's `fillable` /
 * `guarded` policy. `fillable` wins when both are set. Empty `fillable` + 
 * empty `guarded` = no enforcement (back-compat default).
 */
export function isFillable(ModelClass: typeof Model, key: string): boolean { /* ... */ }

/**
 * Drop keys outside the fillable/guarded policy from `data`. Used by
 * `Model.create`, `Model.update`, and `instance.fill`. Bypasses live in
 * `instance.forceFill` and direct property assignment + `save()`.
 */
export function filterFillable(ModelClass: typeof Model, data: Record<string, unknown>): Record<string, unknown> { /* ... */ }
```

**Seam:** the private statics on `Model` become thin wrappers (same shape as Phase 0).

**Verify:** `pnpm typecheck && pnpm test`. Mass-assignment coverage lives in `index.test.ts`.

---

## Phase 2 — Extract `src/model/upsert.ts`

`firstOrCreate` / `updateOrCreate`. Pure composition of existing static methods — no private-field access.

**Symbols to move:**

| Symbol | Lines |
|---|---|
| `firstOrCreate` (static) | 1177–1197 |
| `updateOrCreate` (static) | 1199–1219 |

**New file shape:**

```ts
// src/model/upsert.ts
import type { Model } from '../index.js'

/**
 * Find by all keys in `attrs`. When found, return as-is. When missing,
 * call `Model.create({ ...attrs, ...values })`. `attrs` keys go through
 * the fillable filter via `create()` — keep your lookup columns in
 * `static fillable` or the new row will be missing them.
 */
export async function firstOrCreate<T extends typeof Model>(
  ModelClass: T,
  attrs:  Partial<InstanceType<T>>,
  values: Partial<InstanceType<T>>,
): Promise<InstanceType<T>> { /* ... */ }

export async function updateOrCreate<T extends typeof Model>(
  ModelClass: T,
  attrs:  Partial<InstanceType<T>>,
  values: Partial<InstanceType<T>>,
): Promise<InstanceType<T>> { /* ... */ }
```

**Seam:** the static methods on Model become thin wrappers.

**Risk to watch:**
- `firstOrCreate` reads the lookup attrs into a `where(...).first()` chain before falling back to `create`. The `this: T` binding makes the chain hydrate correctly. The free function must preserve this — call `ModelClass.where(...)` directly, not via destructuring.

**Verify:** `pnpm typecheck && pnpm test`. Coverage in `index.test.ts`.

---

## Wrap-up

After all three phases:

```bash
pnpm --filter @rudderjs/orm typecheck
pnpm --filter @rudderjs/orm test                # 383/383
pnpm --filter @rudderjs/orm build               # clean dist
pnpm --filter @rudderjs/orm lint                # 19 warnings, 0 errors (no new)
```

**Expected new line counts** (approximate):
- `index.ts`: 2150 → ~1800 (–16%)
- `src/model/events.ts`: ~100 LOC (new)
- `src/model/mass-assignment.ts`: ~40 LOC (new)
- `src/model/upsert.ts`: ~85 LOC (new)

**Public API check:** `git diff main -- packages/orm/src/index.ts` should keep all `export ...` lines identical. The static methods on `Model` remain — just delegate to free functions. `ModelObserver` and `ModelEvent` get re-exported from `events.ts` instead of declared inline.

**PR title:** `refactor(orm): extract Model events / mass-assignment / upsert into siblings`

**Changeset:** none. Internal refactor.

**Recommended PR strategy:** one PR, three commits. Same as #414.

---

## Deferred — what is NOT in this plan

These would shrink `index.ts` further but require either changing private fields to TS `private` or adding accessor getters — neither pays off well enough to bundle here:

| Cluster | LOC | Why deferred |
|---|---|---|
| Dirty tracking (`isDirty`, `wasChanged`, `getOriginal`, `getChanges`, `getDirty`, `_currentAttrs`, `_syncOriginal`) | ~80 | All read/write `#original` / `#changes` |
| Serialization (`toJSON`, `makeHidden`, `makeVisible`, the visible/hidden filter) | ~120 | Reads `#instanceHidden` / `#instanceVisible` |
| Persistence (`save`, `refresh`, instance `delete`, `restore`, the `*Quietly` siblings, `replicate`) | ~250 | Writes `#original` via `_syncOriginal()` |
| Mutator application (`_applyMutators`) | ~40 | Could be extracted but it only saves one method — not worth the churn alone; bundle with serialization if/when that ships |

**If you want these too:** the cost-effective path is a separate plan that converts the `#` private fields to TS `private` fields all at once, then extracts as a single PR. That's a wider change with no behavior delta but breaks the runtime privacy guarantee — worth its own approval cycle.

---

## Risk notes

- **Per-subclass observer registries.** `Object.prototype.hasOwnProperty.call(ModelClass, '_observers')` is load-bearing — without it, every `Model.observe(...)` would leak observers to every subclass. The free function must take `ModelClass` and run the same check.
- **`withoutEvents` mutates `_eventsMuted` then restores in `finally`.** A throw inside `fn()` must still restore the flag. Preserve the try/finally exactly.
- **`firstOrCreate` lookup attrs go through `create()`** which respects `fillable`. The free function must still call `ModelClass.create(...)` (not bypass into `_doCreate`) so the filter applies.
- **`Model.create<T>(this: T, data: Partial<InstanceType<T>>)` generic.** The free function `firstOrCreate` calls `ModelClass.create(...)` which uses this generic. TS should preserve the inference through the wrapper — confirm via tests on the typed return value.
