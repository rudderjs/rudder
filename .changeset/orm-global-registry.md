---
'@rudderjs/orm': patch
---

Route `ModelRegistry`'s state (adapter, model map, listeners) through `globalThis` so it survives the case where `@rudderjs/orm` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/orm` inline but externalizes `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle`. Those adapter packages resolve their own copy of `@rudderjs/orm` from `node_modules` at runtime; without a shared store, `DatabaseProvider.boot()` would land on a different `ModelRegistry` class than the one Model handlers read from, producing a misleading `No ORM adapter registered` error on every DB route in prod.

No public API change — same `set` / `get` / `getAdapter` / `register` / `all` / `onRegister` / `reset` surface. Same pattern as the ai/mcp/http/queue/sync/broadcast observer registries.
