import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records scheduled task executions.
 *
 * Patches the schedule's task runner at boot time to add recording hooks.
 */
export class ScheduleCollector implements Collector {
  readonly name = 'Schedule Collector'
  readonly type = 'schedule' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/schedule')
      const sched = mod.schedule as unknown as {
        call: (fn: () => unknown, ...args: unknown[]) => ScheduledTask
      }

      const storage      = this.storage
      const originalCall = sched.call.bind(sched)

      sched.call = function (fn: () => unknown, ...args: unknown[]) {
        const task = originalCall(fn, ...args)
        const t = task as unknown as { getDescription?(): string; getCron?(): string }
        let start: number

        // Resolve lazily so .description()/.cron() chained AFTER schedule.call() are picked up
        const resolveMeta = (): { description: string; expression: string } => ({
          description: (t.getDescription?.() || fn.name || 'anonymous'),
          expression:  (t.getCron?.() ?? ''),
        })

        task.before(() => { start = Date.now() })
        task.onSuccess(() => {
          const { description, expression } = resolveMeta()
          storage.store(createEntry('schedule', {
            description,
            expression,
            status:   'success',
            duration: Date.now() - start,
          }, { tags: ['status:success', `task:${description}`] }))
        })
        task.onFailure((error: unknown) => {
          const { description, expression } = resolveMeta()
          storage.store(createEntry('schedule', {
            description,
            expression,
            status:    'failed',
            duration:  Date.now() - start,
            exception: error instanceof Error ? error.message : String(error),
          }, { tags: ['status:failed', `task:${description}`] }))
        })

        return task
      }
    } catch {
      // @rudderjs/schedule not installed — skip
    }
  }
}

interface ScheduledTask {
  before(fn: () => void): this
  onSuccess(fn: () => void): this
  onFailure(fn: (error: unknown) => void): this
}
