# @forge/events

Event dispatcher, Listener contract, and provider factory for synchronous event-driven programming.

## Installation

```bash
pnpm add @forge/events
```

## Setup

Register the events provider in `bootstrap/providers.ts` by passing a listen map that maps event class names to arrays of listener classes:

```ts
// bootstrap/providers.ts
import { events } from '@forge/events'
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
import type { Listener } from '@forge/events'
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
import { router } from '@forge/router'
import { dispatch } from '@forge/events'
import { UserRegistered } from '../app/Events/UserRegistered.js'

router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body)

  dispatch(new UserRegistered(user.id))

  return res.json({ data: user })
})
```

## The `dispatcher` Singleton

The global `dispatcher` singleton is available for imperative registration and dispatch outside of the provider factory:

```ts
import { dispatcher } from '@forge/events'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmail } from '../app/Listeners/SendWelcomeEmail.js'

// Dispatch an event
dispatcher.dispatch(new UserRegistered('user-123'))

// Register a listener at runtime
dispatcher.listen(UserRegistered, SendWelcomeEmail)
```

## API Reference

### `ListenMap`

The type accepted by the `events()` factory:

```ts
type ListenMap = Record<string, (typeof Listener)[]>
```

Keys are event class names (matched via `event.constructor.name`). Values are arrays of listener classes to invoke when the event is dispatched.

### `events(listenMap)`

Factory function that returns a `ServiceProvider` class. When registered in `bootstrap/providers.ts`, it iterates the listen map and calls `dispatcher.listen()` for each entry during the provider's `register` phase.

```ts
import { events } from '@forge/events'

events({
  UserRegistered: [SendWelcomeEmail, LogUserRegistration],
  OrderPlaced:    [SendOrderConfirmation, UpdateInventory],
})
```

### `dispatch(event)`

Convenience helper that delegates to `dispatcher.dispatch()`. Resolves each registered listener in order and awaits its `handle()` method before proceeding to the next.

```ts
import { dispatch } from '@forge/events'

dispatch(new UserRegistered(user.id))
```

### `Listener<T>` Interface

```ts
interface Listener<T = unknown> {
  handle(event: T): Promise<void> | void
}
```

### `EventDispatcher`

| Method | Description |
|---|---|
| `dispatch(event)` | Resolves listeners by `event.constructor.name` and invokes each `handle()` in order |
| `listen(EventClass, ListenerClass)` | Registers a listener class for the given event class |

## Notes

- Listeners are resolved by matching `event.constructor.name` to the keys in the listen map — ensure minification does not mangle class names in production builds.
- Handlers are awaited sequentially in the order they are registered.
- Registering `events(listenMap)` in `bootstrap/providers.ts` is a side-effect: all listeners are wired up during provider registration before any HTTP request is handled.
- For deferred or background processing, dispatch a job from within a listener using `@forge/queue`.
