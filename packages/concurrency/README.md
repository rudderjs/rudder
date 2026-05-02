# @rudderjs/concurrency

Parallel execution for RudderJS — run tasks in worker threads, defer fire-and-forget work, and switch to a sync driver for testing.

## Installation

```bash
pnpm add @rudderjs/concurrency
```

## Usage

### Parallel Execution

```ts
import { Concurrency } from '@rudderjs/concurrency'

const [users, products, orders] = await Concurrency.run([
  () => fetchUsers(),
  () => fetchProducts(),
  () => fetchOrders(),
])
```

Tasks run in a pool of worker threads (defaults to `os.cpus().length`). Results are returned in the same order as the input tasks.

### Deferred Tasks

Fire-and-forget — runs in a worker thread, errors are logged but not thrown:

```ts
Concurrency.defer(() => {
  // Post-response cleanup, analytics, etc.
  sendAnalyticsEvent('page_view', { path: '/dashboard' })
})
```

### Task Constraints

Tasks are serialized via `.toString()` and evaluated in worker threads. This means:

- Tasks must be **self-contained** — closures over external variables will not work
- Use **dynamic imports** inside the task for dependencies
- Serializable return values only (no functions, classes, or circular refs)

```ts
// Works — self-contained
await Concurrency.run([
  () => 2 + 2,
  async () => {
    const { readFile } = await import('node:fs/promises')
    return readFile('/tmp/data.txt', 'utf-8')
  },
])

// Does NOT work — closes over external variable
const multiplier = 3
await Concurrency.run([
  () => 2 * multiplier,  // ReferenceError: multiplier is not defined
])
```

## Testing

Switch to a synchronous driver that runs everything in the main thread:

```ts
import { Concurrency } from '@rudderjs/concurrency'

Concurrency.fake()

// Tasks now run sequentially in the main thread
const results = await Concurrency.run([
  () => 'a',
  () => 'b',
])
// ['a', 'b']

// Restore worker driver
await Concurrency.restore()
```

## API Reference

| Method | Description |
|---|---|
| `Concurrency.run(tasks)` | Run tasks in parallel via worker threads, return results in order |
| `Concurrency.defer(task)` | Fire-and-forget a task in a worker thread |
| `Concurrency.fake()` | Switch to sync driver (sequential, main thread) |
| `Concurrency.restore()` | Restore the default worker driver |

The pool size defaults to `os.cpus().length`. There is no runtime configuration API in 1.0 — the defaults cover the common use cases (CPU-bound parallelism for small task counts).

## Common Pitfalls

- **Closures over external variables don't work.** Tasks are serialized via `.toString()` and re-evaluated in a fresh worker context — they don't carry the surrounding scope. Inline any constants, or pass values via `new Function` source generation. See the "Task Constraints" section above.
- **Return values must be structured-cloneable.** Functions, classes with prototypes, and circular references can't cross the worker boundary. Plain objects, primitives, arrays, Buffers, and TypedArrays work.
- **Errors in `defer()` are swallowed.** They're logged to `console.error` and never reach your code. For durable error handling, use `@rudderjs/queue` instead — it persists jobs and supports retries.
- **Workers don't auto-terminate on process exit.** Call `await Concurrency.restore()` if you need a clean shutdown (also useful between tests). Otherwise the pool lives for the process lifetime.
- **Vite SSR / dev mode requires the package to be built.** Worker entry is loaded from `dist/worker-entry.js` via `import.meta.url`. If you change the package source, run `pnpm build` for `@rudderjs/concurrency` and restart your dev server — Vite HMR doesn't catch worker-entry changes.
- **Don't use for I/O-bound work.** Worker threads are for CPU-bound parallelism. For HTTP fetches, DB queries, or filesystem I/O, plain `Promise.all` is faster (no serialization overhead, no worker startup cost).
- **`Concurrency.fake()` is global.** Tests that call it must call `Concurrency.restore()` in `afterEach`, or the sync driver leaks into the next test.

## Key Imports

```ts
import { Concurrency } from '@rudderjs/concurrency'
```
