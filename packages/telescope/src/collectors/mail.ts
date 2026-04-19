import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

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
        const opt = (options ?? {}) as {
          to?:   string[]
          from?: { address: string; name?: string }
          cc?:   string[]
          bcc?:  string[]
        }
        // Adapter has already called mailable.compile() which sets these private
        // fields — read them directly to avoid re-running build()
        const subject = (m['_subject'] as string | undefined) ?? ''
        const htmlBody = m['_html'] as string | undefined
        const textBody = m['_text'] as string | undefined
        const from = opt.from
          ? (opt.from.name ? `${opt.from.name} <${opt.from.address}>` : opt.from.address)
          : null
        storage.store(createEntry('mail', {
          class:   m.constructor.name,
          to:      opt.to ?? [],
          from,
          ...(opt.cc  && opt.cc.length  ? { cc:  opt.cc  } : undefined),
          ...(opt.bcc && opt.bcc.length ? { bcc: opt.bcc } : undefined),
          subject,
          ...(htmlBody !== undefined ? { html: htmlBody } : undefined),
          ...(textBody !== undefined ? { text: textBody } : undefined),
          queued:  false,
        }, { tags: [`mail:${m.constructor.name}`], ...batchOpts() }))
      }
    } catch {
      // @rudderjs/mail not installed — skip
    }
  }
}
