---
'@rudderjs/queue': patch
---

Route `QueueRegistry`'s adapter state through `globalThis` so the registry survives the case where `@rudderjs/queue` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/queue` inline (both `Queue.dispatch` and worker boot read `QueueRegistry`), but driver packages (`@rudderjs/queue-bullmq`) are externalized and resolve their own copy of `@rudderjs/queue` from `node_modules`. Without a shared store, `set()` from the externalized driver would land on a different class than the one `Queue.*` reads from inside the bundle, producing a misleading `No queue adapter registered` error on every `Queue.dispatch` call in prod.

No public API change — same `set` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), and PR #501 (`@rudderjs/cache`).
