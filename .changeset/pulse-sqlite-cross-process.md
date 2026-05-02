---
"@rudderjs/pulse": patch
---

Fix `SqliteStorage` cross-process loading — load `better-sqlite3` via `createRequire(import.meta.url)` (with the `globalThis.__betterSqlite3` escape hatch as a fallback) and enable WAL journal mode, mirroring `@rudderjs/telescope`.

Surfaced by browser-verifying the queue-observer migration: with BullMQ + `storage: 'sqlite'`, the worker process and the dashboard process need to read/write the same `.pulse.db` concurrently for queue metrics to populate. Without WAL, the second process hits "database is locked"; without `createRequire`, the SQLite driver wouldn't load at all unless the host app pre-stashed `better-sqlite3` on `globalThis` — Pulse demanded `pnpm add better-sqlite3` even when it was already installed.

After this fix, switching the playground (or any consuming app) to `storage: 'sqlite'` is enough to get cross-process Pulse metrics under BullMQ. `storage: 'memory'` remains process-local — fine for the sync queue driver, won't see worker events for BullMQ.
