import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

interface GateEvent {
  ability:     string
  userId:      string | null
  allowed:     boolean
  resolvedVia: 'ability' | 'policy' | 'before' | 'default'
  policy?:     string
  model?:      string
  args?:       unknown[]
  duration:    number
}

/**
 * Records authorization decisions by subscribing to the
 * `gateObservers` registry exported from `@rudderjs/auth/gate-observers`.
 * Every `Gate.allows()`, `Gate.denies()`, and `Gate.authorize()` call
 * becomes a `gate` entry in telescope.
 *
 * If `@rudderjs/auth` is not installed, the collector silently skips.
 */
export class GateCollector implements Collector {
  readonly name = 'Gate Collector'
  readonly type = 'gate' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { gateObservers } = await import('@rudderjs/auth/gate-observers') as {
        gateObservers: { subscribe: (fn: (e: GateEvent) => void) => void }
      }
      gateObservers.subscribe((event) => this.record(event))
    } catch {
      // @rudderjs/auth not installed — skip
    }
  }

  private record(event: GateEvent): void {
    const tags: string[] = [
      event.allowed ? 'allowed' : 'denied',
      `via:${event.resolvedVia}`,
    ]
    if (event.policy) tags.push(`policy:${event.policy}`)
    if (event.model)  tags.push(`model:${event.model}`)
    if (event.duration > 50) tags.push('slow')

    this.storage.store(createEntry('gate', {
      ability:     event.ability,
      userId:      event.userId,
      allowed:     event.allowed,
      resolvedVia: event.resolvedVia,
      policy:      event.policy,
      model:       event.model,
      args:        event.args,
      duration:    event.duration,
    }, { tags, ...batchOpts() }))
  }
}
