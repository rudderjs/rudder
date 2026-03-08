# Events (Core)

Event dispatcher, Listener contract, and provider factory for synchronous event-driven programming.

## Installation

```bash
pnpm add @boostkit/core
```

## Setup

Register the events provider in `bootstrap/providers.ts` by passing a listen map that maps event class names to arrays of listener classes:

```ts
// bootstrap/providers.ts
import { events } from '@boostkit/core'
import { SendWelcomeEmail } from '../app/Listeners/SendWelcomeEmail.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'

export default [
  // ...other providers
  events({
    UserRegistered: [SendWelcomeEmail],
  }),
]
```

## Defining Events

Events are plain classes — no base class or interface required. Add whatever properties the event needs to carry.

```ts
// app/Events/UserRegistered.ts
export class UserRegistered {
  constructor(public readonly userId: string) {}
}
```

## Defining Listeners

Listeners implement the `Listener<T>` interface and define a `handle(event)` method:

```ts
// app/Listeners/SendWelcomeEmail.ts
import type { Listener } from '@boostkit/core'
import type { UserRegistered } from '../Events/UserRegistered.js'

export class SendWelcomeEmail implements Listener<UserRegistered> {
  async handle(event: UserRegistered): Promise<void> {
    // send the welcome email
    console.log(`Sending welcome email for user ${event.userId}`)
  }
}
```

## Dispatching Events

Use the `dispatch()` helper anywhere in your application — routes, services, controllers:

```ts
// routes/api.ts
import { router } from '@boostkit/router'
import { dispatch } from '@boostkit/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'

router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)

  await dispatch(new UserRegistered(user.id))

  return res.json({ data: user })
})
```

## The `dispatcher` Singleton

The global `dispatcher` singleton is available for imperative registration and dispatch outside of the provider factory:

```ts
import { dispatcher } from '@boostkit/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmail } from '../app/Listeners/SendWelcomeEmail.js'

// Dispatch an event
await dispatcher.dispatch(new UserRegistered('user-123'))

// Register listeners at runtime
dispatcher.register(UserRegistered.name, new SendWelcomeEmail())
```

## API Reference

### `ListenMap`

The type accepted by the `events()` factory:

```ts
type ListenMap = Record<string, (new () => Listener<never>)[]>
```

Keys are event class names (matched via `event.constructor.name`). Values are arrays of listener classes to invoke when the event is dispatched.

### `events(listenMap)`

Factory function that returns a `ServiceProvider` class. When registered in `bootstrap/providers.ts`, it iterates the listen map and calls `dispatcher.register()` for each entry during the provider's `boot` phase.

```ts
import { events } from '@boostkit/core'

events({
  UserRegistered: [SendWelcomeEmail, LogUserRegistration],
  OrderPlaced:    [SendOrderConfirmation, UpdateInventory],
})
```

### `dispatch(event)`

Convenience helper that delegates to `dispatcher.dispatch()`. Resolves each registered listener in order and awaits its `handle()` method before proceeding to the next.

```ts
import { dispatch } from '@boostkit/core'

dispatch(new UserRegistered(user.id))
```

### `Listener<T>` Interface

```ts
interface Listener<T = unknown> {
  handle(event: T): Promise<void> | void
}
```

### Wildcard Listeners

Register a listener under `'*'` to receive every dispatched event. Wildcard listeners run after all specific listeners:

```ts
import { dispatcher } from '@boostkit/core'

dispatcher.register('*', {
  handle(event) {
    console.log(`[audit] ${event.constructor.name}`)
  },
})
```

### `EventDispatcher`

| Method | Description |
|---|---|
| `register(eventName, ...listeners)` | Register listener instances. Use `'*'` for wildcard (all events). |
| `dispatch(event)` | Invoke specific listeners then wildcard listeners, awaited in order. |
| `count(eventName)` | Number of listeners registered for an event name. |
| `hasListeners(eventName)` | `true` if at least one listener is registered. |
| `list()` | `Record<string, number>` — all registered event names and their listener counts. |
| `reset()` | Clear all listeners. Useful for testing and hot-reload. |

## Notes

- Listeners are resolved by matching `event.constructor.name` to the keys in the listen map — ensure minification does not mangle class names in production builds.
- Handlers are awaited sequentially in the order they are registered.
- Registering `events(listenMap)` in `bootstrap/providers.ts` is a side-effect: all listeners are wired up during provider registration before any HTTP request is handled.
- For deferred or background processing, dispatch a job from within a listener using `@boostkit/queue`.
