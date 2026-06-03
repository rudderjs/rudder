---
"@rudderjs/orm": minor
"@rudderjs/database": minor
---

Named database connections (multi-connection PR1): `DB.connection('name')` + a lazy `ConnectionManager` + per-connection transaction scoping.

- **`@rudderjs/orm`**: new `ConnectionManager` (globalThis-backed registry of lazy connection factories — registering does no I/O and no driver import, so `config/database.ts`'s `connections` map keeps its menu semantics). `transaction(fn, { connection: 'name' })` runs a transaction on a named connection; the transaction ALS now keys scoped adapters **by connection name**, so a named-connection transaction never captures default-connection queries (and vice versa). `ModelRegistry.getAdapter(name?)` / `getScopedAdapter(name?)` resolve named connections. The native provider registers a factory for every `engine: 'native'` connection (the default stays eager and shares one adapter with `DB.connection(default)`), and the native dev-HMR driver cache is now per-connection (a config edit disposes/reopens only that connection's driver).
- **`@rudderjs/database`**: `DB.connection(name)` — a scoped facade (`select`/`insert`/`update`/`delete`/`statement`/`transaction`/`listen`) over a named connection, opened lazily on first use; inside `transaction(fn, { connection: name })` its calls join that open transaction. New bridge hooks (`registerConnectionResolver`, `registerNamedTransactionRunner`) keep the orm→database dependency direction.

`Model.on('name')` / per-model `static connection` and read/write splitting land in follow-up PRs (see `docs/plans/2026-06-03-orm-multi-connection-read-write-split.md`).
