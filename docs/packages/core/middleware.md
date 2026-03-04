# @boostkit/middleware

HTTP middleware base class, pipeline runner, and built-in implementations.

```bash
pnpm add @boostkit/middleware
```

---

## Usage

### Writing a Middleware

Extend the `Middleware` base class and implement the `handle` method. Call `next(req, res)` to pass control to the next middleware or route handler.

```ts
import { Middleware } from '@boostkit/middleware'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

export class AuthMiddleware extends Middleware {
  async handle(
    req: AppRequest,
    res: AppResponse,
    next: (req: AppRequest, res: AppResponse) => Promise<unknown>,
  ) {
    const token = req.headers['authorization']

    if (!token || !token.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized' })
    }

    // attach decoded user to request for downstream handlers
    ;(req as any).user = await verifyToken(token.slice(7))

    return next(req, res)
  }
}
```

### toHandler()

Convert a middleware class instance to a `MiddlewareHandler` function using `.toHandler()`.

```ts
import { router } from '@boostkit/router'
import { AuthMiddleware } from '../app/Middleware/AuthMiddleware.js'

router.get('/api/profile', handler, [new AuthMiddleware().toHandler()])
```

### fromClass(MiddlewareClass)

`fromClass` is a convenience function that instantiates a middleware class and calls `.toHandler()` in one step.

```ts
import { fromClass } from '@boostkit/middleware'
import { AuthMiddleware } from '../app/Middleware/AuthMiddleware.js'

const authHandler = fromClass(AuthMiddleware)
```

---

## Pipeline

`Pipeline` runs a sequence of `MiddlewareHandler` functions in order, passing the request and response through each one. Use it when you want to compose middleware outside of the router.

```ts
import { Pipeline } from '@boostkit/middleware'
import { LoggerMiddleware, CorsMiddleware } from '@boostkit/middleware'

const pipeline = new Pipeline([
  new LoggerMiddleware().toHandler(),
  new CorsMiddleware({ origin: '*' }).toHandler(),
])

const response = await pipeline.run(req, res, async (req, res) => {
  return res.json({ message: 'Hello' })
})
```

---

## Built-in Middleware

| Class | Description |
|---|---|
| `CorsMiddleware` | Adds `Access-Control-Allow-*` headers to every response. Accepts `origin`, `methods`, and `headers` options. Handles `OPTIONS` preflight requests automatically. |
| `LoggerMiddleware` | Logs each request and response to the console using ANSI colours. Outputs method, path, status code, and response time. Tagged with `[boostkit]`. |
| `ThrottleMiddleware` | In-memory rate limiter. Rejects requests that exceed the configured limit per window with a `429 Too Many Requests` response. Adds `X-RateLimit-*` headers. |

### CorsMiddleware Options

```ts
import { CorsMiddleware } from '@boostkit/middleware'

const cors = new CorsMiddleware({
  origin:  'https://example.com',
  methods: 'GET,POST,PUT,DELETE',
  headers: 'Content-Type,Authorization',
})
```

### ThrottleMiddleware Options

```ts
import { ThrottleMiddleware } from '@boostkit/middleware'

const throttle = new ThrottleMiddleware({
  limit:  100,       // max requests
  window: 60_000,    // window in ms (60 seconds)
})
```

---

## MiddlewareHandler Type

`MiddlewareHandler` is the canonical function signature for all middleware in BoostKit. It is exported from `@boostkit/contracts` and re-exported here for convenience.

```ts
type MiddlewareHandler = (
  req: AppRequest,
  res: AppResponse,
  next: (req: AppRequest, res: AppResponse) => Promise<unknown>,
) => unknown | Promise<unknown>
```

---

## Notes

- `ThrottleMiddleware` uses an in-memory store. It does not persist across process restarts and is not shared between multiple instances. For distributed rate limiting use `@boostkit/middleware` with the Redis cache adapter.
- `@boostkit/middleware` depends on `@boostkit/contracts` only. It does not depend on `@boostkit/core`, so it can be used in adapters and edge middleware without pulling in the full framework.
- `sideEffects: false` — fully tree-shakable.
