import { ServiceProvider, type Application } from '@forge/core'

// ─── Listener Contract ─────────────────────────────────────

export interface Listener<T = unknown> {
  handle(event: T): void | Promise<void>
}

// ─── Event Dispatcher ──────────────────────────────────────

export class EventDispatcher {
  private readonly map = new Map<string, Listener<unknown>[]>()

  /** Register one or more listeners for an event class name */
  register(eventName: string, ...listeners: Listener<unknown>[]): void {
    const existing = this.map.get(eventName) ?? []
    this.map.set(eventName, [...existing, ...listeners])
  }

  /** Dispatch an event to all registered listeners (in order, awaited) */
  async dispatch<T extends object>(event: T): Promise<void> {
    const name      = event.constructor.name
    const listeners = this.map.get(name) ?? []
    for (const listener of listeners) {
      await listener.handle(event)
    }
  }

  /** Check how many listeners are registered for an event */
  count(eventName: string): number {
    return this.map.get(eventName)?.length ?? 0
  }
}

// ─── Global Dispatcher Singleton ───────────────────────────

export const dispatcher = new EventDispatcher()

/** Dispatch an event through the global dispatcher */
export function dispatch<T extends object>(event: T): Promise<void> {
  return dispatcher.dispatch(event)
}

// ─── Listen Map Type ───────────────────────────────────────

/** Maps event class names to arrays of Listener classes */
export type ListenMap = Record<string, (new () => Listener<never>)[]>

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns an EventServiceProvider class that registers the given listener map
 * into the global EventDispatcher on boot.
 *
 * Usage in bootstrap/providers.ts:
 *   import { events } from '@forge/events'
 *   import { UserRegistered } from '../app/Events/UserRegistered.js'
 *   import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
 *
 *   events({
 *     [UserRegistered.name]: [SendWelcomeEmailListener],
 *   })
 */
export function events(listen: ListenMap): new (app: Application) => ServiceProvider {
  class EventServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      let total = 0
      for (const [eventName, listenerClasses] of Object.entries(listen)) {
        const instances = listenerClasses.map((LC) => new LC()) as Listener<unknown>[]
        dispatcher.register(eventName, ...instances)
        total += listenerClasses.length
      }
      console.log(
        `[EventServiceProvider] booted — ${Object.keys(listen).length} events, ${total} listeners`,
      )
    }
  }

  return EventServiceProvider
}
