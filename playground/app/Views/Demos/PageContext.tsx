import { useEffect, useState } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { getCsrfToken } from '@rudderjs/middleware/client'
import '@/index.css'

interface PageContextWithEnhancers {
  user?:   { id?: string | number; name?: string; email?: string } | null
  locale?: string
  flash?:  Record<string, unknown>
}

export default function PageContextDemo() {
  const ctx = usePageContext() as unknown as PageContextWithEnhancers
  const user   = ctx.user   ?? null
  const locale = ctx.locale ?? '—'
  const flash  = ctx.flash  ?? {}
  const flashEntries = Object.entries(flash)

  // CSRF token is in document.cookie — only readable client-side.
  const [csrf, setCsrf] = useState('')
  useEffect(() => { setCsrf(getCsrfToken()) }, [])

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/demos" className="nav-link">Demos</a>
          <a href="/" className="nav-link">Home</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Vike pageContext enhancers</h1>
        <p className="hero-lead">
          Three providers each push per-request state onto{' '}
          <code className="inline-code">pageContext</code> via{' '}
          <code className="inline-code">@rudderjs/vite</code>'s enhancer registry.
          Views read them with{' '}
          <code className="inline-code">usePageContext()</code> — no{' '}
          <code className="inline-code">+data.ts</code>, no controller plumbing.
        </p>
      </section>

      <section className="feature-section">
        <div className="demo-card-grid">
          <div className="demo-card">
            <div className="demo-card-header">
              <h2 className="demo-card-title">pageContext.user</h2>
              <p className="demo-card-desc">from <code className="inline-code">@rudderjs/auth</code></p>
            </div>
            <div className="demo-card-body">
              {user
                ? (
                  <>
                    <p className="feature-desc"><strong>name:</strong> {user.name ?? '—'}</p>
                    <p className="feature-desc"><strong>email:</strong> {user.email ?? '—'}</p>
                  </>
                )
                : <p className="feature-desc"><em>null</em> — sign in to populate it</p>
              }
            </div>
          </div>

          <div className="demo-card">
            <div className="demo-card-header">
              <h2 className="demo-card-title">pageContext.locale</h2>
              <p className="demo-card-desc">from <code className="inline-code">@rudderjs/localization</code></p>
            </div>
            <div className="demo-card-body">
              <p style={{ fontSize: '2rem', fontWeight: 700, margin: 0 }}>{locale}</p>
              <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                Resolved via <code className="inline-code">getLocale()</code> inside the enhancer.
              </p>
            </div>
          </div>

          <div className="demo-card">
            <div className="demo-card-header">
              <h2 className="demo-card-title">pageContext.flash</h2>
              <p className="demo-card-desc">from <code className="inline-code">@rudderjs/session</code></p>
            </div>
            <div className="demo-card-body">
              {flashEntries.length === 0
                ? <p className="feature-desc"><em>empty</em> — click below to set a flash and reload</p>
                : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.25rem' }}>
                    {flashEntries.map(([k, v]) => (
                      <li key={k} className="feature-desc">
                        <code className="inline-code">{k}</code>: {String(v)}
                      </li>
                    ))}
                  </ul>
                )
              }
              <form method="POST" action="/demos/page-context/notify" style={{ marginTop: '1rem' }}>
                <input type="hidden" name="_token" value={csrf} />
                <button type="submit" className="form-submit" disabled={!csrf}>Set a flash message</button>
              </form>
              <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.5rem' }}>
                POSTs to a route that calls <code className="inline-code">Session.flash(...)</code> and redirects back. Flash carries to the next render only.
              </p>
            </div>
          </div>
        </div>

        <div className="demo-card" style={{ marginTop: '1.5rem' }}>
          <div className="demo-card-header">
            <h2 className="demo-card-title">Per-page response headers</h2>
            <p className="demo-card-desc">
              This view's controller passes <code className="inline-code">{`{ headers: { 'cache-control': 'no-store' } }`}</code> as the third arg to <code className="inline-code">view()</code>. Open the network tab on the document request — the response carries that header. Headers can be a plain object or a function for per-request values like CSP nonces.
            </p>
          </div>
        </div>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <a href="/demos" className="demo-back-link">← Back to demos</a>
        </div>
      </section>
    </div>
  )
}
