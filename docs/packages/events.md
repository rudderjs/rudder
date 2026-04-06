# Events (Core)

> **Merged into `@rudderjs/core`** — EventDispatcher, Listener interface, and `dispatch()` helper are now part of the core package.

```ts
import { dispatch, events } from '@rudderjs/core'

// Register a listener
events().listen('user.registered', async (payload) => {
  console.log('New user:', payload.user.email)
})

// Dispatch an event
await dispatch('user.registered', { user })
```

See the [Core package docs](./core/index.md) for full documentation.
