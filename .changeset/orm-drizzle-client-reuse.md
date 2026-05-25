---
"@rudderjs/orm-drizzle": patch
---

Reuse one drizzle client across dev HMR re-boots instead of opening a fresh driver connection on every edit. `DrizzleAdapter.make()` now caches the live client on `globalThis.__rudderjs_drizzle_client__`, keyed by the resolved connection signature (driver + url): an unchanged signature reuses the client; a changed signature (a `config/database.ts` edit) builds a fresh client and disposes the superseded driver (`postgres.end()` / `pool.end()` / `libsql.close()` / `better-sqlite3.close()`). Mirrors the orm-prisma fix (#652) — without it, each dev re-boot leaked a connection (catastrophic on pooled drivers like MySQL: ~10–20 server connections per leaked pool). No-op in production (single boot); apps passing their own `config.client` opt out entirely.
