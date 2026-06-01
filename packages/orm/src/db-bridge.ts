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

import { registerAdapterResolver } from '@rudderjs/database'
import { ModelRegistry } from './index.js'

registerAdapterResolver(() => ModelRegistry.getAdapter())
