---
'@rudderjs/orm': patch
---

Fast-path `Model._fireEvent` to return synchronously when the class has no observers or event listeners — recovers ~0.5 ms on `.all()` over 5000 rows by avoiding 5000 empty microtask schedules for the per-row `retrieved` event.

The slow path (observers or listeners present) is unchanged — it routes through `_fireEventSlow` which is still `async` with the original semantics. Internal-only refactor; no public API change.
