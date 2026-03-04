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
    // m.use(new CorsMiddleware().toHandler())
  })
  .withExceptions((_e) => {
    // custom error handling
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

`bootstrap/app.ts` is the entry point — `import 'reflect-metadata'` belongs at the top of that file, not in a separate `src/index.ts`.

---

## AppBuilder API

`Application.configure(options)` returns an `AppBuilder` instance. Chain these methods before calling `.create()`.

| Method | Signature | Description |
|---|---|---|
| `withRouting` | `(options: { api?, commands? }) => AppBuilder` | Registers lazy route loader functions. Each loader is a dynamic import returning a side-effect module. |
| `withMiddleware` | `(fn: (m: MiddlewareRegistry) => void) => AppBuilder` | Registers global middleware that runs on every request before route handlers. |
| `withExceptions` | `(fn: (e: ExceptionHandler) => void) => AppBuilder` | Registers a custom exception handler for unhandled errors. |
| `create` | `() => BoostKit` | Finalises configuration and returns a `BoostKit` instance. Does not boot providers yet. |

---

## BoostKit Instance API

`create()` returns a `BoostKit` instance, which is your application handle.

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(req: Request) => Promise<Response>` | Lazily bootstraps all service providers on the first call, then handles the incoming HTTP request. Used as the WinterCG `fetch` export. |
| `boot` | `() => Promise<void>` | Boots all service providers without starting an HTTP server. Used by the Artisan CLI and background workers. |

---

## app() and resolve() Helpers

Once the application has been booted, two global helpers are available anywhere in your codebase.

```ts
import { app, resolve } from '@boostkit/core'

// Retrieve the DI container
const container = app()

// Resolve a binding by token
const userService = resolve<UserService>('userService')

// Equivalent: make() directly
const userService = app().make<UserService>('userService')
```

`app()` returns the global `Container` instance. `resolve<T>(token)` is shorthand for `app().make<T>(token)`.

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

`@boostkit/core` re-exports the following packages so you do not need to install them separately for common usage.

| Export | Source Package |
|---|---|
| `artisan`, `Command` | `@boostkit/artisan` |
| `Container`, `Injectable`, `Inject` | `@boostkit/di` |
| `Env`, `Collection`, `ConfigRepository`, `resolveOptionalPeer` | `@boostkit/support` |
| `AppRequest`, `AppResponse`, `HttpMethod`, `ServerAdapter`, `FetchHandler` | `@boostkit/contracts` |

---

## Subpath Exports

`@boostkit/core` ships tree-shakable subpaths for environments where bundle size matters.

| Import | Contents |
|---|---|
| `@boostkit/core` | Everything — Application, ServiceProvider, BoostKit, artisan, re-exports |
| `@boostkit/core/support` | Env, Collection, ConfigRepository, resolveOptionalPeer, helpers |
| `@boostkit/core/di` | Container, Injectable, Inject |
| `@boostkit/core/server` | ServerAdapter, AppRequest, AppResponse, HttpMethod, FetchHandler |
| `@boostkit/core/middleware` | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware |
| `@boostkit/core/validation` | FormRequest, ValidationError, validate, z |

---

## Notes

- `Application.configure().create()` is singleton-based — calling `create()` twice returns the same `BoostKit` instance.
- `BoostKit.boot()` runs `register()` then `boot()` on every provider in declaration order. Provider boot order matters — `DatabaseServiceProvider` must appear before `AppServiceProvider` so `ModelRegistry` is set before any provider that uses ORM models calls `boot()`.
- `BoostKit.handleRequest()` calls `boot()` automatically on the first HTTP request. Subsequent calls skip the boot phase.
- Route loaders passed to `withRouting()` are dynamic imports and are side-effect modules — they register routes by calling `router.get/post/...` and do not need to export anything.
