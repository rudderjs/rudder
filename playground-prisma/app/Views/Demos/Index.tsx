import '@/index.css'
import { DEMOS, demoHref, demoTitle, type DemoSpec } from './registry.js'
import { SiteHeader } from 'App/Components/SiteHeader.js'

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
  {
    title:       'Computer-use browser',
    description: 'Anthropic Claude drives a real headless Chromium via computerUseTool({ page }). Type a URL + question, watch the agent take screenshots, click, and answer.',
    href:        '/demos/browser',
    packages:    ['@rudderjs/ai/computer-use', 'playwright'],
  },
  {
    title:       'Vike pageContext enhancers',
    description: 'auth, session, and localization providers push user / flash / locale onto pageContext via @rudderjs/vite’s enhancer registry. View reads them through usePageContext() with no +data.ts. Demonstrates view(id, props, { headers }) too.',
    href:        '/demos/page-context',
    packages:    ['@rudderjs/vite', '@rudderjs/auth', '@rudderjs/session', '@rudderjs/localization'],
  },
  {
    title:       'Error pages',
    description: 'Trigger every error shape — Ignition-style dev page on generic throws, HttpException via abort(), ValidationError → 422 JSON, and a custom AppError renderer wired in bootstrap/app.ts. APP_DEBUG=false in .env shows the production-safe variant instead.',
    href:        '/demos/errors',
    packages:    ['@rudderjs/core', '@rudderjs/server-hono'],
  },
  {
    title:       'Typed view props',
    description: 'Export interface Props in the view file — @rudderjs/vite\'s scanner emits a ViewPropsRegistry entry, and view(\'demos.typed-view\', ...) type-checks against it. Pass the wrong shape and tsc fails at the controller, not at render time.',
    href:        '/demos/typed-view',
    packages:    ['@rudderjs/view', '@rudderjs/vite'],
  },
  {
    title:       'Dynamic prerender',
    description: 'Parameterized route with build-time URL enumeration. export const prerender = [\'/demos/prerender-dynamic/alpha\', \'/.../beta\'] in the view file writes one static HTML per slug at build time — array form for inline lists, async function form for DB-driven slugs.',
    href:        '/demos/prerender-dynamic/alpha',
    packages:    ['@rudderjs/view', '@rudderjs/vite'],
  },
]

const cards: CardData[] = [...DEMOS.map(fromSpec), ...playgroundExtras]

export default function DemosIndex() {
  return (
    <div className="page">
      <SiteHeader />

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
