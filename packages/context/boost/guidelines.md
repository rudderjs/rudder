# @rudderjs/context

## Overview

Request-scoped context — an AsyncLocalStorage-backed data bag that **auto-propagates to log entries and queued jobs**. Put `userId`, `tenantId`, `traceId` in at middleware time; every log line and every queued job carries those fields automatically. Laravel's context package for Node, plus the dehydrate/rehydrate flow that makes it safe across process boundaries.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { context } from '@rudderjs/context'
export default [..., context()]

// bootstrap/app.ts — middleware installs the ALS store per request
import { ContextMiddleware } from '@rudderjs/context'

.withMiddleware((m) => {
  m.use(ContextMiddleware())
})
```

Without the middleware, `Context.*` calls throw — the ALS store isn't initialized. Install globally (`m.use`) unless you really only need context on one group.

### Basic data

```ts
import { Context } from '@rudderjs/context'

Context.add('user_id', 123)
Context.add('tenant', 'acme')

Context.get('user_id')        // 123
Context.has('tenant')          // true
Context.all()                  // { user_id: 123, tenant: 'acme' }
Context.forget('tenant')
```

### Hidden data

Excluded from `all()`, `dehydrate()`, and log propagation — useful for secrets and internal tracing tokens that shouldn't leak downstream:

```ts
Context.addHidden('api_key', 'sk-...')
Context.getHidden('api_key')   // 'sk-...'
Context.allHidden()             // { api_key: 'sk-...' }
Context.allWithHidden()         // visible + hidden merged
```

### Stacks

Append-only lists — useful for breadcrumbs:

```ts
Context.push('breadcrumbs', 'AuthMiddleware')
Context.push('breadcrumbs', 'UserController')
Context.stack('breadcrumbs')   // ['AuthMiddleware', 'UserController']
```

### Scopes (isolated child context)

```ts
Context.add('color', 'blue')

Context.scope(() => {
  Context.add('color', 'red')
  Context.get('color')         // 'red' — inside the scope
})

Context.get('color')           // 'blue' — parent unchanged
```

Scopes inherit parent state at creation time; changes inside don't leak back out.

### Log + job propagation

- **`@rudderjs/log`** — every `Log.info()` / `Log.error()` / etc. automatically includes `Context.all()` fields in its entry.
- **`@rudderjs/queue`** — `Job.dispatch().send()` captures `Context.dehydrate()` at dispatch time; the worker re-hydrates before running `handle()`, so logs inside the job share the same `userId`/`tenantId`/`traceId`.

You don't wire any of this manually — Context hooks into both packages via observer registries.

### Dehydrate / rehydrate

Cross-process: serialize the visible (non-hidden) context to JSON, pass it downstream, rehydrate on the other side:

```ts
const snapshot = Context.dehydrate()   // safe JSON
// ... ship over a message bus, queue, HTTP, etc ...

Context.rehydrate(snapshot)             // restore in the receiving worker
```

The queue package does this automatically. Do it yourself when you're implementing a custom transport (SQS, Kafka, RabbitMQ, etc.).

## Common Pitfalls

- **`Context.*` outside middleware.** Throws "No context store" because ALS isn't initialized. Ensure `ContextMiddleware()` is installed globally (`m.use`), not just on one group — otherwise `Log` calls from api routes miss context.
- **Forgetting hidden-data scope.** Hidden data is included in `allWithHidden()` but NOT in `all()`, `dehydrate()`, or log output. If you want something to leak to logs/jobs, use `add()`, not `addHidden()`. If you want it scoped to this request only and never logged, use `addHidden()`.
- **Mutating context in a job handler expecting it to propagate back.** Jobs rehydrate a snapshot — changes to context inside the handler stay in that worker's ALS. They don't reflect back to the dispatcher.
- **Context changes "leaking" across requests.** They can't — each request runs in its own ALS store via `ContextMiddleware()`. If you observe leaking, something is calling `Context.*` outside the middleware's `runInContext()` wrap (e.g. from a module-level setInterval).
- **`Context.scope()` in async callbacks.** Scopes are synchronous by default. For async code paths, pass an async callback — `Context.scope(async () => { ... })`.
- **Log redaction.** Context entries become part of every log line. Don't `Context.add('password', ...)`. Use `addHidden()` for secrets, or don't put them in context at all.

## Key Imports

```ts
import { context, Context, ContextMiddleware } from '@rudderjs/context'

import type { DehydratedContext } from '@rudderjs/context'
```
