import { shouldScaffoldDemo, type TemplateContext } from '../../templates.js'
import { DEMOS, demoHref, demoTitle } from './registry.js'

export function demosIndexView(ctx: TemplateContext): string {
  const cards = DEMOS
    .filter(d => shouldScaffoldDemo(ctx, d.value))
    .map(d => `        <a key="${demoHref(d)}" href="${demoHref(d)}" className="feature-card">
          <h3 className="feature-title">${demoTitle(d)}</h3>
          <p className="feature-desc">${escapeJsxText(d.description)}</p>
          <p className="feature-desc" style={{ fontSize: '0.7rem', opacity: 0.7 }}>${d.packages.join(' · ')}</p>
        </a>`)
    .join('\n')

  return `import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// Override the id-derived URL ('/demos/index') so SPA nav matches the controller ('/demos').
export const route = '/demos'

export default function DemosIndex() {
  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">Demos</h1>
        <p className="hero-lead">
          Small, focused examples of what the framework can do. Each one is a single
          controller returning <code className="inline-code">view('demos.&lt;name&gt;')</code>.
        </p>
      </section>

      <section className="feature-section">
        <div className="feature-grid">
${cards}
        </div>
      </section>
    </div>
  )
}
`
}

// Description strings live as plain text in the registry, but they're emitted
// inside JSX text nodes. Escape '<' and '>' so a raw '<name>' (e.g. in the
// localization description) doesn't get parsed as a JSX element.
function escapeJsxText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
