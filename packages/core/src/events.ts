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

  /**
   * Returns a snapshot of registered events with each listener's class name
   * (or `<anonymous>` for ad-hoc handlers without a named constructor).
   * Used by the `event:list` command for full introspection output.
   */
  inspect(): { event: string; listeners: string[] }[] {
    const result: { event: string; listeners: string[] }[] = []
    for (const [event, listeners] of this.map.entries()) {
      const names = listeners.map(l => {
        const ctor = (l as { constructor?: { name?: string } }).constructor
        const name = ctor?.name
        return name && name !== 'Object' ? name : '<anonymous>'
      })
      result.push({ event, listeners: names })
    }
    return result
  }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  reset(): void {
    this.map.clear()
  }
}

// ─── Global Dispatcher Singleton ───────────────────────────
//
// Routed through `globalThis` so duplicate `@rudderjs/core` bundles share one
// dispatcher. `dispatch()` is re-exported from several packages
// (`@rudderjs/cashier-paddle`, `@rudderjs/queue` docs, etc.); a module-scope
// `new EventDispatcher()` would split into independent instances under bundle
// boundaries → listeners registered via `eventsProvider({...})` in user
// `bootstrap/providers.ts` (entry.mjs bundle) silently invisible when a
// node_modules-resolved framework package fires the event. Same pattern as
// `groupMiddlewareStore` and the static-state-singleton audit.

const DISPATCHER_KEY = '__rudderjs_core_dispatcher__'
const _dispatcherGlobal = globalThis as Record<string, unknown>
export const dispatcher: EventDispatcher = (_dispatcherGlobal[DISPATCHER_KEY] as EventDispatcher | undefined)
  ?? (() => { const d = new EventDispatcher(); _dispatcherGlobal[DISPATCHER_KEY] = d; return d })()

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
export function eventsProvider(listen: ListenMap): new (app: Application) => ServiceProvider {
  class EventServiceProvider extends ServiceProvider {
    register(): void {}

    boot(): void {
      for (const [eventName, listenerClasses] of Object.entries(listen)) {
        const instances = listenerClasses.map((LC) => new LC()) as Listener<unknown>[]
        dispatcher.register(eventName, ...instances)
      }
    }
  }

  return EventServiceProvider
}
