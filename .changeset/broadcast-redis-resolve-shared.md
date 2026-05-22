---
"@rudderjs/broadcast-redis": patch
---

`RedisDriver` now uses `resolveIoredisClass` from `@rudderjs/support` instead of an inline CJS/ESM interop fallback. Behaviour identical.

Also adds `pnpm smoke` (`smoke/multi-instance.mjs`) — a manual end-to-end smoke that spawns two child Node processes, each running its own WebSocket server backed by the same Redis pub/sub, and asserts cross-instance fan-out. Run with a local Redis (`docker run --rm -p 6379:6379 redis`) to validate any changes to the driver contract. The smoke script is excluded from the published tarball.
