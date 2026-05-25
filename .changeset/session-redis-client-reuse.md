---
"@rudderjs/session": patch
---

Reuse one Redis client across dev HMR re-boots. `SessionProvider.boot()` rebuilds the `RedisDriver` on every `app/` edit, so without reuse each re-boot opened (and leaked) a fresh ioredis connection. The driver now routes client construction through `@rudderjs/support`'s `reusableConnection` (keyed by `url` / `host:port:password`), reusing the live client across re-boots and disposing it on a connection-signature change. No-op in production.
