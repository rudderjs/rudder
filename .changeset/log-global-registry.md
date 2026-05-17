---
'@rudderjs/log': patch
---

Route `LogRegistry`'s channels/defaultName/shared-context/event-listeners through `globalThis` so the registry survives the case where `@rudderjs/log` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/log` inline (`Log.info` / `Log.error` resolve `LogRegistry.default()`) but `LogProvider.boot()` runs from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, channels registered from the externalized copy would never be visible to `Log.*` calls reading the bundled copy and every log call would throw `[RudderJS Log] Channel "console" is not registered`. The shared-context surface (`shareContext`, `flushSharedContext`) and the event-listener subscription used by Telescope's log collector would silently drop writes the same way.

No public API change — same `register` / `channel` / `default` / `setDefault` / `getDefault` / `shareContext` / `sharedContext` / `flushSharedContext` / `listen` / `listeners` / `forgetChannel` / `getChannels` / `reset` surface. Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
