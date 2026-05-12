import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// Override the id-derived URL (`/demos/pennant-beta`) so SPA nav matches the
// controller route, which is `/demos/pennant/beta` (a sub-path under pennant).
export const route = '/demos/pennant/beta'

export default function PennantBeta() {
  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Beta dashboard</h1>
        <p className="hero-lead">
          You only see this page if <code className="inline-code">beta-dashboard</code> is active for your scope.
          The route is wrapped in <code className="inline-code">FeatureMiddleware('beta-dashboard')</code>;
          unauthorized scopes get a 403 before this view ever renders.
        </p>
        <a href="/demos/pennant" className="demo-back-link">← Back to /demos/pennant</a>
      </section>
    </div>
  )
}
