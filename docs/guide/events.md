# Events

The framework's event system lets one part of your app announce that something happened (a user registered, an order was placed) and let other parts react to it — without those parts knowing about each other. Listeners can run inline or be queued for background processing.

`EventDispatcher` and the `dispatch()` helper live in `@rudderjs/core`. There's no separate package to install.

## Defining an event

An event is a plain class. The class name is the event identifier:

```ts
// app/Events/UserRegistered.ts
import { User } from '../Models/User.js'

export class UserRegistered {
  constructor(public readonly user: User) {}
}
```

Generate stubs with `pnpm rudder make:event UserRegistered`.

## Defining a listener

A listener is a class with a `handle(event)` method. Each listener handles one event type:

```ts
// app/Listeners/SendWelcomeEmail.ts
import type { Listener } from '@rudderjs/core'
import { Mail } from '@rudderjs/mail'
import { UserRegistered } from '../Events/UserRegistered.js'
import { WelcomeEmail } from '../Mail/WelcomeEmail.js'

export class SendWelcomeEmail implements Listener<UserRegistered> {
  async handle(event: UserRegistered): Promise<void> {
    await Mail.to(event.user.email).send(new WelcomeEmail(event.user))
  }
}
```

For background work, dispatch a job inside `handle()` rather than blocking the request:

```ts
async handle(event: UserRegistered) {
  await SendWelcomeEmail.dispatch(event.user.id).send()
}
```

## Wiring events to listeners

Pass a listener map to `eventsProvider({...})` in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { eventsProvider } from '@rudderjs/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmail } from '../app/Listeners/SendWelcomeEmail.js'
import { LogRegistration } from '../app/Listeners/LogRegistration.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({
    [UserRegistered.name]: [SendWelcomeEmail, LogRegistration],
  }),
]
```

The map's keys are class names (use `EventClass.name` to keep them in sync if the class is renamed). Each event can have multiple listeners — they fire in registration order.

`eventsProvider({...})` is a function, not a class — it takes a per-app listener map. It's the one provider that doesn't participate in auto-discovery; you always list it explicitly.

## Dispatching

```ts
import { dispatch } from '@rudderjs/core'
import { UserRegistered } from '../app/Events/UserRegistered.js'

await dispatch(new UserRegistered(user))
```

`dispatch()` resolves listeners and runs them in order. Each listener's `handle()` is awaited in a plain loop, so an unhandled error in one listener stops the remaining listeners and propagates immediately.

## Wildcard listeners

Subscribe to every event with `'*'`:

```ts
eventsProvider({
  '*': [AuditLogger],
})
```

Wildcard listeners receive the event object as their `handle()` argument — useful for centralized logging, telemetry, or audit trails.

## Using the dispatcher directly

For programmatic registration (e.g. inside a service provider's `boot()`), reach for the global dispatcher:

```ts
import { dispatcher } from '@rudderjs/core'

dispatcher.register('UserRegistered', new SendWelcomeEmail())
dispatcher.hasListeners('UserRegistered')   // boolean
dispatcher.count('UserRegistered')          // number
```

Most apps stick with `eventsProvider({...})` — it's declarative and the listener map is one place to read.

## Background dispatch

For listeners that are slow (sending mail, calling APIs, processing data), wrap the work in a queue job and dispatch from the listener:

```ts
async handle(event: UserRegistered) {
  await SendWelcomeEmailJob.dispatch(event.user.id).send()
}
```

The event fires synchronously; the job runs in the background. A future release may add a built-in `static queue = true` shortcut on the listener — for now, the explicit job class is the pattern.

## Testing

```ts
import { EventFake, dispatch } from '@rudderjs/core'

const fake = EventFake.fake()

await someCodeThatDispatches()

fake.assertDispatched('UserRegistered')
fake.assertDispatched('UserRegistered', (e) => e.user.id === '42')
fake.assertDispatchedTimes('UserRegistered', 1)
fake.assertNothingDispatched()
```

`EventFake` swaps the dispatcher for the duration of the test — no listeners run, but every dispatch is recorded for assertion.

## Pitfalls

- **String-keyed listener map drift.** Renaming an event class breaks the map's string key silently. Use `[ClassName.name]` so the key tracks the class.
- **Listener throwing inside a request.** An unhandled error stops the remaining listeners and propagates out of `dispatch()` immediately. Catch inside the listener (and `report(err)`) when you want fault isolation or want later listeners to still run.
- **Long-running synchronous listeners.** Anything slow blocks the dispatching code (often a route handler). Queue the work via a job and dispatch the job from `handle()`.
