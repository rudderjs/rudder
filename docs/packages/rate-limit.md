# Rate Limiting & CSRF

`@boostkit/middleware` includes cache-backed rate limiting with standard X-RateLimit-* headers.

## Installation

```bash
pnpm add @boostkit/middleware
```

## Usage

`@boostkit/middleware` requires `@boostkit/cache` to be registered in your providers first, as it uses the cache store to track request counts per key.

### Global Middleware

Apply rate limiting to all API requests in `bootstrap/app.ts`:

```ts
// bootstrap/app.ts
import { Application } from '@boostkit/core'
import { RateLimit } from '@boostkit/middleware'
import { hono } from '@boostkit/server-hono'
import configs from '../config/index.js'
import providers from './providers.js'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.js'),
    commands: () => import('../routes/console.js'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60).byIp().toHandler())
  })
  .create()
```

### Per-Route with `@Middleware` Decorator

Apply a stricter limit to a specific controller action:

```ts
import { Controller, Post, Middleware } from '@boostkit/router'
import { RateLimit } from '@boostkit/middleware'

@Controller('/api/auth')
export class AuthController {
  @Post('/login')
  @Middleware([RateLimit.perMinute(10).byIp().toHandler()])
  async login(req, res) {
    // ...
  }
}
```

### Per-Route with Fluent Router

```ts
import { router } from '@boostkit/router'
import { RateLimit } from '@boostkit/middleware'

router.post(
  '/api/auth/login',
  RateLimit.perMinute(10).byIp().toHandler(),
  async (req, res) => {
    // ...
  }
)
```

## Examples

### Limit by IP address

```ts
RateLimit.perMinute(60).byIp().toHandler()
```

### Limit by route + IP combination

```ts
RateLimit.perHour(1000).byRoute().toHandler()
```

### Limit by a custom key (e.g. API key header)

```ts
RateLimit.per(100, 300_000)
  .by((req) => req.headers['x-api-key'] as string ?? req.ip)
  .toHandler()
```

### Custom error message

```ts
RateLimit.perMinute(30)
  .byIp()
  .message('Slow down — too many requests.')
  .toHandler()
```

### Skip rate limiting conditionally

```ts
RateLimit.perMinute(60)
  .byIp()
  .skipIf((req) => req.headers['x-internal-token'] === process.env.INTERNAL_TOKEN)
  .toHandler()
```

## API Reference

### `RateLimit` Static Factory

| Method | Description |
|---|---|
| `RateLimit.perMinute(max)` | Allow `max` requests per 60-second window |
| `RateLimit.perHour(max)` | Allow `max` requests per 3600-second window |
| `RateLimit.perDay(max)` | Allow `max` requests per 86400-second window |
| `RateLimit.per(max, windowMs)` | Allow `max` requests per custom `windowMs` window |

Each factory method returns a `RateLimitBuilder` instance.

### `RateLimitBuilder` Chainable API

| Method | Description |
|---|---|
| `.byIp()` | Key requests by client IP address |
| `.byRoute()` | Key requests by `${method}:${path}:${ip}` |
| `.by(fn)` | Key requests by a custom function `(req: AppRequest) => string` |
| `.message(msg)` | Custom message included in the 429 response body |
| `.skipIf(fn)` | Skip rate limiting when `fn(req)` returns `true` |
| `.toHandler()` | Build and return a `MiddlewareHandler` ready for use |

### Response Headers

When rate limiting is active, the following headers are set on every response:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |

### 429 Response

When a client exceeds the limit, the middleware returns a `429 Too Many Requests` response with a JSON body:

```json
{
  "message": "Too many requests. Please try again later."
}
```

The `message` field reflects the value set via `.message()`, or the default shown above.

## Notes

- `@boostkit/cache` must be registered in `bootstrap/providers.ts` before rate limiting middleware is applied. The rate limiter uses the default cache store to track counters.
- Static assets and Vite internals (HMR, `/@vite/`, `/__vite_ping`) are automatically excluded from rate limiting.
- Counters are stored with a TTL matching the window duration — they expire automatically without manual cleanup.
- In a multi-process or multi-instance deployment, use the `redis` cache driver (`pnpm add ioredis`) so rate limit counters are shared across instances.

---

# CSRF Protection

`CsrfMiddleware` uses the **double-submit cookie** pattern to protect mutation endpoints from cross-site request forgery.

## How It Works

1. On every `GET` request, the middleware sets a `csrf_token` cookie (readable by JS, not `HttpOnly`).
2. On `POST` / `PUT` / `PATCH` / `DELETE` requests, it validates that the request includes a matching token via the `X-CSRF-Token` header or a `_token` body field.
3. If the token is missing or mismatched, it returns `419 CSRF token mismatch.`.

## Setup

Register globally in `bootstrap/app.ts`. Exclude routes that manage their own CSRF (e.g. `better-auth`):

```ts
import { CsrfMiddleware } from '@boostkit/middleware'

Application.configure({ ... })
  .withMiddleware((m) => {
    m.use(new CsrfMiddleware({ exclude: ['/api/auth/*'] }).toHandler())
  })
  .create()
```

## Client-Side

Use `getCsrfToken()` to read the cookie value and attach it to requests:

```ts
import { getCsrfToken } from '@boostkit/middleware'

await fetch('/api/contact', {
  method:  'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getCsrfToken(),
  },
  body: JSON.stringify(data),
})
```

`getCsrfToken()` is SSR-safe — it returns `''` on the server and reads `document.cookie` in the browser.

## Options

```ts
new CsrfMiddleware({
  exclude:    ['/api/auth/*', '/webhooks/*'],  // paths to skip (trailing * wildcard)
  cookieName: 'csrf_token',   // default
  headerName: 'x-csrf-token', // default
  fieldName:  '_token',       // body field fallback, default
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `exclude` | `string[]` | `[]` | Paths to skip CSRF validation. Supports trailing `*` wildcard. |
| `cookieName` | `string` | `'csrf_token'` | Cookie name set on GET requests. |
| `headerName` | `string` | `'x-csrf-token'` | Request header name checked on mutations. |
| `fieldName` | `string` | `'_token'` | Body field name checked as fallback to the header. |

## 419 Response

When the token is missing or does not match:

```json
{
  "message": "CSRF token mismatch.",
  "error": "CSRF_MISMATCH"
}
```

## Notes

- Static assets and Vite internals are automatically skipped.
- `getCsrfToken()` uses `globalThis.document` — safe to import in shared server/client code.
- `better-auth` routes (`/api/auth/*`) should always be excluded — better-auth handles its own CSRF protection.
