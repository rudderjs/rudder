# @rudderjs/context

Request-scoped context for RudderJS — an ALS-backed data bag that auto-propagates to log entries and queued jobs.

## Installation

```bash
pnpm add @rudderjs/context
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { context } from '@rudderjs/context'

export default [
  // ...other providers
  context(),
]
```

Add the middleware in `bootstrap/app.ts`:

```ts
import { ContextMiddleware } from '@rudderjs/context'

.withMiddleware((m) => {
  m.use(ContextMiddleware())
})
```

## Usage

### Basic Data

```ts
import { Context } from '@rudderjs/context'

Context.add('user_id', 123)
Context.add('tenant', 'acme')

Context.get('user_id')       // 123
Context.has('tenant')        // true
Context.all()                // { user_id: 123, tenant: 'acme' }
Context.forget('tenant')
```

### Hidden Data

Hidden context is excluded from `all()`, `dehydrate()`, and log propagation:

```ts
Context.addHidden('api_key', 'sk-...')
Context.getHidden('api_key')  // 'sk-...'
Context.allHidden()           // { api_key: 'sk-...' }
Context.allWithHidden()       // { user_id: 123, api_key: 'sk-...' }
```

### Stacks

```ts
Context.push('breadcrumbs', 'AuthMiddleware')
Context.push('breadcrumbs', 'UserController')
Context.stack('breadcrumbs')  // ['AuthMiddleware', 'UserController']
```

### Scoped Context

Run code in a child scope — changes don't leak to the parent:

```ts
Context.add('color', 'blue')

Context.scope(() => {
  Context.add('color', 'red')
  Context.get('color')  // 'red'
})

Context.get('color')  // 'blue'
```

### Remember (Memoize)

Cache a value for the lifetime of the request:

```ts
const user = Context.remember('current_user', () => {
  return db.users.findById(userId)  // only runs once
})
```

### Conditional

```ts
Context.when(req.user, (ctx) => {
  ctx.add('user_id', req.user.id)
})
```

## Log Integration

When `@rudderjs/log` is installed, all context data is automatically merged into every log entry's context. No configuration needed — the provider wires this up on boot.

## Queue Integration

Context is automatically serialized into queued jobs and restored on the worker side:

```ts
// In a request handler — context is active
Context.add('tenant_id', 42)

// Job dispatched — context is dehydrated into the payload
await SendReport.dispatch(reportId).send()

// On the worker — context is hydrated automatically
// Inside the job's handle(), Context.get('tenant_id') returns 42
```

### Manual Serialization

```ts
const payload = Context.dehydrate()
// { data: { tenant_id: 42 }, stacks: {} }

// Later, in a different context:
Context.hydrate(payload)
```

## API Reference

| Method | Description |
|---|---|
| `Context.add(key, value)` | Set a public context value |
| `Context.get<T>(key)` | Get a value (undefined if missing or no context) |
| `Context.has(key)` | Check if a key exists |
| `Context.all()` | Get all public data as a plain object |
| `Context.forget(key)` | Remove a key |
| `Context.addHidden(key, value)` | Set a hidden value (excluded from logs/queue) |
| `Context.getHidden<T>(key)` | Get a hidden value |
| `Context.allHidden()` | Get all hidden data |
| `Context.allWithHidden()` | Get all data (public + hidden) |
| `Context.push(key, value)` | Append to a stack |
| `Context.stack(key)` | Get a stack array |
| `Context.scope(fn)` | Run fn in a child scope (changes don't leak) |
| `Context.when(cond, fn)` | Conditional execution |
| `Context.remember(key, fn)` | Memoize for request lifetime |
| `Context.dehydrate()` | Serialize for queue propagation |
| `Context.hydrate(payload)` | Restore from serialized payload |
| `Context.flush()` | Clear all data |

### Helpers

| Function | Description |
|---|---|
| `runWithContext(fn)` | Run fn inside a fresh context scope |
| `hasContext()` | Check if a context scope is active |
| `ContextMiddleware()` | Middleware that wraps requests in a context scope |
| `context()` | Service provider factory |
