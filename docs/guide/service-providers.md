# Service Providers

Service providers are where your application is bootstrapped. Every significant piece of Rudder — database connections, queue adapters, cache stores, mailers — is registered through a provider. When you add an integration, you typically add one provider class to `bootstrap/providers.ts`.

## Lifecycle

Each provider has two hooks:

| Method | When it runs | Purpose |
|---|---|---|
| `register()` | Before any `boot()` | Bind services and singletons into the container |
| `boot()` | After all providers have registered | Connect adapters, run setup that depends on other providers |

Do not call `this.app.make()` in `register()` — other providers may not have registered yet. Use `boot()` for anything that depends on the container being fully populated.

## Creating a provider

Extend `ServiceProvider` from `@rudderjs/core`:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { MyService } from '../Services/MyService.js'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(MyService, () => new MyService())
  }

  async boot(): Promise<void> {
    const svc = this.app.make(MyService)
    await svc.initialize()
  }
}
```

`register()` is synchronous; `boot()` may be `async`. Generate a stub with `pnpm rudder make:provider Name`.

## Auto-discovery

Framework providers ship a `rudderjs` field in their `package.json` that tells Rudder how and when to boot them. The `pnpm rudder providers:discover` command scans `node_modules` for these fields and writes a sorted manifest to `bootstrap/cache/providers.json`. The `defaultProviders()` helper from `@rudderjs/core` reads that manifest at boot.

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  AppServiceProvider,
]
```

That is the entire file. Adding a new framework package and re-running `providers:discover` is enough — no imports to add, no array to maintain. The scaffolder runs `providers:discover` automatically when you scaffold with `--install`.

### The `rudderjs` field

```json
{
  "rudderjs": {
    "provider":     "QueueProvider",
    "stage":        "feature",
    "depends":      ["@rudderjs/log"],
    "optional":     false,
    "autoDiscover": true
  }
}
```

| Field | Purpose |
|---|---|
| `provider` | The PascalCase class name exported from the package's main entry |
| `stage` | One of `foundation`, `infrastructure`, `feature`, `monitoring` — coarse boot order |
| `depends` | Package names that must boot before this one — topo-sorted within the stage |
| `optional` | If `true`, missing peer is silently skipped. Use for drivers (e.g. one of two ORM packages) |
| `autoDiscover` | Set to `false` to opt out of discovery — users register manually |

### Stages

Stages give the framework a coarse boot order. Within a stage, `depends` determines fine ordering via topological sort.

| Stage | Examples |
|---|---|
| `foundation` | log |
| `infrastructure` | orm-prisma, session, hash, cache, auth |
| `feature` | queue, mail, storage, notification, broadcast, sync, ai |
| `monitoring` | telescope, pulse, horizon |

A `feature` provider is guaranteed to boot after every `infrastructure` provider, no matter what `depends` says. Cross-stage dependencies are tolerated but unnecessary — stage order already enforces them. Circular dependencies throw at sort time with a clear cycle message.

### Multi-driver resolution

When two packages share a common prefix (`@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle`), the loader picks one based on a config key:

```ts
// config/database.ts
export default { driver: 'prisma' }
```

`defaultProviders()` reads `config('database.driver')` and filters out the losers. If the key is unset, the first installed driver wins. If set but unmatched, boot throws.

### Dev-mode boot log

When the app boots in development and `defaultProviders()` was used, Rudder prints the loaded providers grouped by stage right before `[RudderJS] ready`:

```
[RudderJS] 19 providers booted
  ├─ foundation      log
  ├─ infrastructure  session, hash, auth, cache, orm-prisma
  ├─ feature         ai, broadcast, sync, mail, queue, storage
  └─ monitoring      telescope
```

If you forget to run `providers:discover` after installing a package, the missing entry is visible at every boot — instead of failing silently when first used. Production stays silent.

## Opt-out paths

### Skip a specific provider

```ts
export default [
  ...(await defaultProviders({ skip: ['@rudderjs/horizon'] })),
  AppServiceProvider,
]
```

The package stays installed but does not boot. Useful for registering a custom subclass instead.

### Opt a package out at the package level

If your package's `boot()` has side effects users should not trigger by default (e.g. starting a worker), set `autoDiscover: false` in your `package.json`. Users import the class and add it to their providers array explicitly.

### Turn off auto-discovery entirely

Don't call `defaultProviders()`. Import each provider class explicitly:

```ts
import { LogProvider } from '@rudderjs/log'
import { CacheProvider } from '@rudderjs/cache'
import { AuthProvider } from '@rudderjs/auth'

export default [LogProvider, CacheProvider, AuthProvider, AppServiceProvider]
```

You take ownership of the order yourself.

## Publishing assets

Packages can declare files that users copy into their application with `pnpm rudder vendor:publish` — config stubs, view templates, Prisma shards, anything the consumer needs to own and edit.

Call `this.publishes()` inside `boot()`:

```ts
export class MyPackageServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    this.publishes({
      from: new URL('../views', import.meta.url).pathname,
      to:   'app/Views/MyPackage',
      tag:  'my-package-views',
    })
  }
}
```

Users run:

```bash
pnpm rudder vendor:publish --list
pnpm rudder vendor:publish --tag=my-package-views
pnpm rudder vendor:publish --provider=MyPackageServiceProvider
pnpm rudder vendor:publish --force
```

Published files belong to the user — they can edit them freely. Re-running `vendor:publish` without `--force` skips files that already exist.

## Dynamic provider registration

Providers can register other providers at runtime via `this.app.register()`. This lets a module bring its own sub-providers without the user touching `bootstrap/providers.ts`:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { ReportingServiceProvider } from '../Modules/Reporting/ReportingServiceProvider.js'

export class AppServiceProvider extends ServiceProvider {
  async boot() {
    await this.app.register(ReportingServiceProvider)

    // Conditionally register based on config
    if (this.app.make<{ get(k: string): unknown }>('config').get('reporting.enabled')) {
      await this.app.register(SomeOptionalProvider)
    }
  }
}
```

| Scenario | Behaviour |
|---|---|
| Called **before** `bootstrap()` | `register()` runs immediately; `boot()` runs later during normal bootstrap |
| Called **after** `bootstrap()` | Both `register()` and `boot()` run immediately |
| Duplicate provider class | Silently skipped (by class reference or class name) |
| Boot error | Wrapped with provider name context, same as initial providers |

Same shape as Laravel's `$this->app->register(Provider::class)`.

## Common errors

**`@rudderjs/X listed in the provider manifest but not installed`** — the manifest still references a removed package. Run `pnpm rudder providers:discover` to refresh.

**`Multiple @rudderjs/orm-* drivers installed but config('database.driver') is "..."`** — set `config('database.driver')` to one of the installed packages.

**`<package> declared provider "X" in package.json but no such class is exported`** — the `rudderjs.provider` field doesn't match any export. Check the class name in `src/index.ts`.

## Tips

- Provider files live in `app/Providers/` by convention.
- Keep providers focused — one concern per provider.
- Custom providers in `app/Providers/` (your `AppServiceProvider`) don't need a `rudderjs` field — they're not in `node_modules` and you list them explicitly.
- For tests, the loader gracefully degrades to a minimal built-in registry if no manifest exists.
