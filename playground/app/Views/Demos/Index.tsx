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
    title:       'Cache counter',
    description: 'Click "Bump" to read the current value via Cache.get, increment it, and write it back via Cache.set. Default driver is in-memory.',
    href:        '/demos/cache',
    packages:    ['@rudderjs/cache'],
  },
  {
    title:       'Queue dispatch',
    description: 'Dispatch ExampleJob via @rudderjs/queue. The handler logs to the server terminal — install @rudderjs/horizon for a UI.',
    href:        '/demos/queue',
    packages:    ['@rudderjs/queue'],
  },
  {
    title:       'Mail send',
    description: 'Send a DemoMail via @rudderjs/mail. Default driver is log — output lands in the dev server terminal.',
    href:        '/demos/mail',
    packages:    ['@rudderjs/mail'],
  },
  {
    title:       'Notifications',
    description: 'Dispatch a WelcomeNotification via notify(). The notification\'s via() picks the channel(s); mail routes through the log driver.',
    href:        '/demos/notifications',
    packages:    ['@rudderjs/notification', '@rudderjs/mail'],
  },
  {
    title:       'Localization',
    description: 'Locale switcher resolves the same keys server-side via trans(). Strings live in lang/<locale>/messages.json.',
    href:        '/demos/localization',
    packages:    ['@rudderjs/localization'],
  },
  {
    title:       'HTTP client',
    description: 'Server-side Http.retry(3, 200).timeout(5000).get(url) against a public API. The 500 endpoint exercises the retry path.',
    href:        '/demos/http',
    packages:    ['@rudderjs/http'],
  },
  {
    title:       'Avatar resize',
    description: 'Upload an image — server resizes it to 256×256 WebP via @rudderjs/image and saves to public storage. Side-by-side compare.',
    href:        '/demos/avatar',
    packages:    ['@rudderjs/image', '@rudderjs/storage'],
  },
  {
    title:       'System info',
    description: 'Three shell commands (git, node, uptime) executed via @rudderjs/process. Compares sequential vs parallel cost using Process.pool().',
    href:        '/demos/system-info',
    packages:    ['@rudderjs/process'],
  },
  {
    title:       'Worker threads',
    description: 'Compute fib(n) sequentially on the main thread vs across @rudderjs/concurrency worker pool. Watch the parallel cost stay flat as you crank N.',
    href:        '/demos/fibonacci',
    packages:    ['@rudderjs/concurrency'],
  },
  {
    title:       'Todos',
    description: 'ORM + interactive UI. Controller loads initial data, the view hydrates and POSTs to /api/todos/* for live updates.',
    href:        '/demos/todos',
    packages:    ['@rudderjs/orm', '@rudderjs/router'],
  },
  {
    title:       'WebSocket chat',
    description: 'Real-time chat + presence using @rudderjs/broadcast — multi-channel pub/sub over a single WebSocket connection.',
    href:        '/demos/ws',
    packages:    ['@rudderjs/broadcast'],
  },
  {
    title:       'Collaborative editor',
    description: 'Yjs CRDT live document with awareness cursors. Open in two tabs to see real-time sync over @rudderjs/sync.',
    href:        '/demos/sync',
    packages:    ['@rudderjs/sync'],
  },
  {
    title:       'Billing',
    description: 'Paddle checkout + subscription state. Click a plan to open the overlay; webhook handlers update the row in paddle_subscriptions.',
    href:        '/demos/billing',
    packages:    ['@rudderjs/cashier-paddle'],
  },
  {
    title:       'Feature flags',
    description: 'Boolean, value, scoped, and Lottery features resolved against the current user. Sub-route guarded by FeatureMiddleware to demonstrate 403 blocking.',
    href:        '/demos/pennant',
    packages:    ['@rudderjs/pennant'],
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
