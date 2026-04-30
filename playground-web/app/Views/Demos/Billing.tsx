import { useEffect, useRef, useState } from 'react'
import '@/index.css'

// Match the controller URL — keeps SPA nav working.
export const route = '/demos/billing'

interface BillingProps {
  mock:             boolean
  clientSideToken:  string
  sandbox:          boolean
  /** Static price ids — wire your own products in config/cashier.ts. */
  prices: Array<{ id: string; label: string; description: string }>
  signedIn:         boolean
  subscription: {
    paddleId:       string
    status:         string
    productId:      string | null
    trialEndsAt:    string | null
    pausedAt:       string | null
    endsAt:         string | null
  } | null
}

const SCRIPT_SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js'

declare global {
  interface Window {
    Paddle?: {
      Environment: { set(env: 'sandbox' | 'production'): void }
      Initialize(opts: { token: string }): void
      Checkout: { open(opts: Record<string, unknown>): void }
    }
  }
}

export default function BillingDemo({ mock, clientSideToken, sandbox, prices, signedIn, subscription }: BillingProps) {
  const [paddleReady, setPaddleReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (mock || initialized.current) return
    initialized.current = true

    const init = (): void => {
      const Paddle = window.Paddle
      if (!Paddle) return
      if (sandbox) Paddle.Environment.set('sandbox')
      Paddle.Initialize({ token: clientSideToken })
      setPaddleReady(true)
    }

    if (window.Paddle) { init(); return }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src   = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', init, { once: true })
  }, [mock, clientSideToken, sandbox])

  async function buy(priceId: string): Promise<void> {
    setError(null)
    if (!signedIn) {
      window.location.href = `/login?intent=${encodeURIComponent('/demos/billing')}`
      return
    }
    if (!paddleReady || !window.Paddle) {
      setError('Paddle.js not ready yet — try again in a second.')
      return
    }
    const res = await fetch('/api/billing/checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ priceId }),
    })
    if (!res.ok) {
      setError(`Could not create checkout: ${res.statusText}`)
      return
    }
    const { options } = await res.json() as { options: Record<string, unknown> }
    window.Paddle.Checkout.open(options)
  }

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos" className="nav-link">Demos</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Billing</h1>
        <p className="hero-lead">
          Paddle checkout via <code className="inline-code">@rudderjs/cashier-paddle</code>.
          Click a plan to open the overlay; webhooks update the subscription state below.
        </p>
      </section>

      {mock && (
        <section className="feature-section" style={{ paddingTop: 0 }}>
          <div className="feature-card" style={{ borderColor: 'var(--accent)' }}>
            <h3 className="feature-title">Mock mode</h3>
            <p className="feature-desc">
              <code className="inline-code">PADDLE_API_KEY</code> /{' '}
              <code className="inline-code">PADDLE_CLIENT_SIDE_TOKEN</code> /{' '}
              <code className="inline-code">PADDLE_WEBHOOK_SECRET</code> are not set. The page renders, but
              checkout buttons are inert and webhook signature verification will reject all calls.
            </p>
          </div>
        </section>
      )}

      <section className="feature-section">
        <div className="feature-grid">
          {prices.map(p => (
            <div key={p.id} className="feature-card">
              <h3 className="feature-title">{p.label}</h3>
              <p className="feature-desc">{p.description}</p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => { void buy(p.id) }}
                disabled={mock}
                style={{ marginTop: '1rem' }}
              >
                {mock ? 'Disabled in mock mode' : 'Buy'}
              </button>
            </div>
          ))}
        </div>
        {error && <p className="feature-desc" style={{ color: 'var(--danger)' }}>{error}</p>}
      </section>

      <section className="feature-section">
        <h2 className="hero-title" style={{ fontSize: '1.5rem' }}>Current subscription</h2>
        {!signedIn && (
          <p className="feature-desc">
            <a href="/login?intent=/demos/billing">Sign in</a> to see your subscription.
          </p>
        )}
        {signedIn && !subscription && (
          <p className="feature-desc">No active subscription. Pick a plan above.</p>
        )}
        {signedIn && subscription && (
          <div className="feature-card" style={{ maxWidth: 520 }}>
            <p className="feature-desc"><strong>Status:</strong> {subscription.status}</p>
            <p className="feature-desc"><strong>Paddle id:</strong> <code className="inline-code">{subscription.paddleId}</code></p>
            {subscription.productId && (
              <p className="feature-desc"><strong>Product:</strong> {subscription.productId}</p>
            )}
            {subscription.trialEndsAt && (
              <p className="feature-desc"><strong>Trial ends:</strong> {new Date(subscription.trialEndsAt).toLocaleString()}</p>
            )}
            {subscription.endsAt && (
              <p className="feature-desc"><strong>Ends:</strong> {new Date(subscription.endsAt).toLocaleString()}</p>
            )}
            <a href="/demos/billing/subscriptions" className="nav-link" style={{ display: 'inline-block', marginTop: '0.5rem' }}>
              Manage →
            </a>
          </div>
        )}
      </section>
    </div>
  )
}
