---
"@rudderjs/queue": minor
"@rudderjs/queue-bullmq": minor
"@rudderjs/queue-inngest": minor
---

Drivers must enforce middleware + `failed()` + `ShouldBeUnique` (Phase 1 of the 2026-05-22 eventing/realtime plan):

Until now, `@rudderjs/queue` exported `runJobMiddleware`, `acquireUniqueLock`, and the `failed()` hook contract — but **none of the shipped drivers invoked them**. A user who shipped `middleware() { return [new RateLimited(...)] }` got zero rate-limiting in prod; a user with `implements ShouldBeUnique` dispatched duplicates on every concurrent call; an Inngest job that threw never saw its `failed()` hook fire. This phase centralises execution so every driver routes through the same pipeline.

- **New `executeJob(instance, ctx)` helper.** Single source of truth for "run a built job through the full pipeline" — context hydration (`@rudderjs/context`) → middleware → `handle()` → `failed()` hook on terminal failure → release of the `ShouldBeUnique` dispatch lock. Exported from `@rudderjs/queue`.
- **`runJobMiddleware` gains an optional `handler` argument.** Backwards-compatible (defaults to `() => job.handle()`); `executeJob` uses it to catch from inside the pipeline so `failed()` fires even when middleware throws.
- **`DispatchBuilder.send()` now acquires the `ShouldBeUnique` lock at dispatch time.** Mirrors Laravel: if `acquireUniqueLock` returns `false` (another dispatcher already won the atomic claim from Phase 3), the dispatch is silently skipped. `executeJob` releases the lock when the worker side finishes — or right before `handle()` runs for `ShouldBeUniqueUntilProcessing`.
- **`SyncAdapter` routes through `executeJob`** — passes the original instance directly so closure-style jobs (`dispatch(fn)`, `Chain`, batch wrappers) keep their `handle` closure intact (it would not survive a JSON round-trip on async drivers; that's a separate Phase 2 fix).
- **`queue-bullmq` processor routes through `executeJob`** — reconstructs the instance with `decodePayload` + `Object.assign`, then `executeJob(instance, { __context })`. Drops the inline context-hydration block; `executeJob` handles it.
- **`queue-inngest` function body routes through `executeJob`** — Inngest gains the `failed()` hook, middleware, and unique-lock release it has never had.

**Behaviour change to call out:** on `queue-bullmq` and `queue-inngest`, `failed()` now fires on every catch from the worker side, not only on terminal retry exhaustion. Closer to the Laravel semantic but worth noting for apps whose `failed()` does irreversible cleanup. Retry-aware `failed()` is a follow-up.
