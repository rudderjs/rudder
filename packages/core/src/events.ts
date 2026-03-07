import type { Application } from './index.js'
import { ServiceProvider } from './service-provider.js'

// ─── Listener Contract ─────────────────────────────────────

export interface Listener<T = unknown> {
  handle(event: T): void | Promise<void>
}

// ─── Event Dispatcher ──────────────────────────────────────

export class EventDispatcher {
  private readonly map = new Map<string, Listener<unknown>[]>()

  /**
   * Register one or more listeners for an event class name.
   * Use `'*'` to listen to every dispatched event.
   */
  register(eventName: string, ...listeners: Listener<unknown>[]): void {
    const existing = this.map.get(eventName) ?? []
    this.map.set(eventName, [...existing, ...listeners])
  }

  /**
   * Dispatch an event to all matching listeners, then to wildcard (`'*'`) listeners.
   * Listeners are awaited in registration order.
   */
  async dispatch<T extends object>(event: T): Promise<void> {
    const name      = event.constructor.name
    const specific  = this.map.get(name) ?? []
    const wildcards = this.map.get('*')  ?? []
    for (const listener of [...specific, ...wildcards]) {
      await listener.handle(event)
    }
  }

  /** Number of listeners registered for a given event name (or `'*'`). */
  count(eventName: string): number {
    return this.map.get(eventName)?.length ?? 0
  }

  /** Returns true if at least one listener is registered for the event name. */
  hasListeners(eventName: string): boolean {
    return this.count(eventName) > 0
  }

  /**
   * Returns a snapshot of all registered event names and their listener counts.
   * Useful for `event:list` commands and introspection.
   */
  list(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [name, listeners] of this.map.entries()) {
      result[name] = listeners.length
    }
    return result
  }

  /** @internal — clears all listeners. Used for testing and hot-reload. */
  reset(): void {
    this.map.clear()
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
