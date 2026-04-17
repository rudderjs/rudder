# @rudderjs/core

## Overview

`@rudderjs/core` is the foundation of a RudderJS application. It provides the Application class, a Laravel-style DI container, service provider lifecycle, event dispatching, form request validation (via Zod), exception handling, and typed configuration. It re-exports essentials from `@rudderjs/support`, `@rudderjs/contracts`, and `@rudderjs/rudder` so most apps only need to import from `@rudderjs/core`.

## Key Patterns

### Application Bootstrap

Every RudderJS app is wired in `bootstrap/app.ts` using the builder pattern:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server: hono(configs.server), config: configs, providers,
})
  .withRouting({
    web: () => import('../routes/web.ts'),
    api: () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => m.use(RateLimit.perMinute(60).toHandler()))
  .withExceptions((e) => e.reportUsing((err) => Sentry.captureException(err)))
  .create()
```

There is no `rudderjs.config.ts` -- `bootstrap/app.ts` is the framework wiring file.

### Service Providers

Providers follow a two-phase lifecycle: `register()` binds into the container, `boot()` runs after all providers are registered.

```ts
import { ServiceProvider, app } from '@rudderjs/core'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('userService', () => new UserService())
  }

  async boot(): Promise<void> {
    // All bindings are available here
  }
}
```

Many packages export a **factory function** that returns a provider class (e.g., `cache(config)`, `queue(config)`). These are used in `bootstrap/providers.ts`:

```ts
import { cache } from '@rudderjs/cache'
export default [cache(cacheConfig), AppServiceProvider]
```

Providers can be registered dynamically at runtime via `app().register(ProviderClass)`. Duplicates are silently skipped (guarded by class reference and class name).

Deferred providers define `provides()` returning token strings -- they are lazily booted on first container resolve of those tokens.

### Dependency Injection

The DI container supports several binding types:

```ts
// Transient -- new instance each time
app().bind('mailer', (c) => new Mailer(c.make('config')))

// Singleton -- created once, cached forever
app().singleton('db', (c) => new Database(c.make('config')))

// Scoped -- one instance per request (requires ScopeMiddleware)
app().scoped('cart', () => new ShoppingCart())

// Instance -- store an already-created value
app().instance('config', configRepo)
```

Resolve with `app().make<T>(token)` or the global `resolve<T>(token)` helper.

Auto-resolution works for classes decorated with `@Injectable()`. Use `@Inject('token')` to override specific constructor parameters:

```ts
@Injectable()
class PhotoController {
  constructor(
    private storage: StorageService,        // auto-resolved by type
    @Inject('s3') private backup: Storage,  // resolved by token
  ) {}
}
```

Contextual bindings let you override a dependency for a specific consumer:

```ts
container.when(PhotoController).needs('storage').give(() => new S3Storage())
```

### Middleware

Middleware is configured in `bootstrap/app.ts` via `withMiddleware()`. Each handler receives a `MiddlewareHandler` signature from `@rudderjs/contracts`:

```ts
.withMiddleware((m) => {
  m.use(RateLimit.perMinute(60).toHandler())
  m.use(cors({ origins: ['https://example.com'] }))
})
```

### Exception Handling

Use `abort(status, message?)`, `abort_if(condition, status)`, and `abort_unless(condition, status)` to throw `HttpException`. Configure custom renderers via `withExceptions()` in `bootstrap/app.ts`. Use `report(err)` to log without throwing.

### Events

Extend `Listener` and call `dispatch(new MyEvent(data))`. Register listeners in a provider's `boot()`.

### Validation

Extend `FormRequest` and define a `rules()` method returning a Zod schema (`z.object({...})`). `z` is re-exported from `@rudderjs/core`.

## Common Pitfalls

- **Missing `reflect-metadata`**: Must be imported at the very top of `bootstrap/app.ts` before any other imports. Install as a `dependency`, not `devDependency`.
- **Provider boot order matters**: `DatabaseServiceProvider` must come before any provider that uses ORM models. Order your `providers` array accordingly.
- **Scoped bindings outside request scope**: Calling `app().make('scopedToken')` outside of `container.runScoped()` throws. Ensure `ScopeMiddleware` is registered or wrap the call manually.
- **Dynamic provider duplicates**: `app().register()` is safe to call multiple times with the same class -- duplicates are skipped. But factory functions create anonymous classes, so use consistent references.
- **Circular dependency with `@rudderjs/router`**: Core loads router at runtime via dynamic `import()`. Never add `@rudderjs/core` to router's `dependencies` -- use `peerDependencies` only.

## Key Imports

```ts
import { Application, app, resolve, ServiceProvider, Injectable, Inject } from '@rudderjs/core'
import { FormRequest, ValidationError, z } from '@rudderjs/core'
import { Listener, dispatch, events } from '@rudderjs/core'
import { HttpException, abort, abort_if, report } from '@rudderjs/core'
import { Collection, Env, env, config, sleep } from '@rudderjs/core'
import { rudder, Command } from '@rudderjs/core'
import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/core'
```
