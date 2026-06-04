---
'@rudderjs/database': minor
'@rudderjs/contracts': minor
'@rudderjs/orm': minor
---

Phase-2 engine relocation, step 1 (decouple): the sticky-read scope moves to `@rudderjs/database/sticky`, and `BuiltInCast` moves to `@rudderjs/contracts`.

- **`@rudderjs/database`** gains the node-only `./sticky` subpath — `runWithDatabaseContext()`, `hasDatabaseContext()`, `markWrote()`, `stickyWrote()`, and `databaseContextMiddleware()` relocate verbatim from `@rudderjs/orm/sticky`. The AsyncLocalStorage stays on `globalThis['__rudderjs_orm_sticky__']` (key unchanged), so the old and new import paths — and any mix of package versions across a dev re-boot — share one scope.
- **`@rudderjs/orm/sticky`** becomes a re-export shim of `@rudderjs/database/sticky`. Every existing import (including `@rudderjs/orm-drizzle` and app queue-job wrappers) keeps working unchanged; `@rudderjs/database/sticky` is the canonical path going forward.
- **`@rudderjs/contracts`** now owns the `BuiltInCast` cast-name union; `@rudderjs/orm` re-exports it from the same places as before (`@rudderjs/orm` main entry / `cast.ts`). Moved because the native engine's schema→TS type generator also consumes it, and the engine's new home (`@rudderjs/database`) must never import `@rudderjs/orm`.

No behavior change; no `native/**` files touched. Part of `docs/plans/2026-06-04-database-extraction-phase-2.md` (PR-A1).
