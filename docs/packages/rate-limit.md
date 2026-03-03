# @forge/rate-limit

Cache-backed rate limiting middleware with standard X-RateLimit-* headers.

## Installation

```bash
pnpm add @forge/rate-limit
```

## Usage

`@forge/rate-limit` requires `@forge/cache` to be registered in your providers first, as it uses the cache store to track request counts per key.

### Global Middleware

Apply rate limiting to all API requests in `bootstrap/app.ts`:

```ts
// bootstrap/app.ts
import { Application } from '@forge/core'
import { RateLimit } from '@forge/rate-limit'
import { hono } from '@forge/server-hono'
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
import { Controller, Post, Middleware } from '@forge/router'
import { RateLimit } from '@forge/rate-limit'

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
import { router } from '@forge/router'
import { RateLimit } from '@forge/rate-limit'

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
| `.by(fn)` | Key requests by a custom function `(req: ForgeRequest) => string` |
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

- `@forge/cache` must be registered in `bootstrap/providers.ts` before rate limiting middleware is applied. The rate limiter uses the default cache store to track counters.
- Static assets and Vite internals (HMR, `/@vite/`, `/__vite_ping`) are automatically excluded from rate limiting.
- Counters are stored with a TTL matching the window duration — they expire automatically without manual cleanup.
- In a multi-process or multi-instance deployment, use `@forge/cache-redis` as the cache backend so counters are shared across instances.
