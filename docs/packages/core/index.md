# @boostkit/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

```bash
pnpm add @boostkit/core
```

---

## Bootstrap

`bootstrap/app.ts` is the single wiring point for your application. It follows Laravel 11's fluent bootstrap style.

```ts
// bootstrap/app.ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import { RateLimit } from '@boostkit/middleware'
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
  .withExceptions((_e) => {
    // reserved: custom exception handling
  })
  .create()
```

```ts
// pages/+config.ts  (wires Vike to the BoostKit instance)
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
| `withExceptions` | `(fn: (e: ExceptionConfigurator) => void) => AppBuilder` | Reserved for custom exception handling (future). |
| `create` | `() => BoostKit` | Finalises configuration and returns a `BoostKit` instance. Does not boot providers yet. |

---

## BoostKit Instance API

`create()` returns a `BoostKit` instance, which is your application handle.

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(req: Request, env?, ctx?) => Promise<Response>` | Lazily bootstraps all service providers on the first call, then handles the incoming HTTP request. Used as the WinterCG `fetch` export. |
| `boot` | `() => Promise<void>` | Boots all service providers without starting an HTTP server. Used by the Artisan CLI and background workers. |
| `fetch` | `(req: Request, env?, ctx?) => Promise<Response>` | WinterCG-compatible property — alias for `handleRequest`. |

---

## app() and resolve() Helpers

Once the application has been created, two global helpers are available anywhere in your codebase.

```ts
import { app, resolve } from '@boostkit/core'

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
import { ServiceProvider } from '@boostkit/core'
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
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  DatabaseServiceProvider,   // must appear before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
]
```

---

## Re-exports

`@boostkit/core` re-exports the following so you do not need to install them separately for common usage.

| Export | Source Package |
|---|---|
| `artisan`, `Artisan`, `ArtisanRegistry`, `Command`, `CommandBuilder`, `CancelledError`, `parseSignature` | `@boostkit/artisan` |
| `Container`, `container`, `Injectable`, `Inject` | Built-in (core DI) |
| `Listener`, `EventDispatcher`, `dispatcher`, `dispatch`, `events` | Built-in (core Events) |
| `Env`, `env`, `Collection`, `ConfigRepository`, `config`, `resolveOptionalPeer`, `defineEnv`, `dump`, `dd`, `sleep`, `tap`, `pick`, `omit`, `ucfirst` | `@boostkit/support` |
| `AppRequest`, `AppResponse`, `RouteHandler`, `MiddlewareHandler`, `HttpMethod`, `RouteDefinition`, `ServerAdapter`, `FetchHandler`, `ServerAdapterProvider` | `@boostkit/contracts` |

---

## Notes

- `Application.configure().create()` creates an `Application` singleton — calling `Application.create()` a second time in production returns the same instance.
- In `local` / `development` environments, `Application.create()` recreates the instance on each call — useful for hot-reload scenarios.
- `BoostKit.boot()` runs `register()` then `boot()` on every provider in declaration order. Provider boot order matters — `DatabaseServiceProvider` must appear before any provider that uses ORM models.
- `BoostKit.handleRequest()` calls boot automatically on the first HTTP request. Subsequent calls skip the boot phase.
- Route loaders passed to `withRouting()` are dynamic imports returning side-effect modules — they register routes by calling `Route.get/post/...` and do not need to export anything.
- `Application.resetForTesting()` is available for test teardown — clears the singleton without reaching into private state.
