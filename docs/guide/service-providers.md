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

Extend `ServiceProvider` from `@forge/core`:

```ts
import { ServiceProvider } from '@forge/core'
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
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider }      from '../app/Providers/AppServiceProvider.js'
import { betterAuth }              from '@forge/auth-better-auth'
import { queue }                   from '@forge/queue'
import { cache }                   from '@forge/cache'
import { mail }                    from '@forge/mail'
import * as configs                from '../config/index.js'

export default [
  DatabaseServiceProvider,        // 1. Must be first — sets up ModelRegistry
  betterAuth(configs.auth),       // 2. Auth needs DB
  queue(configs.queue),           // 3. Queue setup
  cache(configs.cache),           // 4. Cache setup
  mail(configs.mail),             // 5. Mail setup (before notifications)
  AppServiceProvider,             // 6. App-specific bindings
]
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
import { app } from '@forge/core'

const service = app().make(UserService)
```

## Built-in Provider Factories

| Factory | Package | What it registers |
|---------|---------|------------------|
| `queue(config)` | `@forge/queue` | Queue adapter, `queue:work` command |
| `cache(config)` | `@forge/cache` | Cache adapter |
| `storage(config)` | `@forge/storage` | Storage adapter, `storage:link` command |
| `mail(config)` | `@forge/mail` | Mail adapter |
| `events(listenMap)` | `@forge/events` | Event dispatcher, listener registration |
| `scheduler()` | `@forge/schedule` | Schedule instance, `schedule:*` commands |
| `betterAuth(config)` | `@forge/auth-better-auth` | Auth instance, `/api/auth/*` routes |
| `notifications()` | `@forge/notification` | Mail + database channels |

## DatabaseServiceProvider Pattern

The database provider follows a consistent pattern:

```ts
import { ServiceProvider } from '@forge/core'
import { prisma } from '@forge/orm-prisma'
import { ModelRegistry } from '@forge/orm'

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
