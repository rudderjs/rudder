import type { Job } from './index.js'
import { runJobMiddleware } from './job-middleware.js'
import { isUniqueJob, isUniqueUntilProcessing, releaseUniqueLock } from './unique.js'

// ─── Shared Job Execution ──────────────────────────────────
//
// Every driver (Sync, BullMQ, Inngest) routes through `executeJob` so the
// middleware pipeline, `ShouldBeUnique`/`ShouldBeUniqueUntilProcessing` lock
// release, `failed()` hook, and request-context hydration all fire on every
// adapter — historically those were enforced only on the sync driver.
//
// Drivers reconstruct the job instance from the wire payload themselves
// (using `decodePayload` to undo `encodePayload`'s tagging), then hand the
// fully-built instance here. Sync passes the original dispatched instance
// directly, which keeps closure-style jobs (`dispatch(fn)`, `Chain`, batch
// wrappers) working — their `handle` method is a closure that would not
// survive a JSON round-trip.
//
// The dispatch-side acquire (`acquireUniqueLock` in `DispatchBuilder.send`)
// pairs with the execute-side release here. For `ShouldBeUniqueUntilProcessing`
// the lock is released as soon as processing starts so a follow-up dispatch
// isn't blocked by an in-flight attempt; otherwise it's released in `finally`
// after the handler returns (success or failure).

export interface ExecuteJobContext {
  /** Serialized request-context payload (from `@rudderjs/context`). */
  __context?: Record<string, unknown> | undefined
  /**
   * Whether to invoke the job's `failed()` hook when `handle()` throws. Defaults
   * to `true` (the historical behavior for the sync/BullMQ/Inngest drivers, which
   * call `executeJob` once per attempt). Drivers that own retry scheduling
   * themselves — the native `database` driver — pass `false` so they can invoke
   * `failed()` exactly once, on terminal failure, after attempts are exhausted
   * (Laravel parity). The ShouldBeUnique lock release still fires regardless.
   */
  invokeFailedHook?: boolean
}

/**
 * Execute a fully-built job instance via the full pipeline: context hydration
 * → middleware → `handle()` → `failed()` hook on terminal failure → release
 * of the ShouldBeUnique dispatch lock.
 */
export async function executeJob<T extends Job>(
  instance: T,
  ctx:      ExecuteJobContext = {},
): Promise<void> {
  if (isUniqueJob(instance) && isUniqueUntilProcessing(instance)) {
    await releaseUniqueLock(instance)
  }

  let hadError = false
  let captured: unknown
  try {
    await _maybeWithContext(ctx.__context, async () => {
      const middlewares = instance.middleware?.() ?? []
      await runJobMiddleware(instance, middlewares, async () => {
        await instance.handle()
      })
    })
  } catch (err) {
    hadError = true
    captured = err
    // failed() is best-effort — if it throws, log + let the original error
    // propagate so observers see the real cause. Skipped when the driver opted
    // to own terminal-failure semantics (`invokeFailedHook: false`).
    if (ctx.invokeFailedHook !== false) {
      try { await instance.failed?.(err) }
      catch (hookErr) {
        console.error(
          `[RudderJS Queue] job.failed() hook threw for "${instance.constructor.name}":`,
          hookErr,
        )
      }
    }
  } finally {
    if (isUniqueJob(instance) && !isUniqueUntilProcessing(instance)) {
      await releaseUniqueLock(instance)
    }
  }
  if (hadError) throw captured
}

// ─── Optional @rudderjs/context wiring ─────────────────────

interface ContextModule {
  runWithContext: <T>(fn: () => T | Promise<T>) => Promise<T>
  Context: {
    hydrate(payload: { data: Record<string, unknown>; stacks: Record<string, unknown[]> }): void
  }
}

async function _maybeWithContext(
  __context: Record<string, unknown> | undefined,
  fn:        () => Promise<void>,
): Promise<void> {
  if (!__context) { await fn(); return }
  let mod: ContextModule
  try {
    const specifier = '@rudderjs/context'
    mod = await import(/* @vite-ignore */ specifier) as ContextModule
  } catch {
    // @rudderjs/context not installed — run without ALS hydration
    await fn()
    return
  }
  await mod.runWithContext(async () => {
    mod.Context.hydrate(__context as { data: Record<string, unknown>; stacks: Record<string, unknown[]> })
    await fn()
  })
}
