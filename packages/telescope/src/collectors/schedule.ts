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
        const desc = (task as unknown as Record<string, unknown>)['description'] ?? fn.name ?? 'anonymous'
        let start: number

        task.before(() => { start = Date.now() })
        task.onSuccess(() => {
          storage.store(createEntry('schedule', {
            description: desc,
            expression:  (task as unknown as Record<string, unknown>)['expression'] ?? '',
            status:      'success',
            duration:    Date.now() - start,
          }, { tags: ['status:success'] }))
        })
        task.onFailure((error: unknown) => {
          storage.store(createEntry('schedule', {
            description: desc,
            expression:  (task as unknown as Record<string, unknown>)['expression'] ?? '',
            status:      'failed',
            duration:    Date.now() - start,
            exception:   error instanceof Error ? error.message : String(error),
          }, { tags: ['status:failed'] }))
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
