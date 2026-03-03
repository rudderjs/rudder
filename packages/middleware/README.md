# @boostkit/middleware

HTTP middleware base class, pipeline runner, and built-in middleware implementations.

## Installation

```bash
pnpm add @boostkit/middleware
```

## Usage

```ts
import { Middleware, Pipeline, CorsMiddleware } from '@boostkit/middleware'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

class AuthMiddleware extends Middleware {
  async handle(req: ForgeRequest, _res: ForgeResponse, next: () => Promise<void>) {
    if (!req.headers.authorization) throw new Error('Unauthorized')
    await next()
  }
}

const pipeline = Pipeline.make().through([
  new CorsMiddleware().toHandler(),
  new AuthMiddleware().toHandler(),
])
```

## API Reference

- `Middleware`
- `Pipeline`
- `CorsMiddleware`
- `LoggerMiddleware`
- `ThrottleMiddleware`
- `fromClass(MiddlewareClass)`

## Configuration

This package has no top-level config object.

## Notes

- `ThrottleMiddleware` is in-memory and skips static asset/Vite-internal paths.
- Middleware handlers use `ForgeRequest` / `ForgeResponse` from `@boostkit/contracts`.
