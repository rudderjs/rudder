import type { Mailable } from './mailable.js'
import type { SendOptions } from './index.js'
import { MailRegistry } from './index.js'

// ─── Queued Mail ────────────────────────────────────────────

interface QueueLike {
  get(): { dispatch(job: unknown, opts?: unknown): Promise<void> } | null
}

/**
 * @internal — dispatches a mailable through the queue system.
 * Dynamically requires @rudderjs/queue to avoid hard dependency.
 */
export async function dispatchMailJob(
  mailable: Mailable,
  options: SendOptions,
  queueOptions?: { queue?: string; delay?: number },
): Promise<void> {
  // When a mail fake is active, record the queued mailable instead of
  // dispatching a real job. Duck-typed on `recordQueued` to avoid importing
  // FakeMailAdapter into this hot path. This is what makes `Mail.to(...).queue()`
  // / `.later()` visible to `fake.assertQueued()` — and it must run before
  // resolving @rudderjs/queue so faked tests never need the queue package.
  const active = MailRegistry.get() as { recordQueued?: (m: Mailable, o: SendOptions) => void } | null
  if (active && typeof active.recordQueued === 'function') {
    active.recordQueued(mailable, options)
    return
  }

  let QueueRegistry: QueueLike

  try {
    // Use dynamic import (not `require`) — `@rudderjs/queue` is an ESM-only
    // package and its `exports` field lacks a `require` condition, so a
    // synchronous require always throws "No exports main defined" even when
    // the package is installed. Memory: `feedback_esm_only_peer_resolution`.
    const mod = await import(/* @vite-ignore */ '@rudderjs/queue') as { QueueRegistry: QueueLike }
    QueueRegistry = mod.QueueRegistry
  } catch {
    throw new Error(
      '[RudderJS Mail] Queued mail requires @rudderjs/queue. Install it with: pnpm add @rudderjs/queue'
    )
  }

  const adapter = QueueRegistry.get()
  if (!adapter) {
    throw new Error('[RudderJS Mail] No queue adapter registered. Add queue() to providers.')
  }

  const job = {
    handle: async () => {
      const mailAdapter = MailRegistry.get()
      if (!mailAdapter) {
        throw new Error('[RudderJS Mail] No mail adapter registered. Add mail() to providers.')
      }
      await mailAdapter.send(mailable, options)
    },
  }

  const opts: Record<string, unknown> = {}
  if (queueOptions?.queue) opts['queue'] = queueOptions.queue
  if (queueOptions?.delay) opts['delay'] = queueOptions.delay

  await adapter.dispatch(job, opts)
}
