---
'@rudderjs/notification': patch
---

Route `ChannelRegistry`'s channel map through `globalThis` so the registry survives the case where `@rudderjs/notification` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/notification` inline (`Notifier.send` reads `ChannelRegistry.get(name)`) but `NotificationProvider.boot()` runs from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, the built-in mail/database/broadcast channels registered from the externalized copy would never be visible to `Notifier.send()` reading the bundled copy — every send would throw `[RudderJS Notification] Unknown channel`.

No public API change — same `register` / `get` / `has` / `reset` surface. Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
