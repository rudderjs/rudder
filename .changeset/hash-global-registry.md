---
'@rudderjs/hash': patch
---

Route `HashRegistry`'s driver state through `globalThis` so the registry survives the case where `@rudderjs/hash` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/hash` inline (`Hash.make` / `Hash.check` read `HashRegistry`), but `HashProvider.boot()` runs from a `node_modules` copy of `@rudderjs/hash` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Hash.*` reads from inside the bundle, producing a misleading `[RudderJS Hash] No hash driver registered` error on every password/credential hash call in prod — which would break auth login/registration flows.

No public API change — same `set` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), PR #501 (`@rudderjs/cache`), PR #502 (`@rudderjs/queue`), PR #503 (`@rudderjs/mail`), and PR #504 (`@rudderjs/storage`).
