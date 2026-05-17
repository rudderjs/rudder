---
'@rudderjs/pennant': patch
---

Route `PennantRegistry`'s manager state through `globalThis` so it survives the case where `@rudderjs/pennant` is loaded twice — typical in a Vite-bundled server where the framework bundles user code (including `AppServiceProvider`, which calls `Feature.define()`) inline, but `PennantProvider.boot()` runs from a `node_modules` copy of `@rudderjs/pennant` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Feature.*` reads from inside the bundle, producing a misleading `[RudderJS Pennant] Not registered` error during boot in production.

No public API change — same `set` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`).
