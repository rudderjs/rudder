---
"@rudderjs/broadcast": patch
---

Stop leaking Redis pub/sub connections on dev HMR re-boots. `BroadcastingProvider.boot()` built the broadcast driver (e.g. `@rudderjs/broadcast-redis`'s `RedisDriver`, which opens a pub + sub connection) on every `app/` edit, but `initWsServer()` is init-once and early-returns on re-boot — so the freshly-built driver was discarded, orphaning its connections. The provider now builds the driver only when the ws-server isn't already running (`isWsServerRunning()`), so re-boots keep the live driver and open no new connections. No behavior change in production (single boot).
