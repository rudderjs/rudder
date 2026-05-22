---
"@rudderjs/queue": minor
"@rudderjs/queue-bullmq": patch
"@rudderjs/queue-inngest": patch
---

Closure / chain / batch dispatchers now declare driver capability (Phase 2 of the 2026-05-22 eventing/realtime plan):

Until now, `dispatch(fn)`, `Chain.of([...])`, and `Bus.batch([...])` silently no-op'd on async drivers. Each helper builds a wrapper `{ handle: fn }` plain object that holds the user's logic as a closure — under `JSON.stringify`, the function silently becomes `undefined`. The wrapped job got enqueued, but the worker side reconstructed it with `constructor.name === 'Object'`, no `handle` method, and no error path. Apps shipped "works locally" + "nothing runs in prod".

- **`QueueAdapter` gains three optional `readonly` flags** — `supportsClosures`, `supportsChain`, `supportsBatch`. Drivers that can run wrapped closures (Sync, Fake) declare `true`; drivers that serialise jobs over the wire (BullMQ, Inngest) declare `false`. The flags are additive — existing third-party adapters that don't declare them keep working through the legacy `dispatchBatch` / `dispatchChain` shape checks.
- **`dispatch(fn)`, `Chain.of([...]).dispatch()`, `Bus.batch([...]).dispatch()` throw clear errors** when the registered driver opts out. Each message names the driver and suggests either switching to the sync driver for that code path or rewriting to concrete `Job` classes.
- **Native overrides win.** A driver that ships its own `dispatchChain` / `dispatchBatch` keeps working regardless of the flags — the capability check runs only after the native fast-path doesn't match.
- **`batch.catch()` fires exactly once per batch.** Was called inside each per-job wrapper's catch, so a 3-failure batch fired `catch` three times. Now fires once after `Promise.allSettled`, passing the first rejection reason (or a synthesised error when failures were swallowed inside `allowFailures()` wrappers). Matches Laravel.

7 new tests across `closure.test.ts`, `chain.test.ts`, `batch.test.ts` cover capability throws on a fake async-only adapter + `catch()` firing exactly once on multi-failure batches.
