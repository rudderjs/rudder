# Contracts

`@rudderjs/contracts` is the type-only foundation that every other framework package depends on. It defines the shape of an HTTP request, the response builder, the middleware signature, and the server adapter interface. It contains no runtime code beyond a small input-accessor helper, has zero dependencies, and changes infrequently.

You usually don't import from `@rudderjs/contracts` directly — most types re-export through `@rudderjs/core` or whichever package defines the surface. But knowing it exists matters for two reasons:

1. **Library authors** who want to ship middleware, adapters, or routers that interoperate with the framework.
2. **Cross-package type safety** — the same `AppRequest` type flows through the router, middleware, controllers, and your handlers, so refactoring at one edge propagates everywhere.

## What's in it

| Export | Kind | Description |
|---|---|---|
| `AppRequest` | Interface | Normalized HTTP request with typed input accessors |
| `AppResponse` | Interface | Fluent response builder — `json()`, `status()`, `header()`, `redirect()` |
| `RouteHandler` | Type | `(req, res) => unknown \| Promise<unknown>` |
| `MiddlewareHandler` | Type | `(req, res, next) => unknown \| Promise<unknown>` |
| `RouteDefinition` | Interface | A registered route — method, path, handler, middleware |
| `ServerAdapter` | Interface | Implemented by server-adapter packages |
| `FetchHandler` | Type | WinterCG-compatible `(req: Request) => Promise<Response>` |
| `HttpMethod` | Union | `'GET' \| 'POST' \| ... \| 'ALL'` |
| `InputTypeError` | Class | Thrown by typed input accessors when coercion fails |
| `attachInputAccessors` | Function | Used by server adapters to attach typed input methods |

For the request and response APIs, see [Requests](/guide/requests) and [Responses](/guide/responses).

## When to consume contracts directly

Most app code reaches for the typed re-exports from the package you're already using:

```ts
// Most apps
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
```

That import is fine and safe — it doesn't pull any runtime code. Use it whenever you write a handler or middleware function outside of a route declaration:

```ts
import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/contracts'

export const requireAdmin: MiddlewareHandler = async (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Forbidden' })
  await next()
}
```

## Implementing a server adapter

The `ServerAdapter` interface is what ports the framework to a new HTTP runtime — Bun's native server, Cloudflare Workers, Deno Deploy. Implementing it requires translating between the runtime's native request/response and the framework's normalized `AppRequest` / `AppResponse`.

```ts
import type { ServerAdapter, AppRequest, AppResponse, RouteDefinition } from '@rudderjs/contracts'

export class MyAdapter implements ServerAdapter {
  registerRoute(route: RouteDefinition): void { /* ... */ }
  applyMiddleware(middleware: MiddlewareHandler): void { /* ... */ }
  listen(port: number, callback?: () => void): void { /* ... */ }
  getNativeServer(): unknown { /* ... */ }
}
```

The reference implementation is `@rudderjs/server-hono`. Read its source — it's the canonical way to plug a new runtime in. It is also the default: when `Application.configure()` receives no `server:` option, the framework auto-resolves `@rudderjs/server-hono` and constructs it with `config('server')`; a custom adapter is plugged in by passing `server:` explicitly.

## Why a separate types package

Splitting types out of `@rudderjs/core` keeps the package graph clean:

- **Zero runtime overhead.** `@rudderjs/contracts` is type-only; it adds nothing to your bundle.
- **No circular dependencies.** `core`, `router`, `middleware`, and `server-hono` all depend on `contracts` — but `contracts` depends on nothing.
- **Independent evolution.** Type definitions stabilize before runtime APIs. Cosmetic refactors of `@rudderjs/core` don't ripple into every adapter.

For library authors, this means you can write a routing or middleware library that targets the framework's contracts without taking a dependency on the kernel package. Your library stays small; consumers slot it into any `@rudderjs/core` version that's compatible with the contracts version.

## Versioning

`@rudderjs/contracts` follows semver strictly. Adding a field to `AppRequest` is a major bump; widening a method's return type is a minor bump. Treat any change to this package as load-bearing across the whole ecosystem.

## Pitfalls

- **Importing runtime code from `contracts`.** There isn't any (other than `attachInputAccessors`). If you find yourself reaching for behavior, you probably want `@rudderjs/core` or a domain package.
- **Casting `req.raw`.** It's the adapter's native request — useful for adapter-specific features (cookies via Hono context, file streams), but the cast bypasses type safety. Wrap it in a small helper module so the cast lives in one place.
- **Implementing `ServerAdapter` without reading server-hono.** The interface looks small but the integration with middleware groups, view rendering, and WebSocket upgrade has subtleties. Mirror the reference implementation.
