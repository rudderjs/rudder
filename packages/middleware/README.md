# @rudderjs/middleware

HTTP middleware base class, pipeline runner, built-in middleware, and cache-backed rate limiting.

## Installation

```bash
pnpm add @rudderjs/middleware
```

---

## Writing Middleware

The simplest middleware is a plain async function:

```ts
import type { MiddlewareHandler } from '@rudderjs/contracts'

export const requestId: MiddlewareHandler = async (req, res, next) => {
  const id = req.headers['x-request-id'] ?? crypto.randomUUID()
  await next()
  res.header('X-Request-Id', id)
}
```

### Class-based middleware

For more complex cases, extend `Middleware` and use `fromClass()` or `.toHandler()`:

```ts
import { Middleware, fromClass } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

export class AuthMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    if (!req.headers['authorization']) {
      return res.status(401).json({ message: 'Unauthorized' })
    }
    await next()
  }
}

// Convert to a plain MiddlewareHandler
Route.get('/api/me', handler, [fromClass(AuthMiddleware)])
```

---

## Pipeline

Runs a sequence of middleware in order. The destination callback is called after all middleware pass.

```ts
import { Pipeline } from '@rudderjs/middleware'

// Constructor accepts an array
const pipeline = new Pipeline([
  requestId,
  RateLimit.perMinute(100),
])

await pipeline.run(req, res, async () => {
  res.json({ message: 'Hello' })
})

// Or fluent style
await Pipeline.make()
  .through([requestId])
  .run(req, res, async () => { res.json({ ok: true }) })
```

---

## Built-in Middleware

All built-in middleware are **callable factory functions** — no `new`, no `.toHandler()`.

### `CsrfMiddleware(options?)`

Double-submit cookie CSRF protection. Sets a `csrf_token` cookie on GET requests and validates it on mutating requests via `X-CSRF-Token` header or `_token` body field. Returns `419` on mismatch.

```ts
import { CsrfMiddleware, getCsrfToken } from '@rudderjs/middleware'

// Apply to web routes only (not API routes)
Route.post('/contact', handler, [CsrfMiddleware()])

// Exclude API webhook paths
CsrfMiddleware({ exclude: ['/api/*'] })

// Client-side: read the token from the cookie
const token = getCsrfToken()
fetch('/contact', { method: 'POST', headers: { 'X-CSRF-Token': token } })
```

| Option | Default | Description |
|---|---|---|
| `exclude` | `[]` | Paths to skip. Supports trailing `*` wildcard. |
| `cookieName` | `'csrf_token'` | Cookie name to read/write. |
| `headerName` | `'x-csrf-token'` | Request header to validate. |
| `fieldName` | `'_token'` | Body field to validate (fallback). |

### `RateLimit`

Cache-backed rate limiter. Returns a `MiddlewareHandler` with fluent configuration methods.

```ts
import { RateLimit } from '@rudderjs/middleware'

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
| `RateLimit.perHour(n)` | `n` requests per hour |
| `RateLimit.perDay(n)` | `n` requests per day |
| `RateLimit.per(n, ms)` | `n` requests per custom window (milliseconds) |
| `.byIp()` | Key by client IP (default) |
| `.byRoute()` | Key by `METHOD:path` |
| `.by(fn)` | Key by custom `(req) => string` |
| `.message(text)` | Custom 429 response message |
| `.skipIf(fn)` | Skip when `(req) => boolean` returns `true` |

Requires `@rudderjs/cache` to be registered. **Fails open** (allows the request) if no cache adapter is configured.

---

## CorsMiddleware

Class-based — use `.toHandler()` or `fromClass()`:

```ts
import { CorsMiddleware } from '@rudderjs/middleware'

const cors = new CorsMiddleware({
  origin:  ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  headers: ['Content-Type', 'Authorization'],
}).toHandler()
```

Defaults: `origin: '*'`, standard HTTP methods, `Content-Type` + `Authorization` headers.

---

## Notes

- Prefer plain `MiddlewareHandler` functions over class-based middleware — simpler, no instantiation needed.
- `CsrfMiddleware()` belongs on **web routes** only. API routes authenticate via tokens, not CSRF cookies.
- `RateLimit` uses `@rudderjs/cache` — the `memory` driver does not share state across processes. Use `redis` for distributed deployments.
- Static asset paths (`/assets/app.js`, `/@vite/client`) are automatically skipped by both `ThrottleMiddleware` and `RateLimit`.
- `sideEffects: false` — fully tree-shakable.
