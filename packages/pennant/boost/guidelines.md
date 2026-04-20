# @rudderjs/pennant

## Overview

Feature flags — define features, check activation, scope to users/teams, gradually roll out with Lottery. Laravel Pennant for Node. Ships `memory` and `database` drivers, middleware for route-level gating, and `Feature.fake()` for testing. Use for dark launches, A/B tests, per-tenant gates, and sunsetting old code paths.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { pennant } from '@rudderjs/pennant'
export default [..., pennant()]
```

### Defining features

```ts
// In a provider's boot() or routes/console.ts
import { Feature, Lottery } from '@rudderjs/pennant'

// Static
Feature.define('dark-mode', () => true)
Feature.define('beta-dashboard', (user) => user?.isBetaTester ?? false)

// Typed values (not just boolean)
Feature.define('max-uploads', (user) => user?.plan === 'pro' ? 100 : 10)

// Gradual rollout
Feature.define('new-ui', () => Lottery.odds(1, 10))    // 10% chance per scope
```

### Checking

```ts
// Global — uses the default resolver scope (typically req.user)
if (await Feature.active('dark-mode')) { /* ... */ }

const maxUploads = await Feature.value<number>('max-uploads')

// Scoped to a specific entity
const user = { id: 1, name: 'Alice' }

await Feature.for(user).active('beta-dashboard')   // true/false
await Feature.for(user).value('max-uploads')        // 10

// Bulk
await Feature.for(user).values(['dark-mode', 'beta-dashboard'])
// { 'dark-mode': true, 'beta-dashboard': true }
```

### Manual activation

```ts
await Feature.activate('beta-dashboard', user)     // force on
await Feature.deactivate('beta-dashboard', user)   // force off
await Feature.purge('beta-dashboard')              // clear all stored values
```

### Lottery (sticky random rollout)

```ts
Feature.define('new-ui', () => Lottery.odds(1, 10))    // 10% rollout

// First check resolves the lottery and persists the result per scope.
await Feature.active('new-ui')       // true or false
await Feature.active('new-ui')       // same result — sticky per scope
```

The lottery runs once per `(feature, scope)` pair and is stored in the driver. Same user gets the same answer across restarts (with database driver) or until process restart (with memory driver).

### Middleware

```ts
import { FeatureMiddleware } from '@rudderjs/pennant'

Route.get('/beta', FeatureMiddleware('beta-dashboard'), handler)
// Returns 403 if the feature is not active for req.user
```

### Drivers

| Driver | Persistence | Use case |
|---|---|---|
| `MemoryDriver` | In-process Map, resets on restart | Dev, tests |
| `DatabaseDriver` | Prisma `FeatureFlag` model | Production — sticky across restarts, shared across processes |

For the database driver, publish the schema: `pnpm rudder vendor:publish --tag=pennant-schema` → `prisma/schema/pennant.prisma` → `prisma db push`.

### Testing

```ts
import { Feature } from '@rudderjs/pennant'

const fake = Feature.fake()

fake.override('dark-mode', true)
fake.override('beta', false)

await Feature.active('dark-mode')    // true (from fake)

fake.assertChecked('dark-mode')
fake.assertNotChecked('other-feature')
fake.assertCheckedFor('dark-mode', { id: 1 })

fake.restore()
```

No real driver calls under `Feature.fake()`.

## Common Pitfalls

- **Calling `Feature.active` before `pennant()` booted.** Throws — the feature registry is set up during `boot()`. Register the provider early in `bootstrap/providers.ts`.
- **Lottery + memory driver in multi-process.** Each process has its own memory, so a user gets different answers in different processes. Use the database driver for any real rollout — even "dev-only" rollouts will bite you on restart.
- **Scope equality.** `Feature.for({ id: 1 })` and `Feature.for({ id: 1 })` — same scope. `Feature.for(user)` and `Feature.for(freshQuery(user))` — same scope (identity is by key, not reference). But `Feature.for('user-1')` and `Feature.for({ id: 1 })` — different scopes. Pick one serialization (usually `{ id }` from the entity) and stick with it.
- **Long-lived lottery answers in dev.** `Feature.purge('new-ui')` clears stored lottery results. Use during dev iteration when you want fresh coin flips.
- **Feature values that call the DB on every check.** The resolver function runs on every `Feature.active()` call for unresolved scopes. Either cache the lookup inside the resolver, use a static value, or rely on the database driver's sticky persistence.
- **Forgetting `fake.restore()` in tests.** Fake state persists across tests. Restore in `afterEach`.

## Key Imports

```ts
import { pennant, Feature, Lottery, FeatureMiddleware } from '@rudderjs/pennant'

import type { FeatureResolver, PennantConfig } from '@rudderjs/pennant'
```
