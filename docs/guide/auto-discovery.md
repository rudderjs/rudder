# Provider Auto-Discovery

RudderJS auto-discovers framework providers from each package's `package.json` so `bootstrap/providers.ts` stays short and survives package additions or removals without manual edits.

## Overview

Every framework package that ships a `*Provider` class declares a `rudderjs` field in its `package.json`. The `pnpm rudder providers:discover` command scans `node_modules` for these fields and writes a sorted manifest to `bootstrap/cache/providers.json`. The `defaultProviders()` helper from `@rudderjs/core` reads that manifest at boot time and returns the right classes in the right order.

```ts
// bootstrap/providers.ts
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ /* event → listeners map */ }),
  AppServiceProvider,
]
```

That's the entire file. Adding a new framework package and running `providers:discover` is enough — no imports to add, no array to maintain.

## The `rudderjs` field

```json
{
  "name": "@example/queue-rabbitmq",
  "rudderjs": {
    "provider":     "RabbitMQQueueProvider",
    "stage":        "feature",
    "depends":      ["@rudderjs/log"],
    "optional":     false,
    "autoDiscover": true
  }
}
```

| Field | Required | Type | Purpose |
|---|---|---|---|
| `provider` | Yes | string | The PascalCase class name exported from the package's main entry. |
| `stage` | Yes | enum | One of `foundation`, `infrastructure`, `feature`, `monitoring`. Determines coarse boot order. |
| `depends` | No | string[] | Package names that must boot before this one. Topo-sorted within the stage. |
| `optional` | No | boolean | If `true`, missing peer is silently skipped. Use for drivers (e.g. one of two ORM packages). Default: `false`. |
| `autoDiscover` | No | boolean | Set to `false` to opt the package out of auto-discovery — users register it manually. Default: `true`. |

## Stages

Stages give the framework a coarse boot order. Within a stage, `depends` determines fine ordering via topological sort.

| Stage | Purpose | Examples |
|---|---|---|
| `foundation` | Logging, telemetry, anything everything else may need. | `log` |
| `infrastructure` | DB, sessions, hashing, caching, auth — services other features build on. | `orm-prisma`, `session`, `hash`, `cache`, `auth` |
| `feature` | User-facing services. | `queue`, `mail`, `storage`, `notification`, `broadcast`, `live`, `ai` |
| `monitoring` | Observability tools that watch the rest of the app. | `telescope`, `pulse`, `horizon` |

## Boot order

The sort is two-pass:

1. **Stage order**: `foundation → infrastructure → feature → monitoring`. A `feature` provider is guaranteed to boot after all `infrastructure` providers, no matter what `depends` says.
2. **Topological sort within each stage**: if `auth` declares `depends: ['@rudderjs/session', '@rudderjs/hash']`, the manifest places `auth` after both. Cross-stage dependencies are tolerated but unnecessary — stage order already enforces them.

Circular dependencies throw at sort time with a clear cycle message:

```
[RudderJS] Circular provider dependency: @example/a → @example/b → @example/c → @example/a
```

## Multi-driver resolution

When two packages share a common prefix and both are installed (e.g. `@rudderjs/orm-prisma` and a future `@rudderjs/orm-drizzle`), the loader picks one based on a config key:

```ts
// config/database.ts
export default {
  driver: 'prisma',  // or 'drizzle'
  // ...
}
```

`defaultProviders()` reads `config('database.driver')` and filters out the losers. If the config key is unset, the first installed driver wins. If the key is set but doesn't match any installed driver, boot throws with a clear message.

This pattern is reusable for queue adapters (`bullmq` vs `inngest`) or broadcast drivers when those competing implementations exist.

## The discover command

Run `pnpm rudder providers:discover` after installing or removing any framework package. The scaffolder runs it automatically when you create a new app with `--install`. The output groups by stage with `depends` shown inline and optional packages tagged:

```
✓ Discovered 19 providers

  foundation
  └─ log              LogProvider

  infrastructure
  ├─ session          SessionProvider
  ├─ hash             HashProvider
  ├─ auth             AuthProvider          ← session, hash
  ├─ cache            CacheProvider         ← log
  └─ orm-prisma       DatabaseProvider      (optional)

  feature
  ├─ ai               AiProvider
  ...

  monitoring
  ├─ horizon          HorizonProvider
  ├─ pulse            PulseProvider
  └─ telescope        TelescopeProvider
```

The manifest is gitignored — each developer regenerates it on `pnpm install`.

## The dev-mode boot log

When the app boots in development and `defaultProviders()` was used, RudderJS prints the loaded providers grouped by stage right before `[RudderJS] ready`:

```
[RudderJS] 19 providers booted
  ├─ foundation      log
  ├─ infrastructure  session, hash, auth, cache, orm-prisma
  ├─ feature         ai, boost, broadcast, live, localization, mail
  │                  notification, queue, schedule, storage
  └─ monitoring      horizon, pulse, telescope
[RudderJS] ready
```

If you forget to run `providers:discover` after installing a package, the missing entry is visible at every boot instead of failing silently when first used. Production stays silent.

## Opt-out paths

### Skip a specific framework provider

Pass `skip` to `defaultProviders()`:

```ts
export default [
  ...(await defaultProviders({ skip: ['@rudderjs/horizon'] })),
  AppServiceProvider,
]
```

The package stays installed but doesn't boot. Useful when you want to register a custom subclass instead, or when you don't need a particular monitoring tool.

### Register a skipped provider manually

Spread `defaultProviders()` and add the explicit class somewhere else in the array:

```ts
import { defaultProviders } from '@rudderjs/core'
import { CustomQueueProvider } from './app/Providers/CustomQueueProvider.js'
import { AppServiceProvider } from './app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders({ skip: ['@rudderjs/queue'] })),
  CustomQueueProvider,    // your subclass with custom config or wiring
  AppServiceProvider,
]
```

### Opt a package out at the package level

If you author a package whose `boot()` has side effects users shouldn't trigger by default (e.g. starting a worker process), set `autoDiscover: false` in your `package.json`:

```json
{
  "rudderjs": {
    "provider":     "BackgroundWorkerProvider",
    "stage":        "feature",
    "autoDiscover": false
  }
}
```

The discover command will skip your package entirely. Users have to import the class and add it to their providers array explicitly. They get the discovery benefits for everything else; your package stays opt-in.

### Turn off auto-discovery entirely

Don't call `defaultProviders()`. Import each `*Provider` class explicitly and list them in the array — that's exactly how things worked before auto-discovery and it still works:

```ts
import { LogProvider } from '@rudderjs/log'
import { CacheProvider } from '@rudderjs/cache'
import { AuthProvider } from '@rudderjs/auth'
import { AppServiceProvider } from './app/Providers/AppServiceProvider.js'

export default [
  LogProvider,
  CacheProvider,
  AuthProvider,
  AppServiceProvider,
]
```

You take ownership of the order yourself.

## Common errors

**`@rudderjs/X listed in the provider manifest but not installed`**

You removed a package from `package.json` but the manifest still references it. Run `pnpm rudder providers:discover` to refresh.

**`Multiple @rudderjs/orm-* drivers installed but config('database.driver') is "..."`**

Two competing drivers are installed and the config key points at neither. Set `config('database.driver')` to one of the installed packages.

**`Circular provider dependency: A → B → C → A`**

Package `A` declares `depends: [B]`, `B` declares `depends: [C]`, and `C` declares `depends: [A]`. Break the cycle by removing one of the `depends` entries.

**`<package> declared provider "X" in package.json but no such class is exported from its main entry`**

The `rudderjs.provider` field doesn't match any export. Check the package's `src/index.ts` and make sure the class name is correct and exported.

**Optional peer fails to load with `No "exports" main defined`**

The package's `exports` field has only an `import` condition (ESM-only) and the resolver is using CJS. `@rudderjs/support`'s `resolveOptionalPeer()` walks `node_modules` and reads `exports['.']['import']` directly as a fallback, so this shouldn't surface in normal use. If you hit it in your own resolution code, add `"default": "./dist/index.js"` to the package's exports.

## Tips

- The manifest is generated, not derived at runtime — always run `providers:discover` after installing or removing packages.
- The scaffolder runs `providers:discover` automatically when you pass `--install`. You only need to run it manually for hand-created apps or when adding packages later.
- `bootstrap/cache/` is gitignored — each developer regenerates the manifest locally.
- For tests, the loader gracefully degrades to a minimal built-in registry (log, orm-prisma, session, hash, cache, auth) if no manifest exists.
- `eventsProvider({...})` stays as a function and lives outside auto-discovery — it takes a per-app event-listener map, not a config key.
- Custom providers in `app/Providers/` (your `AppServiceProvider`, etc.) don't need a `rudderjs` field — they're not in `node_modules` and you list them explicitly in the array anyway.
