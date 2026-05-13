---
"@rudderjs/session": patch
---

Internal cleanup: centralize `req.raw`/`res.raw` typed-bag access behind `attachSession()` + a single `HonoContextLike` interface, narrow `JSON.parse(...) as SessionPayload` behind a shared `parsePayload()` helper used by both the cookie and redis drivers, drop the `as any` + eslint-disable on the dynamic `ioredis` import, and drop the redundant `as string | undefined` on `req.headers['cookie']` (already typed via `noUncheckedIndexedAccess`). Added tests for `Session.maybeCurrent()` / `Session.active()` / `Session.allFlash()` outside an ALS context (no throw, returns `null` / `false` / `{}`), and two redis-driver hardening tests covering malformed JSON and shape-invalid (`id` not a string) payloads with a valid HMAC — both must mint a fresh session rather than leak corrupt data through to `SessionInstance`. No public API changes.
