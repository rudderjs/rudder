---
"@rudderjs/cache": patch
---

`RedisAdapter` now uses `resolveIoredisClass` from `@rudderjs/support` instead of an inline CJS/ESM interop fallback. Behaviour identical; removes the duplicated fallback chain that also lives in `@rudderjs/broadcast-redis`.
