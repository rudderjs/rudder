# @boostkit/middleware

HTTP middleware base class, pipeline runner, built-in implementations, and rate limiting.

```bash
pnpm add @boostkit/middleware
```

---

## Writing Middleware

The simplest middleware is a plain async function matching `MiddlewareHandler`:

```ts
import type { MiddlewareHandler } from '@boostkit/contracts'

export const requestIdMiddleware: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}
```

Register globally in `bootstrap/app.ts`:

```ts
.withMiddleware((m) => {
  m.use(requestIdMiddleware)
})
```

Or per-route in `routes/api.ts`:

```ts
Route.get('/api/me', handler, [requestIdMiddleware])
```

### Class-Based Middleware

For more complex middleware, extend the `Middleware` base class:

```ts
import { Middleware, fromClass } from '@boostkit/middleware'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

export class LoggingMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    console.log(`→ ${req.method} ${req.path}`)
    await next()
    console.log(`← done`)
  }
}

Route.get('/api/users', handler, [fromClass(LoggingMiddleware)])
```

`fromClass(MiddlewareClass)` instantiates the class (no-arg constructor) and returns a plain `MiddlewareHandler`.

---

## Built-in Middleware

### `CsrfMiddleware(options?)`

Double-submit cookie CSRF protection. Sets a `csrf_token` cookie on every GET request (readable by JS, not HttpOnly) and validates that mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) include a matching token via the `X-CSRF-Token` header or `_token` body field. Returns `419` on mismatch.

Apply to **web routes only** — not API routes.

```ts
import { CsrfMiddleware, getCsrfToken } from '@boostkit/middleware'

Route.post('/contact', handler, [CsrfMiddleware()])

// Exclude API webhook paths
CsrfMiddleware({ exclude: ['/api/*'] })
```

| Option | Default | Description |
|---|---|---|
| `exclude` | `[]` | Paths to skip CSRF validation. Supports trailing `*` wildcard. |
| `cookieName` | `'csrf_token'` | Cookie name. |
| `headerName` | `'x-csrf-token'` | Request header to validate. |
| `fieldName` | `'_token'` | Body field to validate (fallback when header is absent). |

#### `getCsrfToken(cookieName?)`

Client-side helper to read the CSRF token from the browser cookie. Returns `''` in SSR/non-browser environments.

```ts
import { getCsrfToken } from '@boostkit/middleware'

fetch('/contact', {
  method: 'POST',
  headers: {
    'Content-Type':  'application/json',
    'X-CSRF-Token':  getCsrfToken(),
  },
  body: JSON.stringify(data),
})
```

---

### `RateLimit`

Cache-backed rate limiter. Returns a `MiddlewareHandler` directly — no `.toHandler()` needed.

```ts
import { RateLimit } from '@boostkit/middleware'

// Global — 60 requests/minute per IP
m.use(RateLimit.perMinute(60))

// Per-route with custom config
const loginLimit = RateLimit.perMinute(5)
  .message('Too many login attempts. Try again later.')
  .skipIf(req => req.headers['x-internal'] === '1')

Route.post('/api/auth/sign-in', handler, [loginLimit])
```

Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After` headers. Returns `429` when the limit is exceeded.

**Fluent methods:**

| Method | Description |
|---|---|
| `RateLimit.perMinute(n)` | `n` requests per 60 seconds |
| `RateLimit.perHour(n)` | `n` requests per 3600 seconds |
| `RateLimit.perDay(n)` | `n` requests per 86400 seconds |
| `RateLimit.per(n, ms)` | `n` requests per custom window (**milliseconds**) |
| `.byIp()` | Key by client IP (default) |
| `.byRoute()` | Key by `METHOD:path` |
| `.by(fn)` | Key by custom `(req) => string` |
| `.message(text)` | Custom 429 response message |
| `.skipIf(fn)` | Skip when `(req) => boolean` returns `true` |

**Stacking:** Global and per-route limits are independent — each has its own counter.

**Requires** `@boostkit/cache` to be registered. Fails open (allows the request) if no cache adapter is configured.

---

### `CorsMiddleware`

Class-based — use `.toHandler()` or `fromClass()`:

```ts
import { CorsMiddleware } from '@boostkit/middleware'

const cors = new CorsMiddleware({
  origin:  ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  headers: ['Content-Type', 'Authorization'],
}).toHandler()

m.use(cors)
```

Defaults: `origin: '*'`, standard HTTP methods, `Content-Type` + `Authorization` headers.

---

### `LoggerMiddleware`

Logs `METHOD path — Nms` to the console after each request completes.

```ts
import { LoggerMiddleware, fromClass } from '@boostkit/middleware'

m.use(fromClass(LoggerMiddleware))
// → [BoostKit] GET /api/users — 12ms
```

---

### `ThrottleMiddleware`

In-memory rate limiter (no external cache required). Useful for development or single-process deployments. Automatically skips static assets and Vite internals.

```ts
import { ThrottleMiddleware, fromClass } from '@boostkit/middleware'

// 60 requests per minute per IP
m.use(fromClass(ThrottleMiddleware))

// Custom limits
m.use(new ThrottleMiddleware(100, 60_000).toHandler())
```

::: warning
`ThrottleMiddleware` stores state in-memory and does not share across processes. Use `RateLimit` with a Redis cache adapter for distributed deployments.
:::

---

## Pipeline

`Pipeline` runs a sequence of `MiddlewareHandler` functions in order, following the onion model (post-`next()` code runs in reverse order). Use it to compose middleware outside of the router.

```ts
import { Pipeline } from '@boostkit/middleware'

// Constructor accepts an array
const pipeline = new Pipeline([
  requestIdMiddleware,
  RateLimit.perMinute(100),
])

await pipeline.run(req, res, async () => {
  res.json({ message: 'Hello' })
})

// Or fluent style
await Pipeline.make()
  .through([requestIdMiddleware])
  .run(req, res, async () => { res.json({ ok: true }) })
```

---

## MiddlewareHandler Type

`MiddlewareHandler` is the canonical function signature for all middleware in BoostKit. Exported from `@boostkit/contracts` and re-exported here for convenience.

```ts
type MiddlewareHandler = (
  req: AppRequest,
  res: AppResponse,
  next: () => Promise<void>,
) => unknown | Promise<unknown>
```

---

## Notes

- Prefer plain `MiddlewareHandler` functions over class-based middleware — simpler, no instantiation needed.
- `CsrfMiddleware()` belongs on **web routes** only. API clients authenticate via tokens, not CSRF cookies.
- `RateLimit` uses `@boostkit/cache`. The `memory` driver does not share state across processes — use `redis` for distributed deployments.
- `@boostkit/middleware` depends on `@boostkit/contracts` and `@boostkit/cache`. It does not depend on `@boostkit/core`, so it can be used in adapters and edge middleware without pulling in the full framework.
- `sideEffects: false` — fully tree-shakable.
