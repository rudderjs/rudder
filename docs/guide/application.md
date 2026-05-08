# Application

`bootstrap/app.ts` is the single wiring point for a RudderJS app. It builds an `Application` instance using a fluent configurator, registers route loaders, middleware, and exception handlers, and returns a `RudderJS` runtime ready to handle HTTP requests.

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    m.use(RateLimit.perMinute(60))
  })
  .withExceptions((e) => {
    e.render(PaymentError, (err) =>
      Response.json({ code: err.code }, { status: 402 }),
    )
  })
  .create()
```

`+server.ts` at the project root wires the result to Vike:

```ts
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default { fetch: app.fetch } satisfies Server
```

`import 'reflect-metadata'` belongs at the very top of `bootstrap/app.ts` — it must run before any decorator-using class is loaded.

## AppBuilder API

`Application.configure(options)` returns an `AppBuilder`. Chain these methods, then call `.create()`.

| Method | Signature | Description |
|---|---|---|
| `withRouting` | `(options: { web?, api?, commands? }) => AppBuilder` | Registers lazy route loader functions. Each loader is a dynamic import returning a side-effect module. |
| `withMiddleware` | `(fn: (m: MiddlewareConfigurator) => void) => AppBuilder` | Registers global middleware. See [Middleware](/guide/middleware) for the configurator API. |
| `withExceptions` | `(fn: (e: ExceptionConfigurator) => void) => AppBuilder` | Registers custom error renderers, ignored types, and the report destination. See [Error Handling](/guide/error-handling). |
| `create` | `() => RudderJS` | Finalises configuration and returns the application instance. Does not boot providers yet. |

## RudderJS instance API

`create()` returns a `RudderJS` instance — your application handle.

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(req: Request, env?, ctx?) => Promise<Response>` | Lazily bootstraps all service providers on the first call, then handles the incoming HTTP request. |
| `boot` | `() => Promise<void>` | Boots all service providers without starting an HTTP server. Used by the Rudder CLI and background workers. |
| `fetch` | `(req: Request, env?, ctx?) => Promise<Response>` | WinterCG-compatible alias for `handleRequest`. Works with Vike, Cloudflare Workers, and any platform that consumes a `fetch` handler. |

## `app()` and `resolve()`

After bootstrap, two global helpers are available anywhere in the codebase:

```ts
import { app, resolve } from '@rudderjs/core'

const application = app()                                 // Application singleton
const userService = resolve<UserService>('userService')   // shorthand for app().make()
```

Both throw if the application has not been created yet.

## Re-exports from `@rudderjs/core`

Common framework primitives are re-exported from `@rudderjs/core` so most apps need only the one import:

| Re-export | Source |
|---|---|
| `rudder`, `Rudder`, `Command`, `parseSignature` | `@rudderjs/console` |
| `Container`, `container`, `Injectable`, `Inject` | core DI |
| `Listener`, `EventDispatcher`, `dispatch`, `dispatcher`, `EventFake` | core Events |
| `FormRequest`, `ValidationError`, `validate`, `z` | core Validation |
| `Env`, `env`, `Collection`, `config`, `resolveOptionalPeer`, `dump`, `dd`, `sleep`, `tap` | `@rudderjs/support` |
| `AppRequest`, `AppResponse`, `RouteHandler`, `MiddlewareHandler` | `@rudderjs/contracts` |
| `HttpException`, `abort`, `abort_if`, `abort_unless`, `report`, `setExceptionReporter` | core Exceptions |

## Notes

- `Application.configure().create()` returns a singleton in production. In `local` / `development` it recreates on each call to support hot reload.
- `RudderJS.boot()` runs `register()` then `boot()` on every provider in declaration order. Provider order matters — for example, `DatabaseServiceProvider` must come before any provider that queries models.
- `RudderJS.handleRequest()` calls `boot()` automatically on the first HTTP request. Subsequent calls skip the boot phase.
- Route loaders passed to `withRouting()` are dynamic imports returning side-effect modules — they register routes by calling `Route.get/post/...` and don't need to export anything.
- `Application.resetForTesting()` is available for test teardown.
