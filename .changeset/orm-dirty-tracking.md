---
'@rudderjs/orm': minor
---

Eloquent-style dirty tracking on Model instances (Laravel parity #2 PR1).

Every Model instance now keeps an attribute snapshot as of the last
`hydrate()` / `save()` / `refresh()` and exposes six methods over it:

- `isDirty(key?)` / `isClean(key?)` — whether any (or the named) attribute
  has been changed since the last save / load / refresh.
- `wasChanged(key?)` — whether the most recent `save()` actually
  persisted a change. Stays true until the next save / refresh.
- `getOriginal(key?)` — snapshot value(s) as of the last save / load /
  refresh.
- `getChanges()` — diff of attributes that changed during the most
  recent `save()`.
- `getDirty()` — diff of attributes currently dirty (unsaved).

Equality is strict for primitives, `getTime()` for Date, and structural
JSON for arrays / plain objects (matching Eloquent's
`originalIsEquivalent`). `refresh()` discards pending writes and
re-baselines. `increment()` / `decrement()` re-baseline so the bumped
counter is not reported as dirty.

Additive — no existing API changes, no migration needed. See the orm
README's "Dirty Tracking" section for full semantics and edge-case
coverage.
