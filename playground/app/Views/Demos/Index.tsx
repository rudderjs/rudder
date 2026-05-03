import '@/index.css'
import { DEMOS, demoHref, demoTitle, type DemoSpec } from 'create-rudder-app/demos-registry'

// Override the id-derived URL (`/demos/index`) so SPA nav matches the controller (`/demos`).
export const route = '/demos'

interface CardData {
  title:       string
  description: string
  href:        string
  packages:    ReadonlyArray<string>
}

const fromSpec = (d: DemoSpec): CardData => ({
  title:       demoTitle(d),
  description: d.description,
  href:        demoHref(d),
  packages:    d.packages,
})

// Playground exercises every framework feature including ones the scaffolder
// can't ship without external setup (cashier-paddle needs a real Paddle vendor
// account, webhook URL, etc.). Add such demos here as a one-line append.
const playgroundExtras: CardData[] = [
  {
    title:       'Billing',
    description: 'Paddle checkout + subscription state. Click a plan to open the overlay; webhook handlers update the row in paddle_subscriptions.',
    href:        '/demos/billing',
    packages:    ['@rudderjs/cashier-paddle'],
  },
]

const cards: CardData[] = [...DEMOS.map(fromSpec), ...playgroundExtras]

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
          {cards.map(c => (
            <a key={c.href} href={c.href} className="feature-card">
              <h3 className="feature-title">{c.title}</h3>
              <p className="feature-desc">{c.description}</p>
              <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                {c.packages.join(' · ')}
              </p>
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
