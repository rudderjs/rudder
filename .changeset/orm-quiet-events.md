---
'@rudderjs/orm': minor
---

Eloquent-style quiet event ops + `instance.restore()` (Laravel parity #2 PR2).

Three instance methods that mute observer + listener events for a single
operation, mirroring Eloquent's quiet variants:

- `saveQuietly()` — persists without firing `saving` / `saved` /
  `creating` / `created` / `updating` / `updated`.
- `deleteQuietly()` — deletes (or soft-deletes) without firing
  `deleting` / `deleted`.
- `restoreQuietly()` — restores a soft-deleted row without firing
  `restoring` / `restored`.

Plus `instance.restore()` — non-quiet symmetric counterpart to
`instance.delete()`. Routes through the static `Model.restore()` so
observers fire, refreshes the instance in place, and re-baselines the
dirty-tracking snapshot.

**Per-class isolation:** quiet ops mute only the calling class.
Cascading observers that touch other classes still fire — wrap the
cascade in a broader `Model.withoutEvents()` block if you need full
silence.

Additive — no existing API changes, no migration needed.
