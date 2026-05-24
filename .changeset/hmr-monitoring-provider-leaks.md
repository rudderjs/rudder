---
"@rudderjs/telescope": patch
"@rudderjs/pulse": patch
"@rudderjs/horizon": patch
---

Dev HMR: stop leaking storage connections, timers, and collector subscriptions on every re-bootstrap.

The `telescope`, `pulse`, and `horizon` providers built their storage, prune/metrics timers, and collectors directly in `boot()` — which re-runs on every dev re-boot. Nothing tore down the previous set, so each `app/` edit leaked a storage connection (a new SQLite handle, or a new Redis connection on `horizon.storage: 'redis'` → `maxclients` exhaustion), a prune timer, the frequent collector/recorder stats timers (firing every 15–60s against stale storage), and re-subscribed every collector to its peer observer registry — accumulating duplicate dashboard entries per edit. Measured: telescope + pulse SQLite connections climbed monotonically `8 → 44` across 8 edits (the leaked storage is pinned by its still-running timers, so it never gets GC-reclaimed); with the fix it stays flat at one set.

Each provider now builds its storage + timers + collectors **once per process**, cached on `globalThis`, and reuses them across re-boots. Routes and request/user middleware are still re-registered every boot (because `router.reset()` wipes them). No-op in production (single boot). Same root cause as the orm-prisma connection leak fixed in `@rudderjs/orm-prisma@2.0.1`.
