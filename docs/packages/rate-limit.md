# Rate Limiting

> **Merged into `@rudderjs/middleware`** — `RateLimit` and `RateLimitBuilder` are now part of the middleware package.

```ts
import { RateLimit } from '@rudderjs/middleware'

// Global rate limit
m.use(RateLimit.perMinute(60).toHandler())

// Per-route with custom key
const authLimit = RateLimit.perMinute(10)
  .by(req => `${req.headers['x-forwarded-for']}:${req.path}`)
  .message('Too many attempts.')

router.post('/api/login', handler, [authLimit])
```

See the [Middleware docs](./core/middleware.md) for full documentation.
