---
'@rudderjs/cli': minor
---

New doctor check `structure:rudder-types-tsconfig`: warns when `.rudder/types/` exists but the `tsconfig.json` `include` array doesn't cover it (or uses the bare `".rudder"` form, which tsc ignores for dotted directories) — the silent failure mode where typed `view()`/`route()`/`Model.for<>()` stop resolving.
