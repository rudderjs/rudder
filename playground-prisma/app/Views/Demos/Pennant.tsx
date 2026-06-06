import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface PennantProps {
  user:   { id: string; name: string; email: string } | null
  values: Record<string, unknown>
}

interface FeatureCardSpec {
  name:        string
  shape:       string
  resolver:    string
  expected:    string
}

const features: FeatureCardSpec[] = [
  {
    name:     'dark-mode',
    shape:    'boolean',
    resolver: '() => true',
    expected: 'Always true.',
  },
  {
    name:     'max-uploads',
    shape:    'value',
    resolver: '() => 10',
    expected: 'Returns the literal value, not a boolean.',
  },
  {
    name:     'beta-dashboard',
    shape:    'scoped',
    resolver: '(scope) => scope !== null',
    expected: 'True for any signed-in user; false for anon.',
  },
  {
    name:     'new-checkout',
    shape:    'lottery',
    resolver: '() => Lottery.odds(1, 4)',
    expected: '~25% chance per scope. Stable on subsequent checks (memo’d).',
  },
]

export default function PennantDemo({ user, values }: PennantProps) {
  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Feature flags</h1>
        <p className="hero-lead">
          Resolved against the current scope ({user
            ? <><strong>{user.name}</strong> · {user.email}</>
            : <em>guest</em>}). Definitions live in{' '}
          <code className="inline-code">app/Providers/AppServiceProvider.ts</code>{' '}
          and resolution happens here via{' '}
          <code className="inline-code">Feature.values([...], scope)</code>.
        </p>
        {!user && (
          <p className="hero-meta">
            Sign in to see <code className="inline-code">beta-dashboard</code> flip to true.
          </p>
        )}
      </section>

      <section className="feature-section">
        <div className="demo-card-grid">
          {features.map(f => {
            const resolved = values[f.name]
            const display  = JSON.stringify(resolved)
            return (
              <div key={f.name} className="demo-card">
                <div className="demo-card-header">
                  <h2 className="flag-name">{f.name}</h2>
                  <p className="flag-shape">{f.shape}</p>
                </div>
                <div className="demo-card-body">
                  <div className="flag-section">
                    <div className="flag-section-label">resolver</div>
                    <code className="code-inline-block">{f.resolver}</code>
                  </div>
                  <div className="flag-section">
                    <div className="flag-section-label">expected</div>
                    <p className="demo-card-desc">{f.expected}</p>
                  </div>
                  <div className="flag-resolved">
                    <div className="flag-section-label">resolved value</div>
                    <code className="flag-resolved-value">{display}</code>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="demo-card" style={{ marginTop: '1.5rem' }}>
          <div className="demo-card-header">
            <h2 className="demo-card-title">FeatureMiddleware</h2>
            <p className="demo-card-desc">
              <code className="inline-code">/demos/pennant/beta</code> is wrapped in{' '}
              <code className="inline-code">FeatureMiddleware('beta-dashboard')</code>. The middleware reads{' '}
              <code className="inline-code">req.user</code> as the scope; non-matching scopes get a 403.
            </p>
          </div>
          <a href="/demos/pennant/beta" className="button-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Open /demos/pennant/beta →
          </a>
        </div>

        <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <a href="/demos" className="demo-back-link">← Back to demos</a>
        </div>
      </section>
    </div>
  )
}
