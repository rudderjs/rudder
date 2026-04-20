# Middleware

Middleware intercepts HTTP requests and responses. RudderJS supports plain functions (recommended), class-based middleware, and a pipeline runner.

## Writing Middleware

The simplest middleware is a plain async function:

```ts
import type { MiddlewareHandler } from '@rudderjs/contracts'

export const requestIdMiddleware: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}
```

Key points:
- Call `await next()` to pass control to the next middleware or handler
- Code **before** `next()` runs on the way in; code **after** runs on the way out
- Skip `next()` to short-circuit the chain (e.g. return a 401 early)

### Class-Based Middleware

For more complex cases, extend `Middleware` and use `fromClass()`:

```ts
import { Middleware, fromClass } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

export class AuthMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    const token = req.headers['authorization']?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ message: 'Unauthorized' })
    await next()
  }
}

// Convert to a plain MiddlewareHandler
const authHandler = fromClass(AuthMiddleware)
```

Or call `.toHandler()` on an instance for one-off use:

```ts
const authHandler = new AuthMiddleware().toHandler()
```

---

## Global Middleware

Register middleware that runs on every request in `bootstrap/app.ts`:

```ts
import { RateLimit, fromClass, LoggerMiddleware } from '@rudderjs/middleware'
import { requestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.js'

Application.configure({ ... })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60))
    m.use(requestIdMiddleware)
    // class-based:
    m.use(fromClass(LoggerMiddleware))
  })
```

---

## Middleware Groups (web / api)

Routes loaded via `withRouting({ web })` are tagged `web`; via `withRouting({ api })` tagged `api`. Use `m.web(...)` and `m.api(...)` to scope middleware to a single group — Laravel-style:

```ts
import { CsrfMiddleware, RateLimit } from '@rudderjs/middleware'

.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60))    // global — every request
  m.web(CsrfMiddleware())            // web routes only
  m.api(RateLimit.perMinute(120))   // api routes only
})
```

**Execution order** is `m.use` → group (`m.web` / `m.api`) → per-route middleware → handler.

**Framework packages auto-install into the `web` group:**

- `@rudderjs/session` — session middleware on every web route
- `@rudderjs/auth` — `AuthMiddleware` on every web route

Api routes stay stateless by default — `req.user` is undefined, no session is read. For token-based api auth use `@rudderjs/passport`:

```ts
// routes/api.ts
import { RequireBearer, scope } from '@rudderjs/passport'

Route.get('/api/posts', [RequireBearer(), scope('read')], handler)
```

**Provider-facing helper** — packages install their own group middleware via `appendToGroup`:

```ts
import { appendToGroup } from '@rudderjs/core'

class MyProvider extends ServiceProvider {
  async boot() {
    appendToGroup('web', myWebOnlyMiddleware)
  }
}
```

---

## Route-Level Middleware

Pass middleware as the third argument to any route. Use this for auth guards on specific routes, tighter rate limits, or anything that only applies to one or two endpoints:

```ts
import { Route } from '@rudderjs/router'
import { RequireAuth } from '@rudderjs/auth'
import { RateLimit } from '@rudderjs/middleware'

// Auth on a specific route (web routes already have AuthMiddleware; this just enforces 401)
Route.post('/posts', handler, [RequireAuth()])

// Tight rate limit on login
Route.post('/api/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])
```

Group-level middleware (`m.web`, `m.api`) covers the bulk of cases — per-route middleware is for the exceptions.

---

## Built-in Middleware

### `CsrfMiddleware(options?)`

Double-submit cookie CSRF protection. Apply to web routes only — not API routes.

```ts
import { CsrfMiddleware, getCsrfToken } from '@rudderjs/middleware'

Route.post('/contact', handler, [CsrfMiddleware()])

// Exclude paths
CsrfMiddleware({ exclude: ['/api/*'] })
```

On the client, read the token from the cookie:

```ts
fetch('/contact', {
  method: 'POST',
  headers: { 'X-CSRF-Token': getCsrfToken() },
})
```

### `RateLimit`

Cache-backed rate limiter. Returns a `MiddlewareHandler` directly — no `.toHandler()` needed.

```ts
import { RateLimit } from '@rudderjs/middleware'

// Global
m.use(RateLimit.perMinute(60))

// Per-route with custom message
Route.post('/api/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])
```

Requires `@rudderjs/cache` to be registered. Fails open if no cache adapter is configured.

### `CorsMiddleware`

```ts
import { CorsMiddleware, fromClass } from '@rudderjs/middleware'

m.use(new CorsMiddleware({
  origin:  ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  headers: ['Content-Type', 'Authorization'],
}).toHandler())
```

Defaults: `origin: '*'`, standard HTTP methods, `Content-Type` + `Authorization` headers.

### `LoggerMiddleware`

Logs `METHOD path — Nms` to the console after each request.

```ts
import { LoggerMiddleware, fromClass } from '@rudderjs/middleware'

m.use(fromClass(LoggerMiddleware))
// → [RudderJS] GET /api/users — 12ms
```

### `ThrottleMiddleware`

In-memory rate limiter. Automatically skips static assets and Vite internals. For multi-process deployments use `RateLimit` with a Redis cache adapter instead.

```ts
import { ThrottleMiddleware, fromClass } from '@rudderjs/middleware'

// defaults: 60 requests per minute
m.use(fromClass(ThrottleMiddleware))

// custom limits
m.use(new ThrottleMiddleware(100, 60_000).toHandler())
```

---

## The Pipeline

`Pipeline` composes middleware outside of the router:

```ts
import { Pipeline, fromClass, LoggerMiddleware } from '@rudderjs/middleware'

await new Pipeline([
  fromClass(LoggerMiddleware),
  requestIdMiddleware,
]).run(req, res, async () => {
  // final handler
})
```

---

## Middleware Order

Middleware runs in registration order, following the onion model:

```
Request
  → Middleware A (before next)
    → Middleware B (before next)
      → Handler
    → Middleware B (after next)
  → Middleware A (after next)
Response
```

---

## Error Handling in Middleware

Errors thrown in middleware propagate up the chain. Wrap `next()` to catch downstream errors:

```ts
async handle(req, res, next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(422).json({ message: err.message })
    }
    throw err
  }
}
```

---

## Generating Middleware

```bash
pnpm rudder make:middleware Auth
# → app/Http/Middleware/AuthMiddleware.ts
```
