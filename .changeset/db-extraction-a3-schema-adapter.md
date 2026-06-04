---
'@rudderjs/database': minor
'@rudderjs/orm': minor
---

Phase-2 engine relocation, step 3 (final): `NativeAdapter` and the schema builder + migrator move to `@rudderjs/database` — the native engine now fully lives there.

- **`@rudderjs/database`** gains the rest of the engine: `NativeAdapter`/`native` (with the dev-HMR driver cache key `__rudderjs_native_client__` and its signature format unchanged — re-boots across this upgrade reuse or cleanly dispose live connections), `SchemaBuilder`, `Blueprint`/`AlterBlueprint`, the DDL compiler, `Migration`/`Schema`/`Migrator`, introspection, and the schema→TS type generator. The headline API (`Migration`, `Schema`, `NativeAdapter`, the drivers) is now also re-exported from the **main entry** — `import { Migration, Schema } from '@rudderjs/database'` is the canonical migration-file form going forward.
- **`@rudderjs/orm/native`** is now a pure re-export shim of `@rudderjs/database/native` — byte-compatible surface, every historical import keeps working (app migration files, standalone-Node consumers, the queue's database driver). `NativeDatabaseProvider` deliberately stays at `@rudderjs/orm/native/provider` (it wires `ModelRegistry`/`ConnectionManager`/the DB-facade bridge — orm-side state), so provider auto-discovery is untouched.

No behavior change and no consumer-visible API change. Completes the relocation arc of `docs/plans/2026-06-04-database-extraction-phase-2.md` (PR-A3).
