// ─── @rudderjs/orm/native — back-compat shim ───────────────
//
// The native engine moved to `@rudderjs/database` (Phase-2 relocation —
// docs/plans/2026-06-04-database-extraction-phase-2.md). This subpath
// re-exports the engine barrel verbatim so every historical import keeps
// working — app migration files (`import { Migration, Schema } from
// '@rudderjs/orm/native'`), standalone-Node consumers (`NativeAdapter` + a
// driver), and the queue's database driver. New code should import from
// `@rudderjs/database` (headline API) or `@rudderjs/database/native` (full
// engine surface).
//
// Node-only, NEVER re-exported from the main `@rudderjs/orm` entry (the main
// entry is client-bundle-reachable; the `Client Bundle Smoke` gate enforces it).
//
// NOTE: the framework provider (`NativeDatabaseProvider` / `nativeDatabase`)
// is deliberately NOT re-exported here — same rule as before the move. It
// `extends ServiceProvider` from `@rudderjs/core` (an optional peer), so
// re-exporting it would make this engine barrel eagerly import `@rudderjs/core`
// — breaking a standalone-Node consumer. It stays on its own subpath,
// `@rudderjs/orm/native/provider` (loaded via `rudderjs.providerSubpath`).

export * from '@rudderjs/database/native'
