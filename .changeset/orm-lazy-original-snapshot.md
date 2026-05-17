---
'@rudderjs/orm': patch
---

Defer the dirty-tracking baseline build past `Model.hydrate()` — recovers ~1.8 ms on a 5000-row hydration when the rows are read-and-discarded (the dominant bulk-read pattern). For rows that ARE dirty-checked or saved, the snapshot materializes on first access; total work is unchanged, just shifted later.

Internal refactor only — `getOriginal` / `getDirty` / `isDirty` / `wasChanged` / `save()` diff semantics are preserved. No public API change.
