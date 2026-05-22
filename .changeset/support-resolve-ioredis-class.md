---
"@rudderjs/support": minor
---

Add `resolveIoredisClass<R>(mod)` — resolves the `Redis` constructor across the CJS/ESM interop variants `ioredis` ships. Pass the result of `import('ioredis')` (dynamic) or `import * as _ioredis from 'ioredis'` (static) and get back the class. Throws when no recognized shape matches — surfaces ioredis upgrade-shape changes loudly instead of silently constructing `undefined`.

Shared by `@rudderjs/cache` (RedisAdapter) and `@rudderjs/broadcast-redis` (RedisDriver). Apps don't normally call this — it's a peer-resolver shim.
