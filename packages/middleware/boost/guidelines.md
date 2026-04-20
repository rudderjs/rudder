# @rudderjs/middleware

## Overview

HTTP middleware primitives — base `Middleware` class, `Pipeline` runner, `fromClass()` adapter, and built-in middleware: `CsrfMiddleware`, `RateLimit` (fluent cache-backed limiter), `CorsMiddleware`, `LoggerMiddleware`, `ThrottleMiddleware`. `RateLimit` requires `@rudderjs/cache`; `ThrottleMiddleware` is cache-backed too.

## Key Patterns

### Writing middleware

Plain async function is the simplest shape. Reach for the class form only when you need constructor state or DI.

```ts
import type { MiddlewareHandler } from '@rudderjs/contracts'

export const requestId: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}

// Class form
import { Middleware, fromClass } from '@rudderjs/middleware'

export class LoggerMw extends Middleware {
  async handle(req, res, next) {
    console.log(`→ ${req.method} ${req.path}`)
    await next()
  }
}

// Attach
Route.get('/api/users', handler, [fromClass(LoggerMw)])
```

### Where to register

```ts
// bootstrap/app.ts
.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60))    // global — every request
  m.web(CsrfMiddleware())            // web group only
  m.api(RateLimit.perMinute(120))   // api group only
})

// routes/web.ts — per-route for fine-grained control
Route.post('/contact', handler, [CsrfMiddleware({ exclude: ['/webhooks/*'] })])
```

Execution order: `m.use` → group (`m.web` / `m.api`) → per-route → handler.

### RateLimit

Cache-backed, fluent API. **Requires a cache provider registered before middleware runs** — without it, it fails open (allows the request).

```ts
import { RateLimit } from '@rudderjs/middleware'

RateLimit.perMinute(60)                         // global: 60/minute per IP
RateLimit.perHour(1000)                          // per-hour bucket
RateLimit.per(5, 60_000)                         // custom window (ms)

RateLimit.perMinute(5)
  .byRoute()                                     // key by METHOD:path (default: by IP)
  .by(req => req.user?.id ?? req.ip)             // key by custom function
  .message('Too many login attempts.')
  .skipIf(req => req.headers['x-internal'] === '1')
```

Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` headers. Returns 429 on exceed.

**Custom `.by()` functions must read `req.ip`, not raw headers.** `req.ip` is set by server-hono's `extractIp()` and is the canonical source — raw `x-real-ip` isn't populated in all transports.

### CsrfMiddleware

Double-submit cookie CSRF. Sets a `csrf_token` cookie on GET, validates `X-CSRF-Token` header (or `_token` body field) on mutating methods. 419 on mismatch. Install on the `web` group; api routes use bearer auth, not CSRF cookies.

```ts
CsrfMiddleware({ exclude: ['/webhooks/*'] })
```

### Pipeline (standalone)

Compose middleware outside the router — useful for CLI commands, jobs, testing:

```ts
import { Pipeline } from '@rudderjs/middleware'

await new Pipeline([requestId, fromClass(LoggerMw)]).run(req, res, async () => {
  // final handler
})
```

## Common Pitfalls

- **`RateLimit` without cache provider.** Fails open silently (allows the request) if `@rudderjs/cache` isn't registered. Always register cache first.
- **`.by()` reading raw headers.** Use `req.ip` (set by server-hono's `extractIp()`), not `req.headers['x-real-ip']`. Dev-mode IP is injected by `@rudderjs/vite`'s `rudderjs:ip` plugin; raw headers may be unset.
- **`CsrfMiddleware` on api routes.** CSRF is a browser-cookie concept. API routes authenticate via tokens — don't install CSRF there.
- **Static-asset paths and throttle.** Both `ThrottleMiddleware` and `RateLimit` auto-skip `/assets/*`, `/@vite/*`, and other Vite dev internals. Don't try to exclude them manually.
- **`memory` cache driver and distributed deployments.** `ThrottleMiddleware` and `RateLimit` backed by the memory cache driver don't share state across processes. Use Redis for anything multi-process.
- **`fromClass()` vs `.toHandler()`.** `fromClass(Class)` instantiates with no args. For middleware classes with constructor args, `new MyMw(opts).toHandler()` instead.

## Key Imports

```ts
// Base class + pipeline
import { Middleware, Pipeline, fromClass } from '@rudderjs/middleware'

// Built-ins
import { CsrfMiddleware, getCsrfToken } from '@rudderjs/middleware'
import { RateLimit } from '@rudderjs/middleware'
import { CorsMiddleware, LoggerMiddleware, ThrottleMiddleware } from '@rudderjs/middleware'

// Utils
import { clientIp } from '@rudderjs/middleware'

// Types
import type { MiddlewareHandler } from '@rudderjs/contracts'
```
