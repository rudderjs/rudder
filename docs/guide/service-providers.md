# Service Providers

Service providers are the central place to bootstrap and wire up your application's features. They are Forge's equivalent of Laravel's service providers.

## Overview

Every significant piece of Forge functionality — database connections, queue adapters, cache stores, mailers — is registered through a service provider. When you add a new integration, you typically add one provider class to `bootstrap/providers.ts`.

## Lifecycle

Each service provider has two lifecycle hooks:

| Method | Called when | Purpose |
|--------|-------------|---------|
| `register()` | Before boot | Bind services/singletons into the DI container |
| `boot()` | After all `register()` calls | Connect adapters, run setup that depends on other providers |

**Important**: Do not call `this.app.make()` in `register()` — other providers may not have registered yet. Use `boot()` for anything that depends on the container being fully populated.

## Creating a Provider

Extend `ServiceProvider` from `@boostkit/core`:

```ts
import { ServiceProvider } from '@boostkit/core'
import { MyService } from '../Services/MyService.js'
import { MyDependency } from '../Services/MyDependency.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Bind a factory — new instance on every make()
    this.app.bind(MyService, () => new MyService())

    // Bind a singleton — same instance on every make()
    this.app.singleton(MyDependency, () => new MyDependency())
  }

  async boot(): Promise<void> {
    // Safe to resolve other services here
    const dep = this.app.make(MyDependency)
    const svc = this.app.make(MyService)
    await svc.initialize(dep)
  }
}
```

## Registering Providers

List provider classes (not instances) in `bootstrap/providers.ts`:

```ts
import type { Application, ServiceProvider } from '@boostkit/core'
import { betterAuth }              from '@boostkit/auth-better-auth'
import { queue }                   from '@boostkit/queue'
import { cache }                   from '@boostkit/cache'
import { mail }                    from '@boostkit/mail'
import { notifications }           from '@boostkit/notification'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider }      from '../app/Providers/AppServiceProvider.js'
import configs                     from '../config/index.js'

export default [
  betterAuth(configs.auth),   // auth mounts /api/auth/* before routes/api.ts loads
  queue(configs.queue),
  mail(configs.mail),
  notifications(),            // must come after mail()
  cache(configs.cache),
  DatabaseServiceProvider,    // must appear before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

Some packages export **provider factories** (functions that return a provider class) rather than plain classes. The factory takes config and returns a class:

```ts
// betterAuth(config) returns a class extending ServiceProvider
const BetterAuthProvider = betterAuth(configs.auth)
// → class BetterAuthProvider extends ServiceProvider { ... }
```

You can use them directly in the array — both class references and instantiated-via-factory classes are valid.

## The `app()` Helper

Inside providers (and anywhere after boot), use `app()` to retrieve the application container:

```ts
import { app } from '@boostkit/core'

const service = app().make(UserService)
```

## Built-in Provider Factories

| Factory | Package | What it registers |
|---------|---------|------------------|
| `queue(config)` | `@boostkit/queue` | Queue adapter, `queue:work` command |
| `cache(config)` | `@boostkit/cache` | Cache adapter |
| `storage(config)` | `@boostkit/storage` | Storage adapter, `storage:link` command |
| `mail(config)` | `@boostkit/mail` | Mail adapter |
| `events(listenMap)` | `@boostkit/events` | Event dispatcher, listener registration |
| `scheduler()` | `@boostkit/schedule` | Schedule instance, `schedule:*` commands |
| `betterAuth(config)` | `@boostkit/auth-better-auth` | Auth instance, `/api/auth/*` routes |
| `notifications()` | `@boostkit/notification` | Mail + database channels |

## DatabaseServiceProvider Pattern

The database provider follows a consistent pattern:

```ts
import { ServiceProvider } from '@boostkit/core'
import { prisma } from '@boostkit/orm-prisma'
import { ModelRegistry } from '@boostkit/orm'

export class DatabaseServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const adapter = await prisma().create()
    await adapter.connect()

    // Required — all Model.* static methods route through this
    ModelRegistry.set(adapter)

    // Optional — inject the raw adapter for custom queries
    this.app.instance('db', adapter)
  }
}
```

## Tips

- Keep providers focused — one concern per provider
- Provider files live in `app/Providers/` by convention
- Generate a stub with `pnpm artisan make:provider Name`
- The `register()` hook is synchronous; `boot()` can be `async`
- Providers are classes — they can have constructor parameters injected if you instantiate them manually
