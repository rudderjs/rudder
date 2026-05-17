---
'@rudderjs/ai': patch
---

Route `AiRegistry`'s factories/default/models through `globalThis` so the registry survives the case where `@rudderjs/ai` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/ai` inline (every agent path resolves a provider via `AiRegistry.resolve(...)`) but `AiProvider.boot()` runs from a `node_modules` copy of `@rudderjs/ai/server` resolved via the provider auto-discovery manifest. Without a shared store, provider factories registered from the externalized copy would never be visible to agent resolution from inside the bundle and every agent call would throw `[RudderJS AI] Unknown AI provider`.

No public API change — same `register` / `getFactory` / `setDefault` / `getDefault` / `resolve` / `resolveReranking` / `resolveFiles` / `resolveVectorStores` / `setModels` / `getModels` / `reset` surface. Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).
