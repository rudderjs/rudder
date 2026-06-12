# Rate Limiting

`RateLimit` (from `@rudderjs/middleware`) is a cache-backed rate limiter. The same builder works as a global guard, a group guard, or per-route — and the limits are shared across processes when you back the cache with Redis.

## Quick reference

```ts
import { RateLimit } from '@rudderjs/middleware'

// Global — 60 requests per minute per IP
m.use(RateLimit.perMinute(60))

// Tighter per-route limit on sign-in
Route.post('/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])

// Custom key — limit per user, not per IP
RateLimit.perMinute(60).by((req) => req.user?.id ?? req.ip)
```

`RateLimit.perMinute(n)` / `perHour(n)` / `perDay(n)` are the common entry points. For arbitrary windows, use `RateLimit.per(n, windowMs)`.

## Builder methods

| Method | Description |
|---|---|
| `RateLimit.perMinute(n)` / `.perHour(n)` / `.perDay(n)` | Convenience constructors — all key by IP |
| `RateLimit.per(n, windowMs)` | Arbitrary window in milliseconds |
| `.byIp()` | Key by IP (default) |
| `.byRoute()` | Key by IP + route path |
| `.by(fn)` | Custom key function — receives `req` |
| `.message(text)` | Body returned on 429 |
| `.skipIf(fn)` | Skip rate-limiting when the predicate returns true |
| `.toHandler()` | _Deprecated._ The builder is already a `MiddlewareHandler` — use it directly. Kept for backwards compatibility. |

The builder is immutable — chaining returns a new instance, so it's safe to share between routes:

```ts
const tight = RateLimit.perMinute(5)

Route.post('/auth/sign-in',  handler, [tight.message('Too many login attempts.')])
Route.post('/auth/sign-up',  handler, [tight.message('Too many registration attempts.')])
```

## Keying

By default, the limiter keys on `req.ip` — every IP gets its own bucket. Two common alternatives:

```ts
// Per authenticated user (falls back to IP)
RateLimit.perMinute(60).by((req) => req.user?.id ?? req.ip)

// Per route + IP — tightens the bucket so a heavy POST doesn't starve GET on the same IP
RateLimit.perMinute(60).by((req) => `${req.ip}:${req.path}`)
```

Always use `req.ip`, not raw headers. The server adapter normalizes IPv6 loopback (`::1` → `127.0.0.1`) and respects `TRUST_PROXY` (Laravel `Request::ip()` parity): with it on, proxy headers win (`x-forwarded-for`'s first hop, then `x-real-ip`); with it off, client-sent proxy headers are ignored and the direct socket address is used. Reading raw headers in `.by()` produces inconsistent results across dev and production.

## Multi-process deployments

The limiter is **cache-backed**. To share counts across processes, register a Redis cache before any middleware runs:

```ts
// config/cache.ts
{
  default: 'redis',
  stores:  { redis: { driver: 'redis', host: '...', port: 6379 } },
}
```

With the in-memory cache (default), each process has its own counter — a 60/min limit becomes 60/min × N processes. That's fine for single-instance deployments and bad for everything else.

If no cache is registered when `RateLimit` runs, it **fails open** (allows everything). The framework prints a one-time warning the first time a limiter runs without a cache adapter to surface this.

## Group middleware

For "all API routes get the same limit," register on the group rather than per-route:

```ts
.withMiddleware((m) => {
  m.api(RateLimit.perMinute(120))     // every API route
  m.web(RateLimit.perMinute(60))      // every web route
})
```

See [Middleware](/guide/middleware) for the full middleware-group model.

## Response shape

When the limit triggers, the limiter returns:

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714000060
Retry-After: 32
Content-Type: application/json

{"message":"Too many login attempts."}
```

`Retry-After` is the seconds until the next allowed request. The body is JSON with a `message` key drawn from `.message(...)` (default: `"Too many requests. Please slow down."`).

## Pitfalls

- **No cache adapter.** The limiter fails open. Either register a cache provider before middleware runs, or accept that the limit is advisory only.
- **In-memory cache in production.** Each process has its own counters. Use Redis for any deployment with more than one Node process.
- **Raw headers in `.by()`.** Use `req.ip`. The server normalizes; raw headers don't.
- **Limit shared across very different routes.** If `/api/login` (sensitive) and `/api/healthz` (trivial) share the same key, the healthcheck eats the budget. Tighten the key with `:${req.path}`.
