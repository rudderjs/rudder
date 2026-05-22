---
"@rudderjs/queue-inngest": minor
"@rudderjs/queue-bullmq": patch
"@rudderjs/queue": patch
---

Inngest context propagation + BullMQ lifecycle hygiene + queue CLI lazy adapter (Phase 4 of the 2026-05-22 eventing/realtime plan):

**`@rudderjs/queue-inngest`**

- **P0 — `__context` now round-trips through the Inngest transport.** `dispatch()` embeds the serialized `DispatchOptions.__context` on `event.data`; the function body extracts it and forwards to `executeJob({ __context })`. Apps using `@rudderjs/context` (tenant / user / locale ALS) that switched driver from BullMQ → Inngest were silently dropping context on every job, opening a wrong-tenant-DB-write risk. The wire format now matches BullMQ, so cross-driver migrations are safe.
- **P1 — `Job.retries` validated and clamped to `[0, 20]` with a `console.warn`.** Inngest accepts only integers in that range. The previous `as 0|1|…|20` cast accepted any number at compile-time and crashed at registration with a confusing error. Out-of-range values now warn at boot and clamp to the nearest valid value — surfacing the misuse instead of breaking the boot.
- Minor bump because `__context` now propagates where it previously did not — apps relying on the broken state would observe a *correct* tenant being attached to jobs after upgrade.

**`@rudderjs/queue-bullmq`**

- **P1 — Worker shutdown is now properly awaited.** `disconnect()` closes workers (via `Promise.allSettled`) **before** queues, then closes queues, logging any rejections without swallowing them. Previously `Promise.all([...queues].map(q => q.close()))` ignored workers entirely — workers kept polling BRPOP through the SIGTERM grace period and k8s rolling restart pods outlived their window. Closing workers before queues also avoids a "Connection is closed" race during worker BRPOP-in-flight.
- **P1 — `SIGTERM` / `SIGINT` listeners no longer leak.** They're registered once per adapter (on the first `work()` call) and removed in `disconnect()`. Multi-tenant boot or test re-runs no longer accumulate handlers; `process.off` matches the listener because the closure is bound on the adapter instance.
- **P1 — BullMQ no longer double-fires `instance.failed()` per attempt.** The worker `'failed'` event listener previously called `await instance.failed?.(error)` separately, on top of `executeJob`'s `failed()` invocation (Phase 1). The duplicate call is removed; the listener now owns observer emission + the console log only. The unhandled-rejection risk from the async listener body is gone for the same reason — there's no longer an awaited hook in the listener that could throw into an EventEmitter.
- `work()` now exposes the underlying `workers: Worker[]` on the adapter (read-only by convention) so callers and tests can introspect lifecycle state.

**`@rudderjs/queue`**

- **P1 — `QueueServiceProvider`'s 5 CLI commands (`queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry`) now resolve the adapter via `QueueRegistry.get()` at invocation time** instead of closing over the value captured at boot. Under Vite SSR re-eval (the documented `bootstrap/` / `app/` reload path) the `rudder.command()` dedup replaces the stale closure with a fresh one — and now the fresh closure always acts on the latest registered adapter. Tests that swap the adapter via `QueueRegistry.set(...)` between bootings work end-to-end with no boot re-run.

No public API additions in this PR; all changes are bug fixes + internal lifecycle hardening.
