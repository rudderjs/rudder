# @boostkit/contracts

Framework-level TypeScript contracts for HTTP, routing, middleware, and server adapters.

## Installation

```bash
pnpm add @boostkit/contracts
```

## Usage

```ts
import type {
  ForgeRequest,
  ForgeResponse,
  MiddlewareHandler,
  ServerAdapter,
  RouteDefinition,
} from '@boostkit/contracts'

const auth: MiddlewareHandler = async (req: ForgeRequest, _res: ForgeResponse, next) => {
  if (!req.headers.authorization) throw new Error('Unauthorized')
  await next()
}
```

## API Reference

- `ForgeRequest`, `ForgeResponse`
- `RouteHandler`, `MiddlewareHandler`
- `HttpMethod`, `RouteDefinition`
- `ServerAdapter`, `ServerAdapterFactory`, `ServerAdapterProvider`
- `FetchHandler`

## Configuration

This package has no runtime config object.

## Notes

- This package is type-first and intended to be imported as `type` where possible.
