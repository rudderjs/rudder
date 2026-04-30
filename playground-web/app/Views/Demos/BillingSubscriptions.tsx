import { useState } from 'react'
import '@/index.css'

export const route = '/demos/billing/subscriptions'

interface SubscriptionRow {
  paddleId:    string
  type:        string
  status:      string
  productId:   string | null
  pausedAt:    string | null
  endsAt:      string | null
  trialEndsAt: string | null
  active:      boolean
  paused:      boolean
  canceled:    boolean
  onGrace:     boolean
}

interface Props {
  mock:          boolean
  subscriptions: SubscriptionRow[]
}

export default function BillingSubscriptions({ mock, subscriptions: initial }: Props) {
  const [subs, setSubs] = useState<SubscriptionRow[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function action(paddleId: string, op: 'pause' | 'resume' | 'cancel'): Promise<void> {
    setBusy(`${paddleId}:${op}`)
    setError(null)
    try {
      const res = await fetch(`/api/billing/subscriptions/${paddleId}/${op}`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      const { subscriptions } = await res.json() as { subscriptions: SubscriptionRow[] }
      setSubs(subscriptions)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos/billing" className="nav-link">Back</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Manage subscription</h1>
        <p className="hero-lead">Pause / resume / cancel — webhook handlers refresh the row.</p>
      </section>

      {mock && (
        <section className="feature-section" style={{ paddingTop: 0 }}>
          <div className="feature-card" style={{ borderColor: 'var(--accent)' }}>
            <h3 className="feature-title">Mock mode</h3>
            <p className="feature-desc">Buttons hit the API but Paddle calls will fail without credentials.</p>
          </div>
        </section>
      )}

      <section className="feature-section">
        {subs.length === 0 && <p className="feature-desc">No subscriptions yet.</p>}
        <div className="feature-grid">
          {subs.map(s => (
            <div key={s.paddleId} className="feature-card">
              <h3 className="feature-title">{s.type}</h3>
              <p className="feature-desc"><strong>Status:</strong> {s.status}</p>
              {s.productId && <p className="feature-desc"><strong>Product:</strong> {s.productId}</p>}
              {s.endsAt   && <p className="feature-desc"><strong>Ends:</strong> {new Date(s.endsAt).toLocaleString()}</p>}
              {s.pausedAt && <p className="feature-desc"><strong>Paused:</strong> {new Date(s.pausedAt).toLocaleString()}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                {!s.paused && !s.canceled && (
                  <button type="button" className="btn-secondary" disabled={busy !== null}
                          onClick={() => { void action(s.paddleId, 'pause') }}>
                    {busy === `${s.paddleId}:pause` ? 'Pausing…' : 'Pause'}
                  </button>
                )}
                {s.paused && (
                  <button type="button" className="btn-secondary" disabled={busy !== null}
                          onClick={() => { void action(s.paddleId, 'resume') }}>
                    {busy === `${s.paddleId}:resume` ? 'Resuming…' : 'Resume'}
                  </button>
                )}
                {!s.canceled && (
                  <button type="button" className="btn-secondary" disabled={busy !== null}
                          onClick={() => { void action(s.paddleId, 'cancel') }}>
                    {busy === `${s.paddleId}:cancel` ? 'Canceling…' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {error && <p className="feature-desc" style={{ color: 'var(--danger)' }}>{error}</p>}
      </section>
    </div>
  )
}
