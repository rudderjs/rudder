# @rudderjs/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

```bash
pnpm add @rudderjs/core
```

---

## Bootstrap

`bootstrap/app.ts` is the single wiring point for your application. It follows Laravel 11's fluent bootstrap style.

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
    // Global middleware — runs on every request (web + API)
    m.use(RateLimit.perMinute(60))
  })
  .withExceptions((e) => {
    // Register custom error renderers
    e.render(PaymentError, (err) =>
      Response.json({ code: err.code }, { status: 402 })
    )

    // Ignore an error — lets it surface to the server's default fallback
    e.ignore(NotFoundError)
  })
  .create()
```

```ts
// pages/+config.ts  (wires Vike to the RudderJS instance)
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'

export default {
  extends: [vikePhoton],
  photon: { server: 'bootstrap/app.ts' },
} as unknown as Config
```

`bootstrap/app.ts` is the entry point — `import 'reflect-metadata'` belongs at the top of that file.

---

## AppBuilder API

`Application.configure(options)` returns an `AppBuilder` instance. Chain these methods before calling `.create()`.

| Method | Signature | Description |
|---|---|---|
| `withRouting` | `(options: { web?, api?, commands? }) => AppBuilder` | Registers lazy route loader functions. Each loader is a dynamic import returning a side-effect module. |
| `withMiddleware` | `(fn: (m: MiddlewareConfigurator) => void) => AppBuilder` | Registers global middleware that runs on every request before route handlers. |
| `withExceptions` | `(fn: (e: ExceptionConfigurator) => void) => AppBuilder` | Registers custom error renderers and ignore rules. `ValidationError` is handled automatically as 422 JSON — no catch block needed in routes. |
| `create` | `() => RudderJS` | Finalises configuration and returns a `RudderJS` instance. Does not boot providers yet. |

---

## RudderJS Instance API

`create()` returns a `RudderJS` instance, which is your application handle.

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(req: Request, env?, ctx?) => Promise<Response>` | Lazily bootstraps all service providers on the first call, then handles the incoming HTTP request. Used as the WinterCG `fetch` export. |
| `boot` | `() => Promise<void>` | Boots all service providers without starting an HTTP server. Used by the Rudder CLI and background workers. |
| `fetch` | `(req: Request, env?, ctx?) => Promise<Response>` | WinterCG-compatible property — alias for `handleRequest`. |

---

## app() and resolve() Helpers

Once the application has been created, two global helpers are available anywhere in your codebase.

```ts
import { app, resolve } from '@rudderjs/core'

// Get the Application instance
const application = app()

// Resolve a binding from the container
const userService = resolve<UserService>('userService')

// Equivalent via make()
const userService = app().make<UserService>('userService')
```

`app()` returns the global `Application` instance (not the container directly). `resolve<T>(token)` is shorthand for `app().make<T>(token)`. Both throw if the application has not been created yet.

---

## Service Providers

Service providers are the primary way to bind services into the container and register framework hooks.

```ts
// app/Providers/AppServiceProvider.ts
import { ServiceProvider } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'

export class AppServiceProvider extends ServiceProvider {
  register() {
    this.app.singleton(UserService, () => new UserService())
  }

  async boot() {
    // runs after all providers have registered
  }
}
```

```ts
// bootstrap/providers.ts
import { database } from '@rudderjs/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  database(configs.database),  // must appear before any provider that queries models
  AppServiceProvider,
]
```

---

## Dynamic Provider Registration

Providers can dynamically register other providers at runtime using `this.app.register()`. This enables modules to be self-contained, features to be conditionally loaded, and packages to compose sub-providers.

```ts
import { ServiceProvider } from '@rudderjs/core'
import { panels } from '@rudderjs/panels'
import { cache } from '@rudderjs/cache'
import { adminPanel } from '../Panels/Admin/AdminPanel.js'

export class AppServiceProvider extends ServiceProvider {
  register() {}

  async boot() {
    // A module can register its own panels
    await this.app.register(panels([adminPanel]))

    // Conditional features based on config
    const config = this.app.make<{ get(k: string): unknown }>('config')
    if (config.get('cache.enabled')) {
      await this.app.register(cache(cacheConfig))
    }
  }
}
```

### How it works

| Scenario | Behaviour |
|---|---|
| Called **before** `bootstrap()` | `register()` runs immediately; `boot()` runs later during normal bootstrap |
| Called **after** `bootstrap()` | Both `register()` and `boot()` run immediately |
| Duplicate provider class | Silently skipped (by class reference or class name) |
| Boot error | Wrapped with provider name context, same as initial providers |

This is the same pattern as Laravel's `$this->app->register(Provider::class)` — a provider can bring its own sub-providers without the user touching `providers.ts`.

---

## Re-exports

`@rudderjs/core` re-exports the following so you do not need to install them separately for common usage.

| Export | Source Package |
|---|---|
| `rudder`, `Rudder`, `CommandRegistry`, `Command`, `CommandBuilder`, `CancelledError`, `parseSignature` | `@rudderjs/rudder` |
| `Container`, `container`, `Injectable`, `Inject` | Built-in (core DI) |
| `Listener`, `EventDispatcher`, `dispatcher`, `dispatch`, `events` | Built-in (core Events) |
| `FormRequest`, `ValidationError`, `validate`, `validateWith`, `z` | Built-in (core Validation) |
| `Env`, `env`, `Collection`, `ConfigRepository`, `config`, `resolveOptionalPeer`, `defineEnv`, `dump`, `dd`, `sleep`, `tap`, `pick`, `omit`, `ucfirst` | `@rudderjs/support` |
| `AppRequest`, `AppResponse`, `RouteHandler`, `MiddlewareHandler`, `HttpMethod`, `RouteDefinition`, `ServerAdapter`, `FetchHandler`, `ServerAdapterProvider` | `@rudderjs/contracts` |

---

## ExceptionConfigurator

`withExceptions(fn)` receives an `ExceptionConfigurator` instance. Use it to register custom error renderers and ignore rules.

### `.render(ErrorClass, fn)`

Register a renderer for a specific error type. Return a `Response` — the route's normal error handling is bypassed.

```ts
.withExceptions((e) => {
  e.render(PaymentError, (err, req) =>
    Response.json({ code: err.code, message: err.message }, { status: 402 })
  )

  e.render(NotFoundException, (_err, req) =>
    Response.json({ message: 'Not found.' }, { status: 404 })
  )
})
```

`fn` receives `(err: T, req: AppRequest)` and must return a `Response` or `Promise<Response>`.

### `.ignore(ErrorClass)`

Re-throw an error class so it surfaces to the server's native fallback handler. In development this shows the HTML error page; in production it becomes a `500`.

```ts
e.ignore(DebugOnlyError)
```

### Built-in: `ValidationError → 422`

`ValidationError` is automatically rendered as `422 Unprocessable Entity` — no custom renderer needed:

```json
{
  "message": "Validation failed.",
  "errors": { "email": ["Invalid email address"], "name": ["Required"] }
}
```

This means you can throw `ValidationError` from any route handler without wrapping it in a `try/catch`. User-registered renderers take precedence for `ValidationError` subclasses.

---

## Notes

- `Application.configure().create()` creates an `Application` singleton — calling `Application.create()` a second time in production returns the same instance.
- In `local` / `development` environments, `Application.create()` recreates the instance on each call — useful for hot-reload scenarios.
- `RudderJS.boot()` runs `register()` then `boot()` on every provider in declaration order. Provider boot order matters — `DatabaseServiceProvider` must appear before any provider that uses ORM models.
- `RudderJS.handleRequest()` calls boot automatically on the first HTTP request. Subsequent calls skip the boot phase.
- Route loaders passed to `withRouting()` are dynamic imports returning side-effect modules — they register routes by calling `Route.get/post/...` and do not need to export anything.
- `Application.resetForTesting()` is available for test teardown — clears the singleton without reaching into private state.
