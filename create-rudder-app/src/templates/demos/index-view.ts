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
      title: 'WebSocket chat',
      desc:  'Real-time chat + presence using @rudderjs/broadcast — multi-channel pub/sub over a single WebSocket connection.',
      href:  '/demos/ws',
      pkgs:  '@rudderjs/broadcast',
      show:  shouldScaffoldDemo(ctx, 'ws'),
    },
    {
      title: 'Collaborative editor',
      desc:  'Yjs CRDT live document with awareness cursors. Open in two tabs to see real-time sync over @rudderjs/sync.',
      href:  '/demos/live',
      pkgs:  '@rudderjs/sync',
      show:  shouldScaffoldDemo(ctx, 'live'),
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
