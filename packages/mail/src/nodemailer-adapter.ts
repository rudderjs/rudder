import { resolveOptionalPeer } from '@rudderjs/core'
import type { Mailable } from './mailable.js'
import type { MailAdapter, MailAdapterProvider, MailConnectionConfig, SendOptions } from './index.js'

// ─── Public config shape ───────────────────────────────────

export interface NodemailerConfig {
  driver:      'smtp'
  host:        string
  port:        number
  username?:   string
  password?:   string
  encryption?: 'tls' | 'ssl' | 'none'
}

// ─── Internal nodemailer-peer surface (typed structurally) ─

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

// ─── Config guard ──────────────────────────────────────────

/**
 * Type guard used by `MailProvider.boot()` to narrow a generic
 * `MailConnectionConfig` to a valid `NodemailerConfig` before constructing
 * an SMTP adapter. Returns false when required fields are missing or
 * `driver !== 'smtp'`.
 */
export function isNodemailerConfig(
  config: MailConnectionConfig,
): config is MailConnectionConfig & NodemailerConfig {
  return (
    config.driver === 'smtp' &&
    typeof config.host === 'string' &&
    typeof config.port === 'number'
  )
}

// ─── Adapter ───────────────────────────────────────────────

class NodemailerAdapter implements MailAdapter {
  private _transporter: Promise<NodemailerTransporter> | null = null

  constructor(
    private readonly config: NodemailerConfig,
    private readonly from: { address: string; name?: string },
  ) {}

  /**
   * Lazy `nodemailer` peer load — the package is optional, only required
   * when SMTP is the active driver. Memoized so we don't repeat the
   * resolveOptionalPeer call on every send.
   */
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

// ─── Factory ───────────────────────────────────────────────

/**
 * Build a `MailAdapterProvider` that constructs an SMTP-backed adapter
 * on demand. Used by `MailProvider.boot()` and by `FailoverAdapter`
 * config expansion to lazy-init nodemailer only when SMTP is in play.
 */
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
