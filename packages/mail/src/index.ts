import { ServiceProvider, config } from '@rudderjs/core'
import { Mailable } from './mailable.js'
import type { MailMessage } from './mailable.js'
import { isNodemailerConfig, nodemailer } from './nodemailer-adapter.js'

export { Mailable } from './mailable.js'
export type { MailMessage } from './mailable.js'

// ─── Adapter Contract ──────────────────────────────────────

export interface SendOptions {
  to:   string[]
  from: { address: string; name?: string }
  cc?:  string[]
  bcc?: string[]
}

export interface MailAdapter {
  send(mailable: Mailable, options: SendOptions): Promise<void>
}

export interface MailAdapterProvider {
  create(): MailAdapter
}

// ─── Mail Registry ─────────────────────────────────────────

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/mail` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/mail` inline (`Mail.to(...).send()`
 * reads `MailRegistry`), but driver packages (`nodemailer`-backed adapters and
 * future SMTP/SES drivers) and `MailProvider.boot()` itself are externalized
 * via the provider auto-discovery manifest. Without a shared store, `set()`
 * from the externalized copy would land on a different class than the one
 * `Mail.*` reads from inside the bundle, producing a misleading
 * `No mail adapter registered` error on every send in prod. Same pattern as
 * PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`),
 * PR #501 (`@rudderjs/cache`), and PR #502 (`@rudderjs/queue`).
 */
const DEFAULT_FROM: { address: string; name?: string } = { address: 'noreply@example.com' }

interface MailRegistryStore {
  adapter: MailAdapter | null
  from:    { address: string; name?: string }
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_mail_registry__']) {
  _g['__rudderjs_mail_registry__'] = {
    adapter: null,
    from:    { ...DEFAULT_FROM },
  } satisfies MailRegistryStore
}
const _store = _g['__rudderjs_mail_registry__'] as MailRegistryStore

export class MailRegistry {
  static set(adapter: MailAdapter): void  { _store.adapter = adapter }
  static get(): MailAdapter | null        { return _store.adapter }
  static setFrom(from: { address: string; name?: string }): void { _store.from = { ...from } }
  static getFrom(): { address: string; name?: string }           { return { ..._store.from } }

  /** @internal — clears the registered adapter and resets from. Used for testing. */
  static reset(): void {
    _store.adapter = null
    _store.from    = { ...DEFAULT_FROM }
  }
}

// ─── Pending Send (fluent builder) ─────────────────────────

/**
 * Fluent builder returned by `Mail.to(...)`. Configure the recipient lists
 * and queue, then terminate with `.send()`, `.queue()`, or `.later()`.
 *
 * **Builder contract:**
 * - `cc()` / `bcc()` **replace** the previous list — they do NOT accumulate.
 *   Pass all addresses in one call: `.cc('a@x', 'b@x')`, not two separate
 *   `.cc('a@x').cc('b@x')`.
 * - `onQueue()` is only honored by `.queue()` and `.later()`; ignored by `.send()`.
 * - Call order between `cc`/`bcc`/`onQueue` doesn't matter, but `send`/
 *   `queue`/`later` must be last — they execute the operation and return a
 *   `Promise<void>`, not the builder.
 */
export class MailPendingSend {
  private _cc:    string[] = []
  private _bcc:   string[] = []
  private _queue?: string

  constructor(private readonly _to: string[]) {}

  /** Set the CC list. **Replaces** the previous list — pass all addresses in one call. */
  cc(...addresses: string[]):  this { this._cc  = addresses; return this }
  /** Set the BCC list. **Replaces** the previous list — pass all addresses in one call. */
  bcc(...addresses: string[]): this { this._bcc = addresses; return this }

  /** Specify which queue to use for queued mail. Honored by `queue()`/`later()`; ignored by `send()`. */
  onQueue(name: string): this { this._queue = name; return this }

  async send(mailable: Mailable): Promise<void> {
    const adapter = MailRegistry.get()
    if (!adapter) throw new Error('[RudderJS Mail] No mail adapter registered. Add mail() to providers.')
    const from = MailRegistry.getFrom()
    await adapter.send(mailable, { to: this._to, from, cc: this._cc, bcc: this._bcc })
  }

  /** Queue the mailable for background sending. Requires `@rudderjs/queue`. */
  async queue(mailable: Mailable): Promise<void> {
    const { dispatchMailJob } = await import('./queued.js')
    const from = MailRegistry.getFrom()
    const opts: { queue?: string; delay?: number } = {}
    if (this._queue) opts.queue = this._queue
    await dispatchMailJob(mailable, { to: this._to, from, cc: this._cc, bcc: this._bcc }, opts)
  }

  /** Queue the mailable to be sent after a delay (ms). Requires `@rudderjs/queue`. */
  async later(delay: number, mailable: Mailable): Promise<void> {
    const { dispatchMailJob } = await import('./queued.js')
    const from = MailRegistry.getFrom()
    const opts: { queue?: string; delay?: number } = { delay }
    if (this._queue) opts.queue = this._queue
    await dispatchMailJob(mailable, { to: this._to, from, cc: this._cc, bcc: this._bcc }, opts)
  }
}

// ─── Mail Facade ───────────────────────────────────────────

export class Mail {
  static to(...addresses: string[]): MailPendingSend {
    return new MailPendingSend(addresses)
  }

  /** Replace the mail adapter with a fake for testing. */
  static fake(): import('./fake.js').FakeMailAdapter {
    // Dynamic require to avoid circular top-level import (fake.ts imports from index.ts)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FakeMailAdapter } = require('./fake.js') as typeof import('./fake.js')
    return FakeMailAdapter.fake()
  }
}

// ─── Mail Config ───────────────────────────────────────────

export interface MailConnectionConfig {
  driver: string
  [key: string]: unknown
}

export interface MailConfig {
  /** The default mailer connection name */
  default: string
  /** From address used on all outgoing mail */
  from: { address: string; name?: string }
  /** Named mailer connections */
  mailers: Record<string, MailConnectionConfig>
}

// ─── Built-in Log Adapter ──────────────────────────────────

export class LogAdapter implements MailAdapter {
  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    const msg  = await mailable.compile()
    const line = '─'.repeat(50)
    console.log(`\n[RudderJS Mail] ${line}`)
    console.log(`[RudderJS Mail]  To:      ${options.to.join(', ')}`)
    console.log(`[RudderJS Mail]  From:    ${options.from.name ? `${options.from.name} <${options.from.address}>` : options.from.address}`)
    console.log(`[RudderJS Mail]  Subject: ${msg.subject}`)
    if (msg.html) console.log(`[RudderJS Mail]  HTML:    ${msg.html.replace(/<[^>]+>/g, '').trim().slice(0, 120)}`)
    if (msg.text) console.log(`[RudderJS Mail]  Text:    ${msg.text.trim().slice(0, 120)}`)
    console.log(`[RudderJS Mail] ${line}\n`)
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a MailServiceProvider class configured for the given mail config.
 *
 * Built-in drivers:  log (prints to console — great for dev), smtp (Nodemailer)
 *
 * Usage in bootstrap/providers.ts:
 *   import { mail } from '@rudderjs/mail'
 *   import configs from '../config/index.js'
 *   export default [..., mail(configs.mail), ...]
 */
export class MailProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg          = config<MailConfig>('mail')
    const mailerName   = cfg.default
    const mailerConfig = cfg.mailers[mailerName] ?? { driver: 'log' }
    const driver       = mailerConfig['driver'] as string

    MailRegistry.setFrom(cfg.from)

    let adapter: MailAdapter

    if (driver === 'log') {
      adapter = new LogAdapter()
    } else if (driver === 'smtp') {
      if (!isNodemailerConfig(mailerConfig)) {
        throw new Error('[RudderJS Mail] Invalid SMTP config. Expected fields: host (string), port (number).')
      }
      adapter = nodemailer(mailerConfig, cfg.from).create()
    } else if (driver === 'failover') {
      const mailerNames = (mailerConfig['mailers'] as string[] | undefined) ?? []
      const retryAfter  = (mailerConfig['retryAfter'] as number | undefined) ?? 60
      const adapters: MailAdapter[] = []
      for (const name of mailerNames) {
        const mc = cfg.mailers[name]
        if (!mc) continue
        if (mc.driver === 'log') {
          adapters.push(new LogAdapter())
        } else if (mc.driver === 'smtp' && isNodemailerConfig(mc)) {
          adapters.push(nodemailer(mc, cfg.from).create())
        }
      }
      if (adapters.length === 0) throw new Error('[RudderJS Mail] Failover driver has no valid mailers configured.')
      const { FailoverAdapter } = await import('./failover.js')
      adapter = new FailoverAdapter(adapters, retryAfter)
    } else {
      throw new Error(`[RudderJS Mail] Unknown driver "${driver}". Available: log, smtp, failover`)
    }

    MailRegistry.set(adapter)
    this.app.instance('mail', adapter)
  }
}

// ─── Re-exports ────────────────────────────────────────────

export { FailoverAdapter }            from './failover.js'
export { MarkdownMailable }           from './markdown.js'
export { mailPreview }                from './preview.js'
export { FakeMailAdapter }            from './fake.js'
export { nodemailer, isNodemailerConfig } from './nodemailer-adapter.js'
export type { NodemailerConfig }      from './nodemailer-adapter.js'
