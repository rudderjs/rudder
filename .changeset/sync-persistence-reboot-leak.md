---
"@rudderjs/sync": patch
---

Reuse the sync persistence across dev HMR re-boots. `SyncProvider.register()` rebuilds `cfg.persistence` (e.g. `syncRedis()`) on every `app/` edit as the config module re-evaluates, so its lazy ioredis client opened a fresh connection on the next doc op and leaked the previous one. Persistence is now resolved through sync's `syncGlobal` get-or-create slot, so the first instance wins and later per-boot ones stay inert (never connect). No-op in production (single boot). (The WebSocket server is still rebuilt per re-boot — benign: `noServer`, no pinning timer, GC-reclaimable — and is left untouched here because it's entangled with the order-sensitive cross-package upgrade-handler chain; tracked as a separate follow-up.)
