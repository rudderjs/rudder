---
'@rudderjs/session': patch
---

Security fixes for the session middleware. Redis-driver users will be silently logged out once on upgrade — existing unsigned cookies fail verification and a fresh signed cookie is issued on the next request.

- **Redis driver: HMAC-sign the cookie value.** The redis driver previously stored the raw session UUID in the cookie and used it as the redis key. An attacker who guessed, sniffed, or enumerated a UUID could hijack the session — true bearer-token semantics, despite the README emphasising signed cookies. The cookie value is now `${id}.${hmac}` (HMAC-SHA256 over the id, keyed by `session.secret`) and `RedisDriver.load()` verifies the signature before touching redis.
- **Redis driver: cache miss no longer fixates on the cookie-supplied id.** The previous behaviour returned an empty session keyed by the cookie value (`emptyWithId(cookieValue)`), letting an attacker plant an id, wait for the victim to log in under it, and then replay the cookie. Cache misses now mint a fresh UUID, so a planted (or expired-then-replayed) id can never carry forward into a new session.
- **Middleware: persist session on error.** `await _als.run(session, next); await session.save(res)` skipped `save()` when `next()` threw, dropping flash messages on error redirects and never writing `Set-Cookie` for new sessions on error responses. `session.save()` now runs in a finally-style block; errors from `save()` only surface when `next()` did not already throw, so the original handler exception is never masked.
