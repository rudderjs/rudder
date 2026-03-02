import * as _nm from 'nodemailer'
import type { Mailable, MailAdapter, MailAdapterProvider, SendOptions } from '@forge/mail'

// ─── Config ────────────────────────────────────────────────

export interface NodemailerConfig {
  driver:      'smtp'
  host:        string
  port:        number
  username?:   string
  password?:   string
  encryption?: 'tls' | 'ssl' | 'none'
}

// ─── SMTP Adapter ──────────────────────────────────────────

class NodemailerAdapter implements MailAdapter {
  private readonly transporter: ReturnType<typeof _nm.createTransport>

  constructor(
    private readonly config: NodemailerConfig,
    private readonly from: { address: string; name?: string },
  ) {
    const secure = config.encryption === 'ssl'
    this.transporter = _nm.createTransport({
      host:   config.host,
      port:   config.port,
      secure,
      auth:   config.username
        ? { user: config.username, pass: config.password ?? '' }
        : undefined,
    })
  }

  async send(mailable: Mailable, options: SendOptions): Promise<void> {
    const msg = await mailable.compile()
    const fromStr = this.from.name
      ? `${this.from.name} <${this.from.address}>`
      : this.from.address
    await this.transporter.sendMail({
      from:    fromStr,
      to:      options.to.join(', '),
      cc:      options.cc?.join(', '),
      bcc:     options.bcc?.join(', '),
      subject: msg.subject,
      html:    msg.html,
      text:    msg.text,
    })
  }
}

// ─── Factory ───────────────────────────────────────────────

/**
 * Named export used by @forge/mail's dynamic import:
 *   const { nodemailer } = await import('@forge/mail-nodemailer')
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
