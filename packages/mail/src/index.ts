import { ServiceProvider, type Application } from '@forge/core'
import { resolveOptionalPeer } from '@forge/core'

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
    if (!adapter) throw new Error('[Forge Mail] No mail adapter registered. Add mail() to providers.')
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

// ─── Built-in Log Adapter ──────────────────────────────────

class LogAdapter implements MailAdapter {
  constructor(private readonly from: { address: string; name?: string }) {}

  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    const msg  = await mailable.compile()
    const line = '─'.repeat(50)
    console.log(`\n[Forge Mail] ${line}`)
    console.log(`[Forge Mail]  To:      ${options.to.join(', ')}`)
    console.log(`[Forge Mail]  From:    ${options.from.name ? `${options.from.name} <${options.from.address}>` : options.from.address}`)
    console.log(`[Forge Mail]  Subject: ${msg.subject}`)
    if (msg.html) console.log(`[Forge Mail]  HTML:    ${msg.html.replace(/<[^>]+>/g, '').trim().slice(0, 120)}`)
    if (msg.text) console.log(`[Forge Mail]  Text:    ${msg.text.trim().slice(0, 120)}`)
    console.log(`[Forge Mail] ${line}\n`)
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a MailServiceProvider class configured for the given mail config.
 *
 * Built-in drivers:  log (prints to console — great for dev)
 * Plugin drivers:    smtp (@forge/mail-nodemailer), resend, mailgun …
 *
 * Usage in bootstrap/providers.ts:
 *   import { mail } from '@forge/mail'
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
        adapter = new LogAdapter(config.from)
      } else if (driver === 'smtp') {
        const { nodemailer } = await resolveOptionalPeer<any>('@forge/mail-nodemailer')
        adapter = (nodemailer as (c: unknown, from: unknown) => MailAdapterProvider)(
          mailerConfig, config.from,
        ).create()
      } else {
        throw new Error(`[Forge Mail] Unknown driver "${driver}". Available: log, smtp`)
      }

      MailRegistry.set(adapter)
      this.app.instance('mail', adapter)

      console.log(`[MailServiceProvider] booted — driver: ${driver}`)
    }
  }

  return MailServiceProvider
}
