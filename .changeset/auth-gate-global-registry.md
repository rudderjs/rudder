---
'@rudderjs/auth': patch
---

Route `Gate`'s abilities/policies/before-callbacks through `globalThis` so the registry survives the case where `@rudderjs/auth` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/auth` inline (every `Gate.allows()` call reads the registry) but `AuthProvider.boot()` and `Gate.define()` / `Gate.policy()` calls in `AppServiceProvider.boot()` can run from a `node_modules` copy of `@rudderjs/auth` resolved via the provider auto-discovery manifest. Without a shared store, abilities/policies registered from the externalized copy would never be visible to `Gate.allows()` from inside the bundle and every authorization check would silently deny.

No public API change — same `define` / `before` / `policy` / `allows` / `denies` / `forUser` / `reset` surface. Defensive migration per the #499 static-state singleton audit (the `@rudderjs/auth` provider currently boots from the bundle in practice, so this isn't broken today — but the layout is identical to packages that were). Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
