import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records dispatched events by registering a wildcard ('*') listener.
 */
export class EventCollector implements Collector {
  readonly name = 'Event Collector'
  readonly type = 'event' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { dispatcher } = await import('@rudderjs/core') as {
        dispatcher: {
          register: (eventName: string, ...listeners: { handle: (event: unknown) => void }[]) => void
        }
      }

      dispatcher.register('*', {
        handle: (event: unknown) => this.record(event),
      })
    } catch {
      // @rudderjs/core events not available — skip
    }
  }

  private record(event: unknown): void {
    const name = event && typeof event === 'object' ? event.constructor.name : 'Unknown'

    // Don't record Telescope's own internal events
    if (name.startsWith('Telescope')) return

    this.storage.store(createEntry('event', {
      name,
      payload: event && typeof event === 'object'
        ? JSON.parse(JSON.stringify(event))
        : { value: event },
    }, { tags: [`event:${name}`] }))
  }
}
