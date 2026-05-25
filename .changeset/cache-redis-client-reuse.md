---
"@rudderjs/cache": patch
---

Reuse one Redis client across dev HMR re-boots. `CacheProvider.boot()` rebuilds the `RedisAdapter` on every `app/` edit, so without reuse each re-boot opened (and leaked) a fresh ioredis connection toward Redis's `maxclients` cap. The adapter now routes client construction through `reusableConnection` (keyed by `url` / `host:port:db:password`), reusing the live client across re-boots and disposing it on a connection-signature change. No-op in production.
