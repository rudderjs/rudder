---
'@rudderjs/session': patch
---

Driver hygiene fixes for `@rudderjs/session`. No API changes; behavior is identical for the happy path.

- **S4: RedisDriver caches the connect-promise, not the client.** The previous lazy init (`if (!this.client) this.client = new Redis(...)`) was racy — two concurrent first-request callers each fell through the guard and constructed a separate ioredis instance, leaking the first one's FD and retry timer. We now cache `Promise<Client>` so concurrent callers all await the same in-flight connect; rejected promises are dropped so a transient connect failure can be retried on the next call.
- **S5: `SessionMiddleware()` reuses the container-bound singleton.** The factory previously called `sessionMiddleware(config)` on each call, building a fresh driver per route — every api-route opt-in spawned an independent RedisDriver. It now returns `app().make('session.middleware')`, the singleton bound by `SessionProvider.boot()`, so per-route mounts share the same connection as the auto-installed web group.
- **S6: `SessionInstance` tolerates legacy/corrupt payloads.** The constructor unconditionally read `payload.flash_next`, throwing on entries that omitted the field (legacy redis writes, third-party producers, manual `redis-cli` edits). Missing `flash_next` and `data` now default to `{}`.
- **S7: Documented cookie-driver `regenerate()` / `destroy()` limitation.** The cookie driver is stateless — there is no server-side store to delete from, so `regenerate()` cannot invalidate the previous signed cookie before its `Max-Age` expires. JSDoc and a new "Driver tradeoffs" table in the README now spell this out, so apps that need true post-logout invalidation know to use the redis driver.
