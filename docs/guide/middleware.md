# Middleware

Forge middleware provides a powerful pipeline for intercepting HTTP requests and responses. Built on `@boostkit/middleware`, the system supports class-based middleware, a pipeline runner, and several built-in implementations.

## Writing Middleware

Extend the `Middleware` base class and implement the `handle()` method:

```ts
import { Middleware } from '@boostkit/middleware'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

export class AuthMiddleware extends Middleware {
  async handle(
    req: ForgeRequest,
    _res: ForgeResponse,
    next: () => Promise<void>
  ): Promise<void> {
    const token = req.headers['authorization']?.replace('Bearer ', '')
    if (!token) throw new Error('Unauthorized')

    // Attach user to request for downstream handlers
    ;(req as any).user = await verifyToken(token)

    await next()
  }
}
```

Key points:
- Call `await next()` to pass control to the next middleware/handler
- Throw an error to short-circuit the chain
- Set response values before calling `next()` (pre-processing) or after (post-processing)

## Converting to a Handler

The `Middleware` class has a `toHandler()` method that returns a `MiddlewareHandler` compatible with the router and pipeline:

```ts
const authHandler = new AuthMiddleware().toHandler()
```

Or use `fromClass()` for a one-liner:

```ts
import { fromClass } from '@boostkit/middleware'

const authHandler = fromClass(AuthMiddleware)
```

## Global Middleware

Register middleware that runs on every request in `bootstrap/app.ts`:

```ts
import { CorsMiddleware, LoggerMiddleware } from '@boostkit/middleware'
import { RateLimit } from '@boostkit/rate-limit'

Application.configure({ ... })
  .withMiddleware((m) => {
    m.use(new LoggerMiddleware().toHandler())
    m.use(new CorsMiddleware().toHandler())
    m.use(RateLimit.perMinute(100).byIp().toHandler())
  })
```

## Route-Level Middleware

Apply middleware to specific routes using the `@Middleware` decorator:

```ts
import { Controller, Get, Middleware } from '@boostkit/router'
import { AuthMiddleware } from '../Http/Middleware/AuthMiddleware.js'

@Controller('/api/admin')
class AdminController {
  @Get('/stats')
  @Middleware([AuthMiddleware])
  async stats() { ... }
}
```

## Built-in Middleware

### `CorsMiddleware`

Handles CORS preflight requests and adds CORS headers. Configure via `HonoConfig.cors` in `config/server.ts` for global CORS, or use this middleware directly for fine-grained control:

```ts
import { CorsMiddleware } from '@boostkit/middleware'

const cors = new CorsMiddleware({
  origin: 'https://example.com',
  methods: 'GET,POST',
  headers: 'Content-Type,Authorization',
})
```

### `LoggerMiddleware`

Logs incoming requests with method, path, status, and duration:

```
[forge] GET /api/users 200 12ms
```

```ts
import { LoggerMiddleware } from '@boostkit/middleware'

const logger = new LoggerMiddleware()
```

### `ThrottleMiddleware`

In-memory rate limiter (per IP). Automatically skips static assets and Vite-internal paths.

```ts
import { ThrottleMiddleware } from '@boostkit/middleware'

const throttle = new ThrottleMiddleware({ max: 60, windowMs: 60_000 })
```

For production rate limiting with Redis persistence, use `@boostkit/rate-limit` instead.

## The Pipeline

`Pipeline` lets you compose middleware programmatically:

```ts
import { Pipeline } from '@boostkit/middleware'

const pipeline = Pipeline.make().through([
  new LoggerMiddleware().toHandler(),
  new AuthMiddleware().toHandler(),
])

// Run a request through the pipeline
await pipeline.run(req, res, async () => {
  // final handler
})
```

## Middleware Order

Middleware is applied in the order it is registered. Execution follows an onion model:

```
Request
  → Logger (enter)
    → Auth (enter)
      → Handler
    → Auth (exit)
  → Logger (exit)
Response
```

Pre-processing logic goes **before** `await next()`, post-processing logic goes **after**.

## Error Handling in Middleware

If a middleware throws, the error propagates up the chain. Wrap the `next()` call to catch errors from downstream:

```ts
async handle(req, res, next) {
  try {
    await next()
  } catch (err) {
    if (err instanceof ValidationError) {
      // handle validation errors
    }
    throw err  // re-throw unknown errors
  }
}
```

## Generating Middleware

```bash
pnpm artisan make:middleware Auth
# → app/Http/Middleware/AuthMiddleware.ts
```
