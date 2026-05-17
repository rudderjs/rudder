---
'@rudderjs/storage': patch
---

Route `StorageRegistry`'s adapters Map + default-disk state through `globalThis` so the registry survives the case where `@rudderjs/storage` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/storage` inline (`Storage.*` / `Storage.disk(...)` reads `StorageRegistry`), but `StorageProvider.boot()` runs from a `node_modules` copy of `@rudderjs/storage` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Storage.*` reads from inside the bundle, producing a misleading `Disk "<name>" not found` error on every storage call in prod.

No public API change — same `set` / `setDefault` / `defaultName` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), PR #502 (`@rudderjs/queue`), and PR #503 (`@rudderjs/mail`).
