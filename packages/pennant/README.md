# @rudderjs/pennant

Feature flags for RudderJS — define features, check activation, scope to users/teams, and gradually roll out with Lottery.

## Installation

```bash
pnpm add @rudderjs/pennant
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { pennant } from '@rudderjs/pennant'

export default [
  // ...other providers
  pennant(),
]
```

## Usage

### Defining Features

```ts
import { Feature, Lottery } from '@rudderjs/pennant'

// Boolean feature
Feature.define('dark-mode', () => true)

// Rich value
Feature.define('max-uploads', () => 10)

// Scoped to user
Feature.define('beta-dashboard', (scope) => {
  return scope?.id === 1  // only for user 1
})

// Gradual rollout — 10% of users
Feature.define('new-checkout', () => Lottery.odds(1, 10))
```

### Checking Features

```ts
if (await Feature.active('dark-mode')) {
  // feature is on
}

const maxUploads = await Feature.value<number>('max-uploads')
```

### Scoped Checks

```ts
const user = { id: 1, name: 'Alice' }

await Feature.for(user).active('beta-dashboard')  // true
await Feature.for(user).value('max-uploads')       // 10

// Bulk check
await Feature.for(user).values(['dark-mode', 'beta-dashboard'])
// { 'dark-mode': true, 'beta-dashboard': true }
```

### Manual Activation

```ts
// Force a feature on for a specific scope
await Feature.activate('beta-dashboard', user)

// Force off
await Feature.deactivate('beta-dashboard', user)

// Clear all stored values (re-resolves on next check)
await Feature.purge('beta-dashboard')
```

### Lottery (Gradual Rollout)

```ts
Feature.define('new-ui', () => Lottery.odds(1, 10))  // 10% chance

// First check resolves the lottery and persists the result.
// Subsequent checks for the same scope return the same value.
await Feature.active('new-ui')       // true or false (stable)
await Feature.active('new-ui')       // same result as above
```

## Middleware

Block routes when a feature is inactive:

```ts
import { FeatureMiddleware } from '@rudderjs/pennant'

router.get('/beta', FeatureMiddleware('beta-dashboard'), handler)
// Returns 403 if the feature is not active for req.user
```

## Drivers

| Driver | Description |
|---|---|
| `MemoryDriver` | In-memory `Map` — default. No persistence across restarts. |

## Testing

```ts
import { Feature } from '@rudderjs/pennant'

const fake = Feature.fake()

// Override feature values
fake.override('dark-mode', true)
fake.override('beta', false)

// Assertions
await Feature.active('dark-mode')
fake.assertChecked('dark-mode')
fake.assertNotChecked('other-feature')
fake.assertCheckedFor('dark-mode', { id: 1 })

fake.restore()
```

## API Reference

| Method | Description |
|---|---|
| `Feature.define(name, resolver)` | Register a feature with a resolver function |
| `Feature.active(name, scope?)` | Check if a feature is active (boolean) |
| `Feature.value<T>(name, scope?)` | Get the resolved value of a feature |
| `Feature.values(names, scope?)` | Bulk-resolve multiple features |
| `Feature.for(scope)` | Create a scoped feature checker |
| `Feature.activate(name, scope?)` | Force-activate a feature |
| `Feature.deactivate(name, scope?)` | Force-deactivate a feature |
| `Feature.purge(name)` | Clear all stored values for a feature |
| `Feature.fake()` | Install fake driver for testing |
| `Lottery.odds(winners, total)` | Create a lottery for gradual rollout |
| `FeatureMiddleware(name)` | Middleware that returns 403 if feature is inactive |
| `pennant(config?)` | Service provider factory |
