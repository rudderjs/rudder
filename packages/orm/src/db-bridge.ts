// ─── DB facade ↔ ModelRegistry bridge (orm → database) ─────
//
// Node-only side-effect module. Pushes `ModelRegistry`'s adapter accessor into
// `@rudderjs/database` so the `DB` facade resolves the SAME active adapter the
// Models use — one connection, never a second.
//
// Imported for side effect ONLY from the adapter providers (native / prisma /
// drizzle) — NEVER from `@rudderjs/orm`'s main or client entry. That keeps
// `@rudderjs/database` off any Model-reachable / client-bundle path (the main
// `@rudderjs/orm` entry is a Client Bundle Smoke target).
//
// Resolving through `getAdapter()` (not a cached adapter) means `DB.*` inside a
// `Model.transaction()` callback transparently joins the open transaction —
// `ModelRegistry.getAdapter()` returns the transaction-scoped adapter there.
//
// The same module also pushes `transaction()` in as the facade's transaction
// runner so `DB.transaction(fn)` reuses the ORM's `AsyncLocalStorage` scoping —
// every `Model.*` AND `DB.*` call inside `fn` joins the one open transaction.

import {
  registerAdapterResolver,
  registerTransactionRunner,
  registerConnectionResolver,
  registerNamedTransactionRunner,
} from '@rudderjs/database'
import { ModelRegistry, ConnectionManager, transaction } from './index.js'

registerAdapterResolver(() => ModelRegistry.getAdapter())
registerTransactionRunner(transaction)
// Named connections: prefer the transaction-scoped adapter (so a
// `DB.connection(name).select()` inside `transaction(fn, { connection: name })`
// joins that open transaction), else open-or-reuse via the ConnectionManager.
registerConnectionResolver(
  async (name) => ModelRegistry.getScopedAdapter(name) ?? ConnectionManager.ensure(name),
)
registerNamedTransactionRunner((name, fn) => transaction(fn, { connection: name }))
