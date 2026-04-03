# Service Providers

Service providers are the central place to bootstrap and wire up your application's features. They are RudderJS's equivalent of Laravel's service providers.

## Overview

Every significant piece of RudderJS functionality — database connections, queue adapters, cache stores, mailers — is registered through a service provider. When you add a new integration, you typically add one provider class to `bootstrap/providers.ts`.

## Lifecycle

Each service provider has two lifecycle hooks:

| Method | Called when | Purpose |
|--------|-------------|---------|
| `register()` | Before boot | Bind services/singletons into the DI container |
| `boot()` | After all `register()` calls | Connect adapters, run setup that depends on other providers |

**Important**: Do not call `this.app.make()` in `register()` — other providers may not have registered yet. Use `boot()` for anything that depends on the container being fully populated.

## Creating a Provider

Extend `ServiceProvider` from `@rudderjs/core`:

```ts
import { ServiceProvider } from '@rudderjs/core'
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
import type { Application, ServiceProvider } from '@rudderjs/core'
import { prismaProvider }          from '@rudderjs/orm-prisma'
import { auth }                    from '@rudderjs/auth'
import { queue }                   from '@rudderjs/queue'
import { cache }                   from '@rudderjs/cache'
import { mail }                    from '@rudderjs/mail'
import { session }                 from '@rudderjs/session'
import { notifications }           from '@rudderjs/notification'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider }      from '../app/Providers/AppServiceProvider.js'
import configs                     from '../config/index.js'

export default [
  prismaProvider(configs.database), // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),               // auto-discovers 'prisma' from DI
  session(configs.session),
  queue(configs.queue),
  mail(configs.mail),
  notifications(),                  // must come after mail()
  cache(configs.cache),
  DatabaseServiceProvider,          // must appear before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

Some packages export **provider factories** (functions that return a provider class) rather than plain classes. The factory takes config and returns a class:

```ts
// auth(config) returns a class extending ServiceProvider
const AuthProvider = auth(configs.auth)
// → class BetterAuthProvider extends ServiceProvider { ... }
```

You can use them directly in the array — both class references and instantiated-via-factory classes are valid.

## The `app()` Helper

Inside providers (and anywhere after boot), use `app()` to retrieve the application container:

```ts
import { app } from '@rudderjs/core'

const service = app().make(UserService)
```

## Built-in Provider Factories

| Factory | Package | What it registers |
|---------|---------|------------------|
| `prismaProvider(config)` | `@rudderjs/orm-prisma` | PrismaClient bound to DI as `'prisma'` |
| `queue(config)` | `@rudderjs/queue` | Queue adapter, `queue:work` command |
| `cache(config)` | `@rudderjs/cache` | Cache adapter |
| `storage(config)` | `@rudderjs/storage` | Storage adapter, `storage:link` command |
| `mail(config)` | `@rudderjs/mail` | Mail adapter |
| `events(listenMap)` | `@rudderjs/core` | Event dispatcher, listener registration |
| `scheduler()` | `@rudderjs/schedule` | Schedule instance, `schedule:*` commands |
| `auth(config)` | `@rudderjs/auth` | Auth instance, `/api/auth/*` routes |
| `session(config)` | `@rudderjs/session` | Session driver (cookie/redis), `SessionMiddleware()` factory |
| `notifications()` | `@rudderjs/notification` | Mail + database channels |

## DatabaseServiceProvider Pattern

The database provider follows a consistent pattern:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { prisma } from '@rudderjs/orm-prisma'
import { ModelRegistry } from '@rudderjs/orm'

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

## Publishing Assets

Packages can declare files that users copy into their application with `pnpm rudder vendor:publish`. This is RudderJS's equivalent of Laravel's `vendor:publish`.

Call `this.publishes()` inside `boot()`:

```ts
import { ServiceProvider } from '@rudderjs/core'

export class MyPackageServiceProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    this.publishes({
      from: new URL('../pages', import.meta.url).pathname, // absolute source path
      to:   'pages/(panels)',                              // destination relative to app root
      tag:  'my-package-pages',                           // optional tag for selective publishing
    })
  }
}
```

Users then run:

```bash
pnpm rudder vendor:publish --list                               # see what's available
pnpm rudder vendor:publish --tag=my-package-pages               # publish by tag
pnpm rudder vendor:publish --provider=MyPackageServiceProvider  # publish by provider
pnpm rudder vendor:publish --force                              # overwrite existing files
```

Published files are owned by the user — they can edit them freely. Re-running `vendor:publish` without `--force` skips files that already exist.

## Tips

- Keep providers focused — one concern per provider
- Provider files live in `app/Providers/` by convention
- Generate a stub with `pnpm rudder make:provider Name`
- The `register()` hook is synchronous; `boot()` can be `async`
- Providers are classes — they can have constructor parameters injected if you instantiate them manually
- Use `this.publishes()` in `boot()`, not `register()` — `register()` may be overridden by factory functions
