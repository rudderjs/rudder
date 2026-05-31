---
"@rudderjs/orm": minor
"@rudderjs/cli": patch
---

Native engine Phase 8 (scoped) — ship native as an opt-in SQLite engine.

The native engine (`@rudderjs/orm/native`) is now wired as a selectable, batteries-included database engine — no external ORM package, just `@rudderjs/orm` + `better-sqlite3`.

- **`NativeDatabaseProvider`** (auto-discovered via `rudderjs.providerSubpath: './native'`) boots a `NativeAdapter` from `config('database')`. It's **opt-in and inert by default**: it activates only when the default connection sets `engine: 'native'`. Because `@rudderjs/orm` is installed in every app, this config gate is what lets the provider be auto-discovered without clobbering a Prisma/Drizzle adapter — in those apps it discovers, sees no `engine: 'native'`, and returns early. An explicit `nativeDatabase()` helper is also exported for hand-wired `bootstrap/providers.ts`.
- **Doctor:** new `@rudderjs/orm/doctor` subpath contributes an `orm-native:db-connect` `--deep` check that reuses the driver opened during boot (skips cleanly when the app isn't on native). Registered in the CLI's doctor loader.
- **`@rudderjs/core`** is now an optional peer of `@rudderjs/orm` (used only by the node-only native provider; the client-bundle gate is unaffected since the main entry never imports the subpath).
- **Docs:** the database guide documents native as a selectable engine, the `engine: 'native'` config, transactions, the client-safety contract, and the explicit "no native migrations yet — bring your own schema" caveat.

**Not in scope (deliberate):** `create-rudder` still defaults to Prisma/Drizzle — flipping the scaffolder default needs a native schema/migration story (Phase 7, deferred). Postgres/MySQL and native migrations remain out.
