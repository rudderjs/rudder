---
"@rudderjs/orm-prisma": patch
"@rudderjs/core": patch
---

Dev HMR: reuse one PrismaClient across re-bootstraps instead of opening (and leaking) a fresh DB connection on every edit.

Each dev re-boot re-ran `DatabaseProvider.boot()` → `PrismaAdapter.make()`, which built a brand-new `PrismaClient` and opened a new driver connection (a new better-sqlite3 handle, a new pg/mariadb pool, …) every time — and never disconnected the superseded one. Under Prisma 7's driver-adapter model the app owns the client lifecycle and Prisma performs no HMR de-duplication of its own, so abandoned connections piled up across edits.

- **`@rudderjs/orm-prisma`** — `PrismaAdapter.make()` now caches the live `PrismaClient` on `globalThis`, keyed by the resolved connection signature (driver + url). The same signature reuses the live client (no new connection opened); a changed connection (a `config/database.ts` edit) builds a fresh client and `$disconnect()`s the superseded one so its handle is released. No-op in production (single boot → one client, built once). Apps passing their own `config.client` opt out entirely.
- **`@rudderjs/core`** — under `RUDDER_HMR_TRACE=1`, `Application.create()` and the app-builder now log a per-re-boot construct counter, so the "one fresh instance per re-boot" invariant is observable when diagnosing HMR. Diagnostic only; no behavior change otherwise.
