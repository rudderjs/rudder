import '@/index.css'

// Override the id-derived URL (`/demos/index`) so SPA nav matches the controller (`/demos`).
export const route = '/demos'

interface Demo {
  title:       string
  description: string
  href:        string
  packages:    string[]
}

const demos: Demo[] = [
  {
    title:       'Contact form',
    description: 'CSRF-protected form with Zod validation. Demonstrates getCsrfToken() and FormRequest-style error handling.',
    href:        '/demos/contact',
    packages:    ['@rudderjs/middleware', '@rudderjs/core'],
  },
  {
    title:       'Todos',
    description: 'ORM + interactive UI. Controller loads initial data, the view hydrates and POSTs to /api/todos/* for live updates.',
    href:        '/demos/todos',
    packages:    ['@rudderjs/orm', '@rudderjs/router'],
  },
  {
    title:       'Billing',
    description: 'Paddle checkout + subscription state. Click a plan to open the overlay; webhook handlers update the row in paddle_subscriptions.',
    href:        '/demos/billing',
    packages:    ['@rudderjs/cashier-paddle'],
  },
]

export default function DemosIndex() {
  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          <a href="/" className="nav-link">Home</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Demos</h1>
        <p className="hero-lead">
          Small, focused examples of what the framework can do. Each one is a single
          controller returning <code className="inline-code">view(&apos;demos.&lt;name&gt;&apos;)</code>.
        </p>
      </section>

      <section className="feature-section">
        <div className="feature-grid">
          {demos.map(d => (
            <a key={d.href} href={d.href} className="feature-card">
              <h3 className="feature-title">{d.title}</h3>
              <p className="feature-desc">{d.description}</p>
              <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                {d.packages.join(' · ')}
              </p>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
