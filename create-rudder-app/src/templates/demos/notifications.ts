// Notifications demo — multi-channel notification (mail only by default;
// add 'database' to via() once @rudderjs/notification's Prisma model is in place).

export function demosNotificationsView(): string {
  return `import { useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface NotifyResponse {
  ok:       boolean
  to:       string
  channels: string[]
}

export default function NotificationsDemo() {
  const [to,      setTo]      = useState('user@example.com')
  const [data,    setData]    = useState<NotifyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function notify() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/notifications/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to }),
      })
      const body = await res.json() as NotifyResponse | { message: string }
      if (!res.ok) throw new Error((body as { message: string }).message ?? 'Send failed')
      setData(body as NotifyResponse)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Notifications</h1>
        <p className="hero-lead">
          Dispatches a <code className="inline-code">WelcomeNotification</code> via{' '}
          <code className="inline-code">notify(notifiable, notification)</code>. The notification's{' '}
          <code className="inline-code">via()</code> picks the channel(s); the mail channel routes
          through the log driver, so output lands in the dev terminal.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div className="form-card">
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="notify-to">Email</label>
            <input id="notify-to" className="form-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="form-submit" onClick={notify} disabled={loading}>
            {loading ? 'Sending…' : 'Send notification'}
          </button>
          {error && (
            <p className="form-error" style={{ marginTop: '1rem' }}>{error}</p>
          )}
          {data && (
            <p className="form-success" style={{ marginTop: '1rem' }}>
              Sent to <code>{data.to}</code> via <code>{data.channels.join(', ')}</code> — check the terminal.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
`
}

export function demoNotification(): string {
  return `import { Notification, type Notifiable } from '@rudderjs/notification'
import { Mailable } from '@rudderjs/mail'

class WelcomeMail extends Mailable {
  constructor(private readonly notifiable: Notifiable) { super() }

  build(): this {
    return this
      .subject(\`Welcome to RudderJS, \${this.notifiable.name ?? 'friend'}!\`)
      .text(
        \`Hi \${this.notifiable.name ?? 'there'},\\n\\n\` +
        \`Your account is ready. Thanks for joining us.\\n\\n\` +
        \`— The RudderJS Team\`,
      )
  }
}

/**
 * Demo notification — single mail channel by default. Add 'database' once
 * the Notification Prisma model is migrated, or 'broadcast' once @rudderjs/broadcast
 * is wired up.
 */
export class WelcomeNotification extends Notification {
  via(_notifiable: Notifiable): string[] {
    return ['mail']
  }

  toMail(notifiable: Notifiable): WelcomeMail {
    return new WelcomeMail(notifiable)
  }
}
`
}

export function demosNotificationsApiBlock(): string {
  return `// POST /api/notifications/send — dispatches WelcomeNotification to the supplied email.
// On-demand notifiable: no DB record required.
router.post('/api/notifications/send', async (req, res) => {
  const body = (req.body ?? {}) as { to?: string }
  if (!body.to) return res.status(422).json({ message: 'Body must be { to }' })

  const { notify, Notification }  = await import('@rudderjs/notification')
  const { WelcomeNotification }   = await import('../app/Notifications/WelcomeNotification.ts')

  const notification = new WelcomeNotification()
  await notify(Notification.route('mail', body.to), notification)
  res.json({ ok: true, to: body.to, channels: notification.via({ id: '0', email: body.to }) })
})`
}
