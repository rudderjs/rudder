import { shouldScaffoldDemo, type TemplateContext } from '../../templates.js'

export function demosIndexView(ctx: TemplateContext): string {
  const cards: { title: string; desc: string; href: string; show: boolean; pkgs: string }[] = [
    {
      title: 'Contact form',
      desc:  'CSRF-protected form with Zod validation. Demonstrates getCsrfToken() and FormRequest-style error handling.',
      href:  '/demos/contact',
      pkgs:  '@rudderjs/middleware · @rudderjs/core',
      show:  shouldScaffoldDemo(ctx, 'contact'),
    },
    {
      title: 'Todos',
      desc:  'ORM + interactive UI. Controller loads initial data, the view hydrates and POSTs to /api/todos/* for live updates.',
      href:  '/demos/todos',
      pkgs:  '@rudderjs/orm · @rudderjs/router',
      show:  shouldScaffoldDemo(ctx, 'todos'),
    },
    {
      title: 'Avatar resize',
      desc:  'Upload an image — server resizes it to 256×256 WebP via @rudderjs/image and saves to public storage. Side-by-side compare.',
      href:  '/demos/avatar',
      pkgs:  '@rudderjs/image · @rudderjs/storage',
      show:  shouldScaffoldDemo(ctx, 'avatar'),
    },
    {
      title: 'System info',
      desc:  'Three shell commands (git, node, uptime) executed via @rudderjs/process. Compares sequential vs parallel cost using Process.pool().',
      href:  '/demos/system-info',
      pkgs:  '@rudderjs/process',
      show:  shouldScaffoldDemo(ctx, 'system-info'),
    },
    {
      title: 'Worker threads',
      desc:  'Compute fib(n) sequentially on the main thread vs across @rudderjs/concurrency worker pool. Watch the parallel cost stay flat as you crank N.',
      href:  '/demos/fibonacci',
      pkgs:  '@rudderjs/concurrency',
      show:  shouldScaffoldDemo(ctx, 'fibonacci'),
    },
    {
      title: 'Feature flags',
      desc:  'Boolean, value, scoped, and Lottery features resolved against the current user. Sub-route guarded by FeatureMiddleware to demonstrate 403 blocking.',
      href:  '/demos/pennant',
      pkgs:  '@rudderjs/pennant',
      show:  shouldScaffoldDemo(ctx, 'pennant'),
    },
    {
      title: 'Cache counter',
      desc:  'Persistent view counter via Cache.get + Cache.set. Demonstrates the Cache facade with the in-memory driver.',
      href:  '/demos/cache',
      pkgs:  '@rudderjs/cache',
      show:  shouldScaffoldDemo(ctx, 'cache'),
    },
    {
      title: 'Queue dispatch',
      desc:  'Click to enqueue ExampleJob via @rudderjs/queue. The handler logs to the server terminal.',
      href:  '/demos/queue',
      pkgs:  '@rudderjs/queue',
      show:  shouldScaffoldDemo(ctx, 'queue'),
    },
    {
      title: 'Mail send',
      desc:  'Send a Mailable via Mail.to(...).send(). Default driver is "log" — output appears in the dev terminal.',
      href:  '/demos/mail',
      pkgs:  '@rudderjs/mail',
      show:  shouldScaffoldDemo(ctx, 'mail'),
    },
    {
      title: 'Notifications',
      desc:  'Multi-channel notification via notify(notifiable, notification). Mail channel uses the log driver.',
      href:  '/demos/notifications',
      pkgs:  '@rudderjs/notification · @rudderjs/mail',
      show:  shouldScaffoldDemo(ctx, 'notifications'),
    },
    {
      title: 'Localization',
      desc:  'Pick a locale to fetch the same keys via trans() server-side. Strings live in lang/<locale>/messages.json.',
      href:  '/demos/localization',
      pkgs:  '@rudderjs/localization',
      show:  shouldScaffoldDemo(ctx, 'localization'),
    },
    {
      title: 'HTTP client',
      desc:  'Server-side Http.get(url).retry(3, 200).timeout(5000) against a public API. The 500 endpoint exercises retry.',
      href:  '/demos/http',
      pkgs:  '@rudderjs/http',
      show:  shouldScaffoldDemo(ctx, 'http'),
    },
    {
      title: 'WebSocket chat',
      desc:  'Real-time chat + presence using @rudderjs/broadcast — multi-channel pub/sub over a single WebSocket connection.',
      href:  '/demos/ws',
      pkgs:  '@rudderjs/broadcast',
      show:  shouldScaffoldDemo(ctx, 'ws'),
    },
    {
      title: 'Collaborative editor',
      desc:  'Yjs CRDT live document with awareness cursors. Open in two tabs to see real-time sync over @rudderjs/sync.',
      href:  '/demos/sync',
      pkgs:  '@rudderjs/sync',
      show:  shouldScaffoldDemo(ctx, 'sync'),
    },
  ].filter(c => c.show)

  const cardsJsx = cards.map(c => `        <a key="${c.href}" href="${c.href}" className="feature-card">
          <h3 className="feature-title">${c.title}</h3>
          <p className="feature-desc">${c.desc}</p>
          <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>${c.pkgs}</p>
        </a>`).join('\n')

  return `import '@/index.css'

// Override the id-derived URL ('/demos/index') so SPA nav matches the controller ('/demos').
export const route = '/demos'

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
          controller returning <code className="inline-code">view('demos.&lt;name&gt;')</code>.
        </p>
      </section>

      <section className="feature-section">
        <div className="feature-grid">
${cardsJsx}
        </div>
      </section>
    </div>
  )
}
`
}
