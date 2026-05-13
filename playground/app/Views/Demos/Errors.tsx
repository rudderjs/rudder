import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

interface Trigger {
  title:       string
  description: string
  href:        string
  expects:     string
}

const triggers: Trigger[] = [
  {
    title:       'Generic throw',
    description: 'A route handler that calls throw new Error("...") with no special class.',
    href:        '/demos/errors/throw',
    expects:     'The Ignition-style dev error page with stack frames + source context (dev only).',
  },
  {
    title:       'Deep stack throw',
    description: 'Same as above, but the throw happens four function calls deep so you can inspect the frame list.',
    href:        '/demos/errors/deep',
    expects:     'Ignition page showing the full call chain from the route handler down to the throw site.',
  },
  {
    title:       'abort(404)',
    description: 'Throws an HttpException via abort(404, "User #42 not found") — what you reach for in route handlers when a resource is missing.',
    href:        '/demos/errors/not-found',
    expects:     'A 404 page with the custom message. Renders even in production (HttpException is intentional, no source leak).',
  },
  {
    title:       'abort(403)',
    description: 'abort(403) with the default Forbidden message.',
    href:        '/demos/errors/forbidden',
    expects:     'A 403 page. Same pipeline as 404 — just a different status.',
  },
  {
    title:       'ValidationError',
    description: 'Throws a ValidationError directly (also fires automatically from FormRequest / validate() / validateWith()).',
    href:        '/demos/errors/validation',
    expects:     'A 422 JSON response with { errors: { field: [messages] } }. JSON regardless of Accept header — validation always replies JSON.',
  },
  {
    title:       'AppError (custom renderer)',
    description: 'Throws app/Exceptions/AppError.ts — playground registers a custom renderer in bootstrap/app.ts via .withExceptions((e) => e.render(AppError, ...)).',
    href:        '/demos/errors/app-error',
    expects:     'A JSON response shaped by AppError.toJSON() with the configured statusCode.',
  },
]

export default function ErrorsDemo() {
  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Error pages</h1>
        <p className="hero-lead">
          Click any link below to trigger that error type from a route handler. In dev mode
          unhandled exceptions render the Ignition-style page with stack frames and source
          context; recognized exception types ({''}
          <code className="inline-code">HttpException</code>, {''}
          <code className="inline-code">ValidationError</code>, custom renderers) bypass the
          dev page and return their structured response. Set {''}
          <code className="inline-code">APP_DEBUG=false</code> in <code className="inline-code">.env</code>{''}
          to see the production-safe page instead.
        </p>
      </section>

      <section className="feature-section">
        <div className="feature-grid">
          {triggers.map(t => (
            <a key={t.href} href={t.href} className="feature-card">
              <h3 className="feature-title">{t.title}</h3>
              <p className="feature-desc">{t.description}</p>
              <p className="feature-desc" style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.8 }}>
                <strong>Expect:</strong> {t.expects}
              </p>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
