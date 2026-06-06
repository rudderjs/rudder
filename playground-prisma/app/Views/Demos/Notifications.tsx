import { useState } from 'react'
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
