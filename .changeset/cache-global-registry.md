---
'@rudderjs/cache': patch
---

Route `CacheRegistry`'s adapter + default-name state through `globalThis` so the registry survives the case where `@rudderjs/cache` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/middleware` inline (which imports `CacheRegistry` for `RateLimit`), but `CacheProvider.boot()` runs from a `node_modules` copy of `@rudderjs/cache` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Cache.*` / `RateLimit` reads from inside the bundle, producing a misleading `[RudderJS Cache] No cache adapter registered` error on every rate-limited route in prod.

No public API change — same `set` / `get` / `setDefaultName` / `getDefaultName` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`) and PR #500 (`@rudderjs/pennant` `PennantRegistry`).
