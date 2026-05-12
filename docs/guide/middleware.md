# Middleware

Middleware sits between an incoming request and your handler. Each middleware decides whether to pass control deeper (`await next()`), short-circuit with its own response, or transform the response on the way out.

## Writing middleware

The simplest middleware is a plain async function:

```ts
import type { MiddlewareHandler } from '@rudderjs/contracts'

export const requestId: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}
```

Code **before** `next()` runs on the way in. Code **after** runs on the way out. Skip `next()` to short-circuit:

```ts
const requireAdmin: MiddlewareHandler = async (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Forbidden' })
  await next()
}
```

For complex middleware with state, extend the `Middleware` class and call `.toHandler()` (or use `fromClass()` for one-shot use):

```ts
import { Middleware, fromClass } from '@rudderjs/middleware'

export class AuthMiddleware extends Middleware {
  async handle(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ message: 'Unauthorized' })
    await next()
  }
}

const handler = fromClass(AuthMiddleware)        // for global registration
const oneOff  = new AuthMiddleware().toHandler() // for per-route use
```

Generate stubs with `pnpm rudder make:middleware Auth`.

## Middleware groups (web / api)

Routes loaded via `withRouting({ web })` are tagged `'web'`. Routes loaded via `withRouting({ api })` are tagged `'api'`. Use `m.web(...)` and `m.api(...)` to scope middleware to a single group:

```ts
import { CsrfMiddleware, RateLimit } from '@rudderjs/middleware'

.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60))    // every request
  m.web(CsrfMiddleware())            // web routes only
  m.api(RateLimit.perMinute(120))   // api routes only
})
```

Execution order: **`m.use` → group middleware (`m.web` / `m.api`) → per-route middleware → handler.**

Several framework packages auto-install middleware into the `web` group when their provider boots:

- `@rudderjs/session` — session middleware
- `@rudderjs/auth` — `AuthMiddleware`

API routes stay stateless by default — `req.user` is undefined, no session is read. For token-based API auth use `@rudderjs/passport`:

```ts
// routes/api.ts
import { RequireBearer, scope } from '@rudderjs/passport'

Route.get('/api/posts', [RequireBearer(), scope('read')], handler)
```

Packages that need to install group middleware from their own provider call `appendToGroup` instead of `router.use()`:

```ts
import { appendToGroup } from '@rudderjs/core'

class MyProvider extends ServiceProvider {
  async boot() {
    appendToGroup('web', myWebOnlyMiddleware)
  }
}
```

## Per-route middleware

Pass middleware as the third argument. Use this for auth guards on specific routes, tighter rate limits, or anything that only applies to one or two endpoints:

```ts
import { RequireAuth } from '@rudderjs/auth'
import { RateLimit } from '@rudderjs/middleware'

Route.post('/posts', handler, [RequireAuth()])

Route.post('/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])
```

## Built-in middleware

### `RateLimit`

Cache-backed rate limiter. Returns a `MiddlewareHandler` directly — no `.toHandler()` needed.

```ts
m.use(RateLimit.perMinute(60))

Route.post('/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])

// Custom key
RateLimit.perMinute(60).by((req) => req.user?.id ?? req.ip)
```

Requires a registered cache adapter. Falls open if none is configured.

### `CsrfMiddleware`

Double-submit-cookie CSRF protection. Apply to web routes only — not API routes.

```ts
// Server side
import { CsrfMiddleware } from '@rudderjs/middleware'

Route.post('/contact', handler, [CsrfMiddleware()])

// Exclude paths
CsrfMiddleware({ exclude: ['/api/*'] })
```

Read the token client-side from the cookie. **Import from `@rudderjs/middleware/client`**, not the main barrel — the barrel pulls in `@rudderjs/cache` and a top-level `node:crypto` import, which Vite externalises and crashes in the browser at module-evaluation time:

```ts
// Client side
import { getCsrfToken } from '@rudderjs/middleware/client'

fetch('/contact', {
  method:  'POST',
  headers: { 'X-CSRF-Token': getCsrfToken() },
})
```

### `CorsMiddleware`

```ts
import { CorsMiddleware } from '@rudderjs/middleware'

m.use(new CorsMiddleware({
  origin:  ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  headers: ['Content-Type', 'Authorization'],
}).toHandler())
```

Defaults: `origin: '*'`, standard HTTP methods, `Content-Type` + `Authorization` headers.

### `LoggerMiddleware`

Logs `METHOD path — Nms` to the console after each request:

```ts
import { LoggerMiddleware, fromClass } from '@rudderjs/middleware'

m.use(fromClass(LoggerMiddleware))
// → [RudderJS] GET /api/users — 12ms
```

### `ThrottleMiddleware`

In-memory rate limiter for single-process deployments. Skips static assets and Vite internals automatically. For multi-process, use `RateLimit` with a Redis cache adapter instead.

```ts
m.use(fromClass(ThrottleMiddleware))                  // 60 rpm default
m.use(new ThrottleMiddleware(100, 60_000).toHandler()) // 100 per minute
```

## Errors and pipelines

Errors thrown deeper propagate up the chain — wrap `next()` in a `try/catch` to handle downstream errors locally, or let them bubble to the framework's exception handler ([Error Handling](/guide/error-handling)).

`Pipeline` composes middleware outside the router for use in jobs, scheduled tasks, or one-off scripts:

```ts
import { Pipeline } from '@rudderjs/middleware'

await new Pipeline([requestId, authMiddleware]).run(req, res, async () => {
  // final handler runs after every middleware
})
```

## Pitfalls

- **`req.user` undefined on API routes.** Expected — `AuthMiddleware` runs only on the `web` group. For API auth, use `RequireBearer()` from `@rudderjs/passport`.
- **`No session in context` on API routes.** Don't add `sessionMiddleware` to `m.use(...)` (global) — it's auto-installed on `web` by `SessionProvider.boot()`. For session on a specific API route, add `SessionMiddleware()` per-route.
- **`RateLimit` not working.** Requires `@rudderjs/cache` registered before middleware runs.
- **Custom `.by()` key broken.** Read `req.ip`, not raw headers — the server adapter normalizes the IP for you.
