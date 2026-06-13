---
"@rudderjs/database": patch
---

Two native-engine correctness fixes:

- Schema intent replay (the `schema:types` fallback) now applies column renames before adds/changes, mirroring the real ALTER execution order in the DDL compiler. Previously a `.change()` on a column that was also being renamed could land under the old name in the generated type registry, diverging from the executed schema.
- `_idState()` (the by-id write state for update/delete/restore/forceDelete/increment) now drops leftover `whereHas` and aggregate state along with the where/soft-delete scope, so a single-row write can never carry a stray relation-existence predicate or aggregate subselect.
