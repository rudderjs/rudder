// ─── @rudderjs/orm/sticky — back-compat shim ───────────────
//
// The sticky-read scope moved to `@rudderjs/database/sticky` (Phase-2 engine
// relocation — see docs/plans/2026-06-04-database-extraction-phase-2.md). This
// subpath re-exports it verbatim so every existing import keeps working
// (orm-drizzle, app queue-job wrappers, docs). State is shared regardless of
// which path loads first: the implementation stores its AsyncLocalStorage on
// `globalThis['__rudderjs_orm_sticky__']`, so the shim and the canonical
// module always converge on one scope.
//
// Node-only (the target has a top-level `node:async_hooks` import) — same rule
// as before: NEVER re-export from `@rudderjs/orm`'s client-reachable main entry.

export * from '@rudderjs/database/sticky'
