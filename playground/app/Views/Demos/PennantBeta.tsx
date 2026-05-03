import '@/index.css'

// Override the id-derived URL (`/demos/pennant-beta`) so SPA nav matches the
// controller route, which is `/demos/pennant/beta` (a sub-path under pennant).
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
