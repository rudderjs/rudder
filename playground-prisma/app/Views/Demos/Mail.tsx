import { useState } from 'react'
import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface MailResponse {
  ok:        boolean
  to:        string
  subject:   string
  driver:    string
}

export default function MailDemo() {
  const [to,      setTo]      = useState('user@example.com')
  const [subject, setSubject] = useState('Hello from RudderJS')
  const [data,    setData]    = useState<MailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function send() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/mail/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to, subject }),
      })
      const body = await res.json() as MailResponse | { message: string }
      if (!res.ok) throw new Error((body as { message: string }).message ?? 'Send failed')
      setData(body as MailResponse)
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
        <h1 className="hero-title">Mail send</h1>
        <p className="hero-lead">
          Sends a <code className="inline-code">DemoMail</code> via{' '}
          <code className="inline-code">@rudderjs/mail</code>. Default driver is{' '}
          <code className="inline-code">log</code> — check the dev server terminal for output.
        </p>
      </section>

      <section className="feature-section" style={{ maxWidth: '32rem', margin: '0 auto' }}>
        <div className="form-card">
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="mail-to">To</label>
            <input id="mail-to" className="form-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label className="form-label" htmlFor="mail-subject">Subject</label>
            <input id="mail-subject" className="form-input" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <button className="form-submit" onClick={send} disabled={loading}>
            {loading ? 'Sending…' : 'Send mail'}
          </button>
          {error && (
            <p className="form-error" style={{ marginTop: '1rem' }}>{error}</p>
          )}
          {data && (
            <p className="form-success" style={{ marginTop: '1rem' }}>
              Sent to <code>{data.to}</code> via <code>{data.driver}</code> driver — check the terminal.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
