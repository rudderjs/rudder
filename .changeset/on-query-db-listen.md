---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
"@rudderjs/database": minor
"@rudderjs/orm-prisma": patch
---

feat(orm): `onQuery` query listening on the native engine + app-facing `DB.listen()`

Laravel's `DB::listen` arrives in RudderJS:

- **`@rudderjs/contracts`**: `onQuery?(listener)` is now an optional capability on the `OrmAdapter` contract, with new `QueryEvent` (`{ sql, bindings, duration, connection?, model? }`) and `QueryListener` types — the shape Telescope's QueryCollector and Pulse's slow-query recorder already consume.
- **`@rudderjs/orm` (native engine)**: the `NativeAdapter` implements `onQuery` by instrumenting its executor — every executed query (Model reads/writes, `DB.*` raw calls, and queries inside `transaction()`, which share the top-level listener list) is timed with `performance.now()` and reported with its SQL + bindings. Listener errors are swallowed and never break the query; only successful executions report (Laravel `QueryExecuted` parity). Transaction control statements (BEGIN/COMMIT/SAVEPOINT) are not reported.
- **`@rudderjs/database`**: new `DB.listen(listener)`, mirroring Laravel's `DB::listen` — delegates to the active adapter's `onQuery` hook and throws a clear adapter-named error when the adapter doesn't support query listening. `QueryEvent` / `QueryListener` are re-exported.
- **`@rudderjs/orm-prisma`**: the existing ad-hoc `onQuery` method is now typed to the shared contract (no behavior change).

The Drizzle adapter does not implement the hook yet — `DB.listen()` throws its clear unsupported error there; a follow-up adds it.
