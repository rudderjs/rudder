import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

interface DumpEvent {
  args:    unknown[]
  method:  'dump' | 'dd'
  caller?: string
}

/**
 * Records `dump()` and `dd()` calls by subscribing to the
 * `dumpObservers` registry exported from `@rudderjs/support/dump-observers`.
 * Each invocation becomes a `dump` entry in telescope.
 *
 * `dd()` entries are tagged `fatal` since `dd` terminates the process.
 */
export class DumpCollector implements Collector {
  readonly name = 'Dump Collector'
  readonly type = 'dump' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { dumpObservers } = await import('@rudderjs/support/dump-observers') as {
        dumpObservers: { subscribe: (fn: (e: DumpEvent) => void) => void }
      }
      dumpObservers.subscribe((event) => this.record(event))
    } catch {
      // @rudderjs/support/dump-observers not available — skip
    }
  }

  private record(event: DumpEvent): void {
    const tags: string[] = [`method:${event.method}`]
    if (event.method === 'dd') tags.push('fatal')

    this.storage.store(createEntry('dump', {
      args:   event.args,
      method: event.method,
      caller: event.caller,
      count:  event.args.length,
    }, { tags }))
  }
}
