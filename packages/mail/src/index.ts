import { ServiceProvider, type Application } from '@boostkit/core'
import { resolveOptionalPeer } from '@boostkit/core'

// ─── Mail Message ──────────────────────────────────────────

export interface MailMessage {
  subject: string
  html?:   string
  text?:   string
}

// ─── Mailable ──────────────────────────────────────────────

export abstract class Mailable {
  private _subject = ''
  private _html?: string
  private _text?: string

  /** Set the email subject */
  protected subject(subject: string): this { this._subject = subject; return this }

  /** Set the HTML body */
  protected html(html: string): this { this._html = html; return this }

  /** Set the plain-text body */
  protected text(text: string): this { this._text = text; return this }

  /** Build the mailable — called before sending. Override to set subject/html/text. */
  abstract build(): this | Promise<this>

  /** Called by the adapter — builds then returns the compiled message */
  async compile(): Promise<MailMessage> {
    await this.build()
    const msg: MailMessage = { subject: this._subject }
    if (this._html !== undefined) msg.html = this._html
    if (this._text !== undefined) msg.text = this._text
    return msg
  }
}

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

export class MailPendingSend {
  private _cc:  string[] = []
  private _bcc: string[] = []

  constructor(private readonly _to: string[]) {}

  cc(...addresses: string[]):  this { this._cc  = addresses; return this }
  bcc(...addresses: string[]): this { this._bcc = addresses; return this }

  async send(mailable: Mailable): Promise<void> {
    const adapter = MailRegistry.get()
    if (!adapter) throw new Error('[BoostKit Mail] No mail adapter registered. Add mail() to providers.')
    const from = MailRegistry.getFrom()
    await adapter.send(mailable, { to: this._to, from, cc: this._cc, bcc: this._bcc })
  }
}

// ─── Mail Facade ───────────────────────────────────────────

export class Mail {
  static to(...addresses: string[]): MailPendingSend {
    return new MailPendingSend(addresses)
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
    console.log(`\n[BoostKit Mail] ${line}`)
    console.log(`[BoostKit Mail]  To:      ${options.to.join(', ')}`)
    console.log(`[BoostKit Mail]  From:    ${options.from.name ? `${options.from.name} <${options.from.address}>` : options.from.address}`)
    console.log(`[BoostKit Mail]  Subject: ${msg.subject}`)
    if (msg.html) console.log(`[BoostKit Mail]  HTML:    ${msg.html.replace(/<[^>]+>/g, '').trim().slice(0, 120)}`)
    if (msg.text) console.log(`[BoostKit Mail]  Text:    ${msg.text.trim().slice(0, 120)}`)
    console.log(`[BoostKit Mail] ${line}\n`)
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
          throw new Error('[BoostKit Mail] SMTP driver requires "nodemailer". Install it with: pnpm add nodemailer')
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
 *   import { mail } from '@boostkit/mail'
 *   import configs from '../config/index.js'
 *   export default [..., mail(configs.mail), ...]
 */
export function mail(config: MailConfig): new (app: Application) => ServiceProvider {
  class MailServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      const mailerName   = config.default
      const mailerConfig = config.mailers[mailerName] ?? { driver: 'log' }
      const driver       = mailerConfig['driver'] as string

      MailRegistry.setFrom(config.from)

      let adapter: MailAdapter

      if (driver === 'log') {
        adapter = new LogAdapter()
      } else if (driver === 'smtp') {
        if (!isNodemailerConfig(mailerConfig)) {
          throw new Error('[BoostKit Mail] Invalid SMTP config. Expected fields: host (string), port (number).')
        }
        adapter = nodemailer(mailerConfig, config.from).create()
      } else {
        throw new Error(`[BoostKit Mail] Unknown driver "${driver}". Available: log, smtp`)
      }

      MailRegistry.set(adapter)
      this.app.instance('mail', adapter)
    }
  }

  return MailServiceProvider
}
