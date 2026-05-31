---
"@rudderjs/orm": minor
---

feat(orm): schema → TypeScript types generator + SchemaRegistry (GATE 7-types, foundation)

The headline of the native migrations plan: model column types **generated from the migrated schema** instead of hand-maintained, so they can't drift. This lands the foundation:

- **Pure type generator** (`@rudderjs/orm/native`): `sqliteTypeToTs` (affinity mapping), `castToTs` (a declared `cast` overrides the storage type — `boolean`/`date`/`json`/…), `resolveColumnType` (nullability + PK rules), `buildTableTypes`, and `emitRegistryDts` — which emits an `app/Models/__schema/registry.d.ts` augmenting `@rudderjs/orm`'s new `SchemaRegistry` interface, one entry per table. Mirrors `@rudderjs/vite`'s scanner pattern.
- **Introspection**: `readTables` (user tables, excluding `sqlite_*` + the `migrations` bookkeeping table).
- **Orchestrator**: `collectSchemaTypes` / `generateSchemaTypes` — introspect every table, fold in each model's `casts`, write the registry file.
- **`SchemaRegistry` + `SchemaColumns<TName>`** exported from `@rudderjs/orm`: empty by default (so nothing changes until you generate), augmented by the generated `.d.ts`. Verified end-to-end with `tsc`: after augmentation, `SchemaColumns<'users'>` resolves to the typed column shape and a wrong column type fails type-checking.

Non-breaking and opt-in — `Model` is unchanged; until the file is generated, `SchemaRegistry` is empty and everything behaves as before. Follow-ups: the `rudder schema:types` CLI command + post-`migrate` auto-generation, and binding the registry onto `Model<'users'>` so a model needs zero hand-declared fields. SQLite only.
