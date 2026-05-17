# ORM lazy `#original` snapshot — Lever B of the 2026-05-17 ORM perf audit

**Status:** plan, 2026-05-17.
**Parent:** [`2026-05-17-orm-query-perf.md`](./2026-05-17-orm-query-perf.md) Lever B.
**Effort:** ~1 hour implementation + tests + bench.
**Estimated win:** ~1 ms on `.all()` over 5000 rows (parent plan's measured estimate). Hydration-only — no change to mutated-row path.

---

## Goal

`Model.hydrate(record)` currently calls `_syncOriginal()`, which iterates the freshly-populated instance via `_currentAttrs()` to build a separate dirty-tracking baseline. On a bulk read (`.all()` returning 5000 rows), that's 5000 iterate-and-filter passes the user pays for whether they touch dirty-tracking or not.

Defer the baseline build past hydrate. For rows that are read-and-discarded (the dominant bulk-read pattern), the cost is never paid. For rows that ARE dirty-checked or saved, the cost shifts to first dirty-check — same total work, different timing.

---

## Audit — every `#original` access site

`src/index.ts`:

| Line | Site | Read / write | Notes |
|---|---|---|---|
| 663 | field decl | — | `#original: Record<string, unknown> = {}` |
| 1440 | `_syncOriginal()` | write | `this.#original = this._currentAttrs()` — the eager build we're deferring |
| 1462 | `save()` diff loop | read | `Object.keys(this.#original)` |
| 1463 | `save()` diff loop | read | `this.#original[k]` |
| 1466 | `save()` end | write | `this.#original = next` — explicit reset to post-save state |
| 1750 | `getOriginal()` (no key) | read | `{ ...this.#original }` — returns defensive copy |
| 1751 | `getOriginal(key)` | read | `this.#original[key]` |
| 1763 | `getDirty()` diff loop | read | `Object.keys(this.#original)` |
| 1764 | `getDirty()` diff loop | read | `this.#original[k]` |

`_syncOriginal()` callers:

| Line | Site | Notes |
|---|---|---|
| 783 | `Model.hydrate(record)` | **the hot path — every queried row** |
| 1512 | `refresh()` | post-refresh reset |
| 1533 | `delete()` (soft-delete branch) | post-soft-delete reset |
| 1552 | `restore()` | post-restore reset |
| 1597 | `instance.increment()` | post-increment reset |
| 1682 | `instance.decrement()` | post-decrement reset |

`replicate()` (line 1696) **does not** call `_syncOriginal()` — it constructs a fresh instance and `#original` stays `{}` (verified by `dirty.test.ts:177` which asserts `clone.getOriginal()` returns `{}`).

---

## Approach: store raw record at hydrate, materialize on first dirty-check

The lazy strategy needs to capture the pre-mutation snapshot at hydrate time without iterating. The cheapest way: store a reference to the `record` argument itself and apply the `_currentAttrs()` filter (drop `_*`, drop `undefined`, drop aggregate keys) only on first dirty-tracking access.

### State

Replace single `#original` with two fields:

```ts
#originalRaw: Record<string, unknown> | undefined  // ref to hydrate input — undefined once materialized or reset
#originalSnapshot: Record<string, unknown>          // materialized filtered baseline — default {}
```

### Accessor

```ts
private _original(): Record<string, unknown> {
  if (this.#originalRaw === undefined) return this.#originalSnapshot
  // First dirty-check after hydrate — pay the filter cost now.
  const aggregates = (this as unknown as Record<symbol, Set<string> | undefined>)[AGGREGATES_SYMBOL]
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(this.#originalRaw)) {
    if (k.startsWith('_')) continue
    if (v === undefined) continue
    if (aggregates && aggregates.has(k)) continue
    out[k] = v
  }
  this.#originalSnapshot = out
  this.#originalRaw      = undefined
  return out
}
```

### Hydrate change

`Model.hydrate(record)` skips `_syncOriginal()` and just stores the raw reference:

```ts
static hydrate(this, record) {
  if (record === null || record === undefined) return null
  if (record instanceof Model && record.constructor === this) return record as InstanceType<T>
  const Ctor = this as unknown as new () => InstanceType<T>
  const instance = new Ctor()
  Object.assign(instance, record)
  instance.#originalRaw = record as Record<string, unknown>
  return instance
}
```

### `_syncOriginal()` (called from save/refresh/delete/restore/inc/dec)

Stays eager — those paths already have current instance state in hand and the user is signalling "reset baseline now":

```ts
private _syncOriginal(): void {
  this.#originalSnapshot = this._currentAttrs()
  this.#originalRaw      = undefined
}
```

### Read sites

All four current read sites (`save()` diff loop x2, `getOriginal` x2, `getDirty()` diff loop x2) become `this._original()` calls. Same shape, same semantics.

### `save()` end-of-save reassign

Line 1466 currently writes `this.#original = next` directly. Change to:

```ts
this.#originalSnapshot = next
this.#originalRaw      = undefined
```

---

## Why this works

**For bulk-read-and-discard (the hot path):**
- Hydrate: `Object.assign` + one property write (`#originalRaw = record`). Skips `_currentAttrs()` entirely.
- User iterates / renders / serializes. Never touches `isDirty()` / `wasChanged()` / `save()`. `#originalRaw` stays a dangling reference.
- GC collects instance + record together. Net: skipped one filter pass per row.

**For modify-then-save:**
- Hydrate: skips filter (saves ~200 ns).
- User mutates own properties.
- `save()` calls `_currentAttrs()` for `data` → calls `this._original()` for diff → pays the filter pass we deferred → resets baseline.
- Total cost: same as today. Filter just happens later.

**For dirty-check without save:**
- Hydrate: skipped filter.
- `isDirty()` / `wasChanged()` / `getOriginal()` triggers `_original()` → pays filter once.
- Subsequent calls hit the cached `#originalSnapshot`. No regression.

**For aggregate-loaded rows (`withCount`):**
- Adapter stamps `postsCount` onto the row, then the hydrating QB calls `hydrate(record)`, then stamps `postsCount` into `aggregateKeysOf(instance)`.
- At first `_original()` call, `aggregateKeysOf` is populated → filter excludes `postsCount`. Same shape as today's eager build at hydrate (which had empty `aggregateKeysOf` and therefore included `postsCount` — see "behavioral note" below).

**Behavioral note (intentional, minor):** today's eager build runs BEFORE the QB wrap stamps aggregate keys, so `#original` includes aggregate values. On save, the diff sees aggregate values "vanish" and marks them as changed. The lazy version materializes AFTER aggregate stamping and correctly excludes them. This is a quiet bug-fix, not a regression. The save-aggregate-loaded-model path is rare in practice.

---

## Test plan

The existing `packages/orm/src/dirty.test.ts` exercises every relevant invariant (12 tests across hydrate / mutate / save / increment / replicate / soft-delete). The lazy change should pass all of them unchanged. Specific assertions to watch:

- `dirty.test.ts:73` — `getOriginal()` after hydrate returns the full row snapshot
- `dirty.test.ts:99` — `getChanges()` after save reflects the actual diff (not "everything changed")
- `dirty.test.ts:177-183` — `replicate()` clone has empty `getOriginal()` (no raw record stored)
- `dirty.test.ts:195-201` — `getOriginal()` returns a defensive copy, not a live reference (extra-important now: must not return `#originalRaw` directly since that's the user's input object)

Add one new test: hydrate + mutate before first dirty-check, then assert `getDirty()` correctly reflects the pre-mutation baseline. This guards the lazy-materialization timing.

---

## Bench plan + results

Microbench focused on hydration only (no Prisma, no observers, no event firing). 5000 rows × 100 iterations × 20-iteration warm-up. Script lives at `/tmp/rudder-perf/bench-hydrate.mjs` (not committed).

| Path | main baseline | lazy branch | Δ |
|---|---:|---:|---:|
| `hydrate` (read-and-discard) | 2.322 ms | **0.499 ms** | **-1.82 ms (-78%)** |
| `hydrate` + `isDirty()` (forces materialize) | 5.661 ms | 5.695 ms | +0.03 ms (noise) |
| `hydrate` + `getOriginal()` | 2.244 ms | 2.208 ms | -0.04 ms (noise) |

The read-and-discard saving is **~2× the parent plan's ~1 ms estimate** — the parent was measuring through full `Model.all()` (which includes adapter cost + serial `retrieved` events), so the relative ORM hydration cost was higher than just the `_currentAttrs()` pass. With Lever A (shipped #494) already pruning the event firing, the lazy snapshot is now nearly the entire remaining ORM hydration overhead.

Dirty-touched paths are within noise on both versions — lazy materialization just shifts the same work later, no regression.

---

## Rollback

Single-file change in `packages/orm/src/index.ts`. Revert by:
- Restore `#original` field.
- Restore eager `_syncOriginal()` body.
- Restore direct `this.#original` reads at 4 sites.

No public API surface. No adapter contract change. No migration.

---

## Out of scope

- Lever C (skip `new Ctor()` via `Object.create(prototype)`) — invasive, breaks subclass constructors.
- Lever D (`Model.allRaw()`) — explicit semantic break, deferred without user direction.
- Eager-build perf inside `_syncOriginal()` itself — already a tight loop, no obvious wins.
