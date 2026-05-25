---
"@rudderjs/support": minor
---

Add `reusableConnection(cacheKey, signature, build, dispose)` — reuse one long-lived connection (DB pool, Redis client, …) across Vite dev HMR re-boots instead of opening a fresh one on every edit. Caches the connection promise on `globalThis[cacheKey]` keyed by a caller-computed signature; an unchanged signature reuses the live connection, a changed one builds fresh and disposes the superseded one. Generalizes the inlined reuse in the orm adapters (#652) for connection-owning providers.
