---
'@rudderjs/orm': patch
---

Fix the deferred-pivot proxy used by `parent.related('tags')` / `.related('roles')`
on `belongsToMany`, `morphToMany`, and `morphedByMany` relations.

**Race fix.** The proxy previously captured `lastPivotRows` in a factory
closure shared across terminal calls. `Promise.all([qb.get(), qb.get()])`
interleaved `buildResolved()` / `postProcess()` and the second terminal
stamped pivot columns using the *other* call's pivot rows (or `[]` if it
got there before the lookup landed). `buildResolved` now returns the
QueryBuilder *and* the pivot rows for the current call together; they're
threaded into `postProcess(result, terminal, pivotRows)` per-invocation.

**Unsupported chain methods now throw.** Calling `.whereHas(...)`,
`.withCount(...)`, `.whereGroup(...)`, `.loadCount(...)` etc. on a deferred
pivot relation previously hit the Proxy's `get` trap, returned `undefined`,
and silently no-oped — the user's intent dropped on the floor. The proxy
now throws on any string property that looks like a query-builder method
(`where*`, `with*`, `load*`, `or<X>*`) but isn't in the recorded chain set.
Runtime-internal access (`Symbol.iterator`, `then`, `toString`, …) still
returns `undefined`, so `await qb`, spreads, and comparisons continue to
work as before.

Closes Phase 5 of `docs/plans/2026-05-21-framework-orm-correctness.md`.
