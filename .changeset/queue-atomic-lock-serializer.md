---
"@rudderjs/cache": minor
"@rudderjs/queue": minor
"@rudderjs/queue-bullmq": patch
"@rudderjs/queue-inngest": patch
---

Atomic unique-lock + typed payload serializer (Phase 3 of the 2026-05-22 eventing/realtime plan):

- **`@rudderjs/cache` adds `add(key, value, ttl)`** — atomic claim (SETNX semantics). Redis: `SET NX EX`; in-memory: synchronous check-and-set. Returns `true` if THIS caller wrote, `false` if a concurrent caller got there first. Implemented on `MemoryAdapter`, `RedisAdapter`, and `FakeCacheAdapter` (also surfaces a new `'add'` entry in `CacheOperation`). Same `Cache.add(...)` shape on the static facade.
- **`acquireUniqueLock` now uses `cache.add()`** — the prior `cache.get` + `cache.set` pattern allowed two concurrent dispatchers to both read `null`, both write, and both think they acquired the lock; the duplicate `ShouldBeUnique` jobs would then run side-by-side. The new path closes the race on every driver `@rudderjs/cache` ships. The in-memory fallback (no cache provider registered) is already safe because the check-and-set runs synchronously in one event-loop tick.
- **Typed payload serializer (`encodePayload` / `decodePayload`)** — every driver previously did `JSON.parse(JSON.stringify(job))` on dispatch. `Date` round-tripped as ISO string (handlers typed `Date` saw `string`), `BigInt` threw, `Buffer` collapsed to `{type,data}`, `Map`/`Set` collapsed to `{}`/`[]`. The new serializer tags non-JSON-safe types with `{ __rj: '<tag>', value: ... }` so they survive the wire and rehydrate in the worker. Wired into `SyncAdapter`, `@rudderjs/queue-bullmq`, and `@rudderjs/queue-inngest` on both the dispatch and worker sides.
- **`safePayload` no longer hides serialisation failures** — was `try { JSON.parse(JSON.stringify(job)) } catch { return {} }`, silently dropping the entire payload (and the observer signal that something was wrong). Now propagates the error.
- **`Queue.fake()` no longer reaches for ESM `require()`** — replaced the `require('./fake.js')` workaround with a static import. The previous landmine matches [[esm-only-peer-require-bug]] — pure-ESM bundles would crash on `require` not being defined.

The serializer behavior change is a true bug fix — apps whose handlers received `string` for a `Date` field were broken; they now receive a `Date`. Apps that explicitly worked around the bug (manual `new Date(payload.field)` in the handler) keep working because the tagged shape is opaque to user code.
