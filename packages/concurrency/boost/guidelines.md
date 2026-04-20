# @rudderjs/concurrency

## Overview

Parallel execution via Node worker threads — `Concurrency.run(tasks)` fans out CPU-bound work across a worker pool. Includes `defer()` for fire-and-forget tasks and a sync driver (`Concurrency.fake()`) that runs everything on the main thread for testing. Use for CPU-heavy work (hashing, image processing, JSON parsing on huge payloads) where blocking the event loop is unacceptable.

## Key Patterns

### Parallel run

```ts
import { Concurrency } from '@rudderjs/concurrency'

const results = await Concurrency.run([
  async () => expensiveComputation1(),
  async () => expensiveComputation2(),
  async () => expensiveComputation3(),
])

// results is in input order
```

Each function is serialized and sent to a worker thread. They execute in parallel; the promise resolves once all finish, returning results in the same order as the input array.

### Fire-and-forget (`defer`)

```ts
Concurrency.defer(async () => {
  await rebuildSearchIndex()
})
```

Runs in a worker thread without awaiting. Failures are logged (via `@rudderjs/log` when installed) but don't propagate. Use for cache warmups, index rebuilds, telemetry flushing — anything the request doesn't need to wait for.

### Testing — sync driver

Worker threads don't play well with test runners (each worker spins up its own runtime, breaks coverage tooling, etc). Switch to the sync driver:

```ts
import { Concurrency } from '@rudderjs/concurrency'

Concurrency.fake()    // switch to sync driver — sequential, main thread

const results = await Concurrency.run([() => 'a', () => 'b'])
// ['a', 'b'] — ran sequentially on the main thread

await Concurrency.restore()   // back to worker driver
```

All assertions work the same; just no actual threading.

### Closure limitation

**Tasks are serialized and sent to a worker thread.** They don't share the parent's scope:

```ts
// Works — no closure
await Concurrency.run([
  async () => {
    const { readFile } = await import('node:fs/promises')
    return readFile('/tmp/data.txt', 'utf-8')
  },
])

// FAILS — closes over external variable
const multiplier = 3
await Concurrency.run([
  () => 2 * multiplier,         // ReferenceError in worker: multiplier undefined
])
```

Everything the task needs must be either (a) inline, (b) lazy-imported inside the task, or (c) passed through explicit serializable arguments — not captured from the surrounding scope.

## Common Pitfalls

- **Closure capture.** The #1 gotcha. Tasks run in a **fresh V8 context** inside the worker thread — they can't see variables from the dispatching scope. Inline all references or lazy-import inside the task.
- **Non-serializable arguments.** If you pass arguments (e.g. via `Concurrency.run([fn(42)])`), they go through structured-clone. Functions, class instances, DOM nodes, etc. don't survive. Plain data only.
- **Overhead for tiny tasks.** Spinning up a worker costs ~5-10ms. If each task takes <1ms, running sequentially on the main thread is faster. Measure before parallelizing.
- **Blocking inside workers.** Workers have their own event loop, but they're still Node. A synchronous 5-second `for` loop still blocks that worker — just not the main thread. Don't assume workers make everything magically non-blocking.
- **Forgetting `Concurrency.restore()` in tests.** After `Concurrency.fake()`, the next test suite inherits the sync driver unless you restore. Always restore in `afterEach`.
- **`defer()` in request path.** Returns synchronously, but the work keeps the process alive. Fine for short-lived servers; in serverless (Lambda, Workers) the runtime may freeze the context before `defer` completes. Use a proper queue (`@rudderjs/queue`) for durable work.

## Key Imports

```ts
import { Concurrency } from '@rudderjs/concurrency'

import type { ConcurrencyConfig } from '@rudderjs/concurrency'
```
