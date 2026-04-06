import type { Job, DispatchOptions } from './index.js'
import { QueueRegistry } from './index.js'

// ─── Queued Closures ────────────────────────────────────────

/**
 * Dispatch an inline async function onto the queue.
 * Useful for quick one-off background tasks without defining a full Job class.
 *
 * @example
 * import { dispatch } from '@rudderjs/queue'
 *
 * await dispatch(async () => {
 *   await sendWelcomeEmail(user.email)
 * })
 *
 * // With options
 * await dispatch(async () => { ... }, { queue: 'mail', delay: 5000 })
 */
export async function dispatch(
  fn: () => void | Promise<void>,
  options?: DispatchOptions,
): Promise<void> {
  const adapter = QueueRegistry.get()
  if (!adapter) throw new Error('[RudderJS Queue] No queue adapter registered')

  const job: Job = {
    handle: fn,
  } as Job

  await adapter.dispatch(job, options)
}
