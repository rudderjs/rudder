# Pennant

Feature flags for Rudder. Define a flag once, check it from anywhere — globally, per user, or via a gradual lottery-based rollout. Use it for staged releases, gating beta features behind specific accounts, or A/B'ing alternate UIs.

## Install

```bash
pnpm add @rudderjs/pennant
```

The provider is auto-discovered — no manual wiring in `bootstrap/providers.ts`.

```ts
// playground use case from app/Providers/AppServiceProvider.ts
import { Feature, Lottery } from '@rudderjs/pennant'

export class AppServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    Feature.define('dark-mode',      () => true)
    Feature.define('max-uploads',    () => 10)
    Feature.define('beta-dashboard', (scope) => typeof scope === 'object' && scope !== null)
    Feature.define('new-checkout',   () => Lottery.odds(1, 4))
  }
}
```

Definitions live in your `AppServiceProvider.boot()` — they are evaluated lazily on the first check.

## Defining features

```ts
import { Feature, Lottery } from '@rudderjs/pennant'

// Boolean flag — always on
Feature.define('dark-mode', () => true)

// Rich value — a flag is anything serialisable, not just true/false
Feature.define('max-uploads', () => 10)
Feature.define('plan-tier',   () => 'pro')

// Scoped flag — resolver receives the scope passed to Feature.active(...)
Feature.define('beta-dashboard', (scope) => scope?.id === 1)

// Async resolver — call out to a remote config source if you need to
Feature.define('experimental-search', async (scope) => {
  return await growthBook.isOn('experimental-search', scope)
})
```

Each call to `Feature.define()` registers (or replaces) the resolver for that name. Resolvers are async-aware — return a `Promise` and the value is awaited.

## Checking features

```ts
if (await Feature.active('dark-mode')) {
  // flag is truthy
}

const limit = await Feature.value<number>('max-uploads')   // 10
const tier  = await Feature.value<string>('plan-tier')     // 'pro'
```

`Feature.active(name)` coerces the resolved value to a boolean. `Feature.value(name)` returns the raw value — use it when the flag carries data, not just on/off.

## Scoped checks

Pass the scope explicitly, or fluent-chain it:

```ts
const user = { id: 1, name: 'Alice' }

// Explicit
await Feature.active('beta-dashboard', user)        // true
await Feature.value('max-uploads', user)            // 10

// Fluent — same result, easier to chain
await Feature.for(user).active('beta-dashboard')
await Feature.for(user).value('max-uploads')

// Bulk — resolve a batch in one round-trip
await Feature.for(user).values(['dark-mode', 'beta-dashboard', 'new-checkout'])
// { 'dark-mode': true, 'beta-dashboard': true, 'new-checkout': false }
```

The scope can be any `{ id }` object, a string, a number, or `null` for guests. Internally the scope is normalised to a string key — `User:1`, `Team:42`, etc — so two distinct objects with the same `id` collapse to the same scope.

## Lottery (gradual rollout)

`Lottery.odds(winners, total)` is a one-shot probability — return it from a resolver to roll the dice the first time a scope checks the flag, then memoise the result for that scope:

```ts
Feature.define('new-ui', () => Lottery.odds(1, 10))   // 10% rollout

await Feature.for(user).active('new-ui')   // true or false — random first time
await Feature.for(user).active('new-ui')   // same result — stable for this scope
```

The first check stores the boolean against `user.id`; every subsequent check returns the stored value. Different scopes roll independently, so each user sees a stable "in" or "out".

To re-roll for everyone (e.g., expanding the rollout from 10% to 50%), bump the odds and call `Feature.purge('new-ui')` — see [Manual activation](#manual-activation).

## Manual activation

Force a specific scope into the "on" or "off" cohort regardless of the resolver:

```ts
// Force-activate for a user — overrides resolver + Lottery
await Feature.activate('beta-dashboard', user)

// Force-deactivate
await Feature.deactivate('beta-dashboard', user)

// Clear ALL stored values for this flag — Lottery rolls re-evaluate, manual activations get cleared
await Feature.purge('new-ui')
```

Use `activate` / `deactivate` for explicit allow- and deny-lists ("internal users get the new dashboard, customer X is opted out"). Use `purge` to reset everyone's lottery roll when you change the resolver — otherwise stored results from the old odds linger.

## Route middleware

Block routes whose flag is inactive for the current user:

```ts
import { FeatureMiddleware } from '@rudderjs/pennant'

Route.get('/beta', FeatureMiddleware('beta-dashboard'), handler)
```

`FeatureMiddleware` reads `req.user` as the scope and returns `403 { message: 'Feature not available.' }` when the flag resolves falsy. Combine with your normal auth middleware for a typical "signed-in + feature-gated" route — auth runs first, then the feature check uses the populated `req.user`:

```ts
Route.get('/beta', AuthMiddleware(), FeatureMiddleware('beta-dashboard'), handler)
```

For a controller-returned view (`@rudderjs/view`), the middleware short-circuits before the view function runs — unauthorized scopes never see the page.

## Drivers

| Driver | Persistence | When to use |
|---|---|---|
| `MemoryDriver` *(default)* | In-process `Map`, lost on restart | Dev, tests, single-process apps where roll stability across restarts isn't required |

Persistent drivers (database, Redis) are not built in yet. Implement the `PennantDriver` interface and inject your driver if you need durability:

```ts
interface PennantDriver {
  get(feature: string, scope: string): Promise<unknown | undefined>
  set(feature: string, scope: string, value: unknown): Promise<void>
  delete(feature: string, scope: string): Promise<void>
  purge(feature: string): Promise<void>
}
```

A Prisma-backed implementation is roughly 30 lines — one table, four method bodies. Wrap your driver in a custom provider that bypasses auto-discovery (`rudderjs.autoDiscover: false` in your app's package, then register `PennantProvider`'s replacement manually).

## Testing

`Feature.fake()` swaps the resolver lookup for an in-memory override map and records every check for assertions:

```ts
import { Feature } from '@rudderjs/pennant'

const fake = Feature.fake()

// Override values — these win over the registered resolver
fake.override('dark-mode', true)
fake.override('plan-tier', 'enterprise')

// Run the code under test
await myHandler(req, res)

// Assert
fake.assertChecked('dark-mode')
fake.assertNotChecked('beta-dashboard')
fake.assertCheckedFor('plan-tier', { id: 1 })

fake.restore()  // tear down — required between tests
```

`fake.restore()` is a hard reset; without it, the next test inherits the override map. Pair it with your runner's `afterEach`.

## Pitfalls

- **Lottery is sticky per scope.** Once a scope's roll is stored, changing `Lottery.odds(1, 10)` to `Lottery.odds(5, 10)` doesn't re-roll existing scopes. Call `Feature.purge('flag-name')` to wipe stored values when expanding a rollout.
- **`MemoryDriver` resets on restart.** Stored Lottery rolls and manual activations live in-process — every server restart re-rolls. Implement a persistent `PennantDriver` before relying on rollout stability across deployments.
- **Scope normalisation collapses by `id`.** Two `User` instances with the same `id` are treated as the same scope. If your "scope" actually depends on per-request mutable state (request URL, cart contents), pass a string scope you own — not a domain object.
- **Forgetting to define before checking.** `Feature.active('not-defined')` throws `Feature "not-defined" is not defined.` — define every flag in `AppServiceProvider.boot()` so the registry is populated before any handler runs.
- **`Feature.fake().restore()` between tests.** Forget it and the next test inherits leftover overrides + check records, producing surprising assertion passes/failures. Wire `restore()` into `afterEach`.
- **Middleware uses `req.user`.** `FeatureMiddleware` reads `req.user` as the scope, which is only populated on the `web` group (where `AuthMiddleware` runs) or per-route. On the `api` group, attach `AuthMiddleware()` (or a token guard) before `FeatureMiddleware()` if your flag is user-scoped.
