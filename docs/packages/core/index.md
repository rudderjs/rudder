# @forge/core

Application bootstrap, service provider lifecycle, and framework-level runtime orchestration.

```bash
pnpm add @forge/core
```

---

## Bootstrap

`bootstrap/app.ts` is the single wiring point for your application. It follows Laravel 11's fluent bootstrap style.

```ts
// bootstrap/app.ts
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import configs from '../config/index.js'
import providers from './providers.js'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.js'),
    commands: () => import('../routes/console.js'),
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
// src/index.ts  (WinterCG entry point)
import forge from '../bootstrap/app.js'

export default { fetch: forge.handleRequest }
```

---

## AppBuilder API

`Application.configure(options)` returns an `AppBuilder` instance. Chain these methods before calling `.create()`.

| Method | Signature | Description |
|---|---|---|
| `withRouting` | `(options: { api?, commands? }) => AppBuilder` | Registers lazy route loader functions. Each loader is a dynamic import returning a side-effect module. |
| `withMiddleware` | `(fn: (m: MiddlewareRegistry) => void) => AppBuilder` | Registers global middleware that runs on every request before route handlers. |
| `withExceptions` | `(fn: (e: ExceptionHandler) => void) => AppBuilder` | Registers a custom exception handler for unhandled errors. |
| `create` | `() => Forge` | Finalises configuration and returns a `Forge` instance. Does not boot providers yet. |

---

## Forge Instance API

`create()` returns a `Forge` instance, which is your application handle.

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(req: Request) => Promise<Response>` | Lazily bootstraps all service providers on the first call, then handles the incoming HTTP request. Used as the WinterCG `fetch` export. |
| `boot` | `() => Promise<void>` | Boots all service providers without starting an HTTP server. Used by the Artisan CLI and background workers. |

---

## app() and resolve() Helpers

Once the application has been booted, two global helpers are available anywhere in your codebase.

```ts
import { app, resolve } from '@forge/core'

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
import { ServiceProvider } from '@forge/core'
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
  DatabaseServiceProvider,   // must be first — sets ModelRegistry before other providers boot
  AppServiceProvider,
]
```

---

## Re-exports

`@forge/core` re-exports the following packages so you do not need to install them separately for common usage.

| Export | Source Package |
|---|---|
| `artisan`, `Command` | `@forge/artisan` |
| `Container`, `Injectable`, `Inject` | `@forge/di` |
| `Env`, `Collection`, `ConfigRepository`, `resolveOptionalPeer` | `@forge/support` |
| `ForgeRequest`, `ForgeResponse`, `HttpMethod`, `ServerAdapter`, `FetchHandler` | `@forge/contracts` |

---

## Subpath Exports

`@forge/core` ships tree-shakable subpaths for environments where bundle size matters.

| Import | Contents |
|---|---|
| `@forge/core` | Everything — Application, ServiceProvider, Forge, artisan, re-exports |
| `@forge/core/support` | Env, Collection, ConfigRepository, resolveOptionalPeer, helpers |
| `@forge/core/di` | Container, Injectable, Inject |
| `@forge/core/server` | ServerAdapter, ForgeRequest, ForgeResponse, HttpMethod, FetchHandler |
| `@forge/core/middleware` | Middleware, Pipeline, CorsMiddleware, LoggerMiddleware, ThrottleMiddleware |
| `@forge/core/validation` | FormRequest, ValidationError, validate, z |

---

## Notes

- `Application.configure().create()` is singleton-based — calling `create()` twice returns the same `Forge` instance.
- `Forge.boot()` runs `register()` then `boot()` on every provider in declaration order. Provider boot order matters — `DatabaseServiceProvider` must appear first so `ModelRegistry` is set before other providers call `boot()`.
- `Forge.handleRequest()` calls `boot()` automatically on the first HTTP request. Subsequent calls skip the boot phase.
- Route loaders passed to `withRouting()` are dynamic imports and are side-effect modules — they register routes by calling `router.get/post/...` and do not need to export anything.
