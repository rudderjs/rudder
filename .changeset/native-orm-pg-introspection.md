---
"@rudderjs/orm": minor
---

Native ORM engine: generate TypeScript model types from a live **Postgres** schema (Phase 7.7c). `schema:types` now introspects Postgres via `information_schema` (`readTables`/`readColumns` are dialect-aware) and maps column types through a new `pgTypeToTs` that reflects what the driver returns on read (`jsonb` → `unknown`, `timestamptz`/`date` → `Date`, `int8`/`bigint` → `number`, `numeric`/`money` → `string`, `bytea` → `Uint8Array`). The per-dialect storage mapper is threaded through `resolveColumnType` / `buildTableTypes` / `collectSchemaTypes` and defaults to the SQLite mapping, so existing behavior is unchanged. Declared `casts` still override the generated storage type. Completes Postgres support for the native engine (dialect + driver landed previously).
