import { ServiceProvider, config } from '@rudderjs/core'
import { resolveOptionalPeer } from '@rudderjs/core'
import { Mailable } from './mailable.js'
import type { MailMessage } from './mailable.js'

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

export class MailRegistry {
  private static adapter: MailAdapter | null = null
  private static _from: { address: string; name?: string } = { address: 'noreply@example.com' }

  static set(adapter: MailAdapter): void  { this.adapter = adapter }
  static get(): MailAdapter | null        { return this.adapter }
  static setFrom(from: { address: string; name?: string }): void { this._from = { ...from } }
  static getFrom(): { address: string; name?: string }           { return { ...this._from } }

  /** @internal — clears the registered adapter and resets from. Used for testing. */
  static reset(): void {
    this.adapter = null
    this._from   = { address: 'noreply@example.com' }
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

export interface NodemailerConfig {
  driver:      'smtp'
  host:        string
  port:        number
  username?:   string
  password?:   string
  encryption?: 'tls' | 'ssl' | 'none'
}

interface NodemailerTransporter {
  sendMail(message: {
    from: string
    to: string
    cc?: string
    bcc?: string
    subject: string
    html?: string
    text?: string
  }): Promise<unknown>
}

interface NodemailerModule {
  createTransport(config: {
    host: string
    port: number
    secure: boolean
    auth?: { user: string; pass: string }
  }): NodemailerTransporter
}

function isNodemailerConfig(config: MailConnectionConfig): config is MailConnectionConfig & NodemailerConfig {
  return (
    config.driver === 'smtp' &&
    typeof config.host === 'string' &&
    typeof config.port === 'number'
  )
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

class NodemailerAdapter implements MailAdapter {
  private _transporter: Promise<NodemailerTransporter> | null = null

  constructor(
    private readonly config: NodemailerConfig,
    private readonly from: { address: string; name?: string },
  ) {}

  private async transporter(): Promise<NodemailerTransporter> {
    if (!this._transporter) {
      this._transporter = (async () => {
        let nodemailer: NodemailerModule
        try {
          nodemailer = await resolveOptionalPeer<NodemailerModule>('nodemailer')
        } catch {
          throw new Error('[RudderJS Mail] SMTP driver requires "nodemailer". Install it with: pnpm add nodemailer')
        }

        const secure = this.config.encryption === 'ssl'
        const transportConfig: {
          host: string
          port: number
          secure: boolean
          auth?: { user: string; pass: string }
        } = {
          host: this.config.host,
          port: this.config.port,
          secure,
        }

        if (this.config.username) {
          transportConfig.auth = { user: this.config.username, pass: this.config.password ?? '' }
        }

        return nodemailer.createTransport(transportConfig)
      })()
    }

    return this._transporter
  }

  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    const msg = await mailable.compile()
    const fromStr = this.from.name
      ? `${this.from.name} <${this.from.address}>`
      : this.from.address

    const transporter = await this.transporter()
    const message: {
      from: string
      to: string
      cc?: string
      bcc?: string
      subject: string
      html?: string
      text?: string
    } = {
      from: fromStr,
      to: options.to.join(', '),
      subject: msg.subject,
    }

    if (options.cc && options.cc.length) message.cc = options.cc.join(', ')
    if (options.bcc && options.bcc.length) message.bcc = options.bcc.join(', ')
    if (msg.html !== undefined) message.html = msg.html
    if (msg.text !== undefined) message.text = msg.text

    await transporter.sendMail(message)
  }
}

export function nodemailer(
  config: NodemailerConfig,
  from: { address: string; name?: string },
): MailAdapterProvider {
  return {
    create(): MailAdapter {
      return new NodemailerAdapter(config, from)
    },
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

export { FailoverAdapter }    from './failover.js'
export { MarkdownMailable }   from './markdown.js'
export { mailPreview }        from './preview.js'
export { FakeMailAdapter }    from './fake.js'
