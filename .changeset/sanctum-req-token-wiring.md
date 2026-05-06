---
'@rudderjs/sanctum': patch
'@rudderjs/server-hono': patch
---

Wire `req.token` properly and dedupe `updateLastUsed` writes (T1/T4).

- `@rudderjs/sanctum` now augments `AppRequest` with `token?: PersonalAccessToken`. `@rudderjs/server-hono` installs a getter on the normalized request that reads from the Hono context, mirroring the existing `req.user` getter. Routes mounted behind `SanctumMiddleware()` / `RequireToken()` can read `req.token` directly — previously the docs promised this but the field was never wired.
- `RequireToken()` reuses the token already validated by an upstream `SanctumMiddleware()` (read from `req.raw['__rjs_token']`). Stacks like `[SanctumMiddleware(), RequireToken('write')]` now issue exactly one `validateToken` call per request, halving the DB writes to `lastUsedAt` for authenticated API endpoints. `RequireToken()` still validates from scratch when used standalone.
