import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records mail sends by wrapping the MailRegistry adapter's send method.
 */
export class MailCollector implements Collector {
  readonly name = 'Mail Collector'
  readonly type = 'mail' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const mod = await import('@rudderjs/mail')
      const { MailRegistry } = mod

      const original = MailRegistry.get()
      if (!original) return

      const storage     = this.storage
      const originalSend = original.send.bind(original)

      // Patch the adapter's send method in place
      ;(original as unknown as Record<string, unknown>)['send'] = async function (
        mailable: unknown,
        options: unknown,
      ): Promise<void> {
        await (originalSend as (...args: unknown[]) => Promise<void>)(mailable, options)
        const m   = mailable as Record<string, unknown> & { constructor: { name: string } }
        const opt = options as Record<string, unknown>
        storage.store(createEntry('mail', {
          class:   m.constructor.name,
          to:      opt['to'] ?? [],
          subject: m['subject'] ?? '',
          queued:  false,
        }, { tags: [`mail:${m.constructor.name}`] }))
      }
    } catch {
      // @rudderjs/mail not installed — skip
    }
  }
}
