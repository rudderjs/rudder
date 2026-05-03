// Pennant demo — feature flags resolved against the current user. Two routes:
// /demos/pennant (renders the four card shapes) and /demos/pennant/beta
// (guarded by FeatureMiddleware to demonstrate the 403 path).

export function demosPennantView(): string {
  return `import '@/index.css'

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
  { name: 'dark-mode',      shape: 'boolean', resolver: '() => true',                       expected: 'Always true.' },
  { name: 'max-uploads',    shape: 'value',   resolver: '() => 10',                         expected: 'Returns the literal value, not a boolean.' },
  { name: 'beta-dashboard', shape: 'scoped',  resolver: '(scope) => scope !== null',        expected: 'True for any signed-in user; false for anon.' },
  { name: 'new-checkout',   shape: 'lottery', resolver: '() => Lottery.odds(1, 4)',         expected: '~25% chance per scope. Stable on subsequent checks.' },
]

export default function PennantDemo({ user, values }: PennantProps) {
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
      </section>
    </div>
  )
}
`
}

export function demosPennantBetaView(): string {
  return `import '@/index.css'

// Override the id-derived URL ('/demos/pennant-beta') so SPA nav matches the
// controller route, which is '/demos/pennant/beta' (a sub-path under pennant).
export const route = '/demos/pennant/beta'

export default function PennantBeta() {
  return (
    <div className="error-wrap">
      <h1 className="heading-lg">Beta dashboard</h1>
      <p className="muted" style={{ maxWidth: '32rem', textAlign: 'center' }}>
        You only see this page if <code className="inline-code">beta-dashboard</code> is active for your scope.
        The route is wrapped in <code className="inline-code">FeatureMiddleware('beta-dashboard')</code>;
        unauthorized scopes get a 403 before this view ever renders.
      </p>
      <a href="/demos/pennant" className="error-link">← Back to /demos/pennant</a>
    </div>
  )
}
`
}

/**
 * Lines added to AppServiceProvider's boot() when the pennant demo is selected.
 * Defines the four feature shapes shown in the demo (boolean, value, scoped, lottery).
 */
export function pennantFeatureDefinitions(): string {
  return `Feature.define('dark-mode',      () => true)
    Feature.define('max-uploads',    () => 10)
    Feature.define('beta-dashboard', (scope) => typeof scope === 'object' && scope !== null)
    Feature.define('new-checkout',   () => Lottery.odds(1, 4))`
}
