import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records notification dispatches by wrapping the ChannelRegistry's get method.
 */
export class NotificationCollector implements Collector {
  readonly name = 'Notification Collector'
  readonly type = 'notification' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/notification')
      const registry = mod.ChannelRegistry as unknown as {
        get: (name: string) => NotificationChannel | undefined
      }

      const storage     = this.storage
      const originalGet = registry.get.bind(registry)

      registry.get = (name: string): NotificationChannel | undefined => {
        const original = originalGet(name)
        if (!original) return original

        return {
          async send(notifiable: unknown, notification: unknown): Promise<void> {
            await (original.send as (n: unknown, notif: unknown) => Promise<void>)(notifiable, notification)
            const notif = notification as Record<string, unknown> & { constructor: { name: string } }
            const n     = notifiable as Record<string, unknown>
            storage.store(createEntry('notification', {
              class:      notif.constructor.name,
              channel:    name,
              notifiable: n['id'] ?? (notifiable as { constructor: { name: string } }).constructor.name,
            }, { tags: [`notification:${notif.constructor.name}`, `channel:${name}`], ...batchOpts() }))
          },
        } as NotificationChannel
      }
    } catch {
      // @rudderjs/notification not installed — skip
    }
  }
}

interface NotificationChannel {
  send(notifiable: unknown, notification: unknown): Promise<void>
}
