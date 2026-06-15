---
"@rudderjs/cache": patch
---

Close the three deferred cache hardening gaps from the security dive.

- **The lock namespace is now reserved from the value API.** Locks live in the same keyspace under `__lock__:<name>`, so an un-guarded `Cache.set('__lock__:job', token)` could forge a lock's owner token, `Cache.forget('__lock__:job')` could destroy a held lock, and `Cache.get('__lock__:job')` could read the secret token — all from the ordinary value API with a caller-influenced key. Value operations (`get`/`set`/`forget`/`has`/`increment`/`add`/`pull`) now throw on any key starting with the reserved `__lock__:` prefix, on every driver.
- **`Cache.pull()` is now atomic.** It was a separate get-then-forget, so two concurrent `pull`s of a one-time token (idempotency key, single-use nonce) could both observe the same value. Drivers now expose an atomic read-and-remove — Redis via a Lua `GET`+`DEL`, in-memory via a synchronous get+delete — so exactly one caller wins; adapters without it keep the get-then-forget fallback.
- **Redis `flush()` no longer blocks the server or mis-matches a glob-bearing prefix.** It used `KEYS ${prefix}*`, which is O(N) and stalls the whole Redis instance on a large keyspace, and treated the prefix as a glob (so a prefix like `app[staging]:` matched the wrong keys). It now walks the keyspace with a non-blocking `SCAN` cursor over a glob-escaped prefix.
