import type { TemplateContext } from '../../templates.js'

export function welcomeView(ctx: TemplateContext): string {
  if (ctx.frameworks.length === 0) return welcomeViewVanilla(ctx)
  switch (ctx.primary) {
    case 'vue':   return welcomeViewVue(ctx)
    case 'solid': return welcomeViewSolid(ctx)
    default:      return welcomeViewReact(ctx)
  }
}

/**
 * Vanilla welcome view for no-frontend recipes (api-service, minimal).
 *
 * Returns a SafeString built with @rudderjs/view's html`` tagged template
 * (zero-client-JS, server-rendered HTML). No React/Vue/Solid imports → no
 * vike-* renderer required. The @rudderjs/vite view scanner detects the
 * .ts extension + no installed vike-renderer and generates the matching
 * `pages/__view/welcome/+Page.ts` stub that returns the Page as a string.
 *
 * `pages/+config.ts` wraps the page's body in an `onRenderHtml` hook —
 * see `templates/pages/index.ts` for the vanilla shell.
 */
export function welcomeViewVanilla(_ctx: TemplateContext): string {
  return `import { html } from '@rudderjs/view'

// URL this view is served at — MUST match the Route.get('/', ...) in routes/web.ts.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
}

export default function Welcome(props: WelcomeProps) {
  return html\`<main class="page">
  <section class="hero">
    <h1>\${props.appName}</h1>
    <p>
      Laravel's developer experience, Vike's performance, Node's ecosystem.
      This is a no-frontend scaffold — every request is served by a controller in <code>routes/api.ts</code>.
    </p>
    <p>
      <small>RudderJS v\${props.rudderVersion} &middot; Node \${props.nodeVersion} &middot; env=\${props.env}</small>
    </p>
  </section>
  <section>
    <h2>Try the API</h2>
    <ul>
      <li><a href="/api/health"><code>GET /api/health</code></a> — health probe</li>
    </ul>
  </section>
  <footer>
    Built with RudderJS. Edit <code>app/Views/Welcome.ts</code> to customize this page,
    or delete it and rely on <code>/api/*</code> only.
  </footer>
</main>\`
}
`
}

const WELCOME_FEATURES = `const DEFAULT_DOCS   = 'https://github.com/rudderjs/rudder'
const DEFAULT_GITHUB = 'https://github.com/rudderjs/rudder'

const features: Feature[] = [
  {
    title:       'Controllers & Routing',
    description: 'Explicit routes in routes/api.ts with middleware, params, named routes, and return types that just work.',
    href:        \`\${DEFAULT_DOCS}#routing\`,
  },
  {
    title:       'Eloquent ORM',
    description: 'Laravel-style models on Prisma or Drizzle. Query relationships, scopes, and eager loading without changing mental models.',
    href:        \`\${DEFAULT_DOCS}#orm\`,
  },
  {
    title:       'Controller Views',
    description: "The page you're looking at — return view() from a controller, rendered through Vike SSR. Zero adapter, full SPA nav.",
    href:        \`\${DEFAULT_DOCS}#views\`,
  },
  {
    title:       'Rudder CLI',
    description: 'Laravel-style make:* generators, schedule, db:seed, and custom commands. Run \\\`pnpm rudder\\\` for the full list.',
    href:        \`\${DEFAULT_DOCS}#cli\`,
  },
  {
    title:       'Queues & Jobs',
    description: 'Dispatch background jobs with sync, database, or Redis drivers. Monitor them with @rudderjs/horizon.',
    href:        \`\${DEFAULT_DOCS}#queue\`,
  },
  {
    title:       'Auth, Guards, Policies',
    description: 'Session-backed auth, password reset, gates, and RequireAuth / RequireGuest middleware — all through one provider.',
    href:        \`\${DEFAULT_DOCS}#auth\`,
  },
]`

export function welcomeViewReact(_ctx: TemplateContext): string {
  return `import '@/index.css'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// URL this view is served at — MUST match the Route.get('/', ...) in routes/web.ts.
// The scanner reads this constant and writes it into the generated +route.ts,
// so Vike's client router can SPA-navigate here instead of doing full reloads.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  docsUrl?:      string
  githubUrl?:    string
}

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

export default function Welcome(props: WelcomeProps) {
  const docsUrl   = props.docsUrl   ?? DEFAULT_DOCS
  const githubUrl = props.githubUrl ?? DEFAULT_GITHUB

  return (
    <div className="page">
      <SiteHeader />

      <section className="hero">
        <h1 className="hero-title">{props.appName}</h1>
        <p className="hero-lead">
          Laravel&apos;s developer experience, Vike&apos;s performance, Node&apos;s ecosystem.
          This page is served by a controller, rendered through{' '}
          <code className="inline-code">view(&apos;welcome&apos;)</code>.
        </p>
        <div className="hero-meta">
          <span>RudderJS v{props.rudderVersion}</span>
          <span>•</span>
          <span>Node {props.nodeVersion}</span>
          <span>•</span>
          <span>env={props.env}</span>
        </div>
      </section>

      <section className="feature-section">
        <div className="feature-grid">
          {features.map(f => (
            <a key={f.title} href={f.href} className="feature-card">
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.description}</p>
            </a>
          ))}
        </div>
      </section>

      <footer className="page-footer">
        <div className="footer-inner">
          <div>Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.</div>
          <div className="footer-links">
            <a href={docsUrl} className="footer-link">Docs</a>
            <a href={githubUrl} className="footer-link">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
`
}

export function welcomeViewVue(_ctx: TemplateContext): string {
  // Vue SFC quirk: top-level `export` statements must live in a regular
  // <script> block, NOT <script setup> (the compiler rejects exports there).
  // The scanner reads both blocks as plain text, so the route override is
  // still picked up. Keep this dual-script structure whenever a Vue view
  // needs `export const route = '/...'`.
  return `<script lang="ts">
// URL this view is served at — see the React variant for rationale.
export const route = '/'
</script>

<script setup lang="ts">
import '@/index.css'
import SiteHeader from 'App/Components/SiteHeader.vue'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  docsUrl?:      string
  githubUrl?:    string
}

const props = defineProps<WelcomeProps>()

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

const docsUrl   = props.docsUrl   ?? DEFAULT_DOCS
const githubUrl = props.githubUrl ?? DEFAULT_GITHUB
</script>

<template>
  <div class="page">
    <SiteHeader />

    <section class="hero">
      <h1 class="hero-title">{{ props.appName }}</h1>
      <p class="hero-lead">
        Laravel's developer experience, Vike's performance, Node's ecosystem.
        This page is served by a controller, rendered through
        <code class="inline-code">view('welcome')</code>.
      </p>
      <div class="hero-meta">
        <span>RudderJS v{{ props.rudderVersion }}</span>
        <span>•</span>
        <span>Node {{ props.nodeVersion }}</span>
        <span>•</span>
        <span>env={{ props.env }}</span>
      </div>
    </section>

    <section class="feature-section">
      <div class="feature-grid">
        <a v-for="f in features" :key="f.title" :href="f.href" class="feature-card">
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.description }}</p>
        </a>
      </div>
    </section>

    <footer class="page-footer">
      <div class="footer-inner">
        <div>Built with RudderJS. Edit <code>app/Views/Welcome.vue</code> to customize this page.</div>
        <div class="footer-links">
          <a :href="docsUrl" class="footer-link">Docs</a>
          <a :href="githubUrl" class="footer-link">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>
`
}

export function welcomeViewSolid(_ctx: TemplateContext): string {
  return `import '@/index.css'
import { For } from 'solid-js'
import { SiteHeader } from 'App/Components/SiteHeader.js'

// URL this view is served at — see the React variant for rationale.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  docsUrl?:      string
  githubUrl?:    string
}

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

export default function Welcome(props: WelcomeProps) {
  const docsUrl   = () => props.docsUrl   ?? DEFAULT_DOCS
  const githubUrl = () => props.githubUrl ?? DEFAULT_GITHUB

  return (
    <div class="page">
      <SiteHeader />

      <section class="hero">
        <h1 class="hero-title">{props.appName}</h1>
        <p class="hero-lead">
          Laravel's developer experience, Vike's performance, Node's ecosystem.
          This page is served by a controller, rendered through{' '}
          <code class="inline-code">view('welcome')</code>.
        </p>
        <div class="hero-meta">
          <span>RudderJS v{props.rudderVersion}</span>
          <span>•</span>
          <span>Node {props.nodeVersion}</span>
          <span>•</span>
          <span>env={props.env}</span>
        </div>
      </section>

      <section class="feature-section">
        <div class="feature-grid">
          <For each={features}>
            {(f) => (
              <a href={f.href} class="feature-card">
                <h3 class="feature-title">{f.title}</h3>
                <p class="feature-desc">{f.description}</p>
              </a>
            )}
          </For>
        </div>
      </section>

      <footer class="page-footer">
        <div class="footer-inner">
          <div>Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.</div>
          <div class="footer-links">
            <a href={docsUrl()} class="footer-link">Docs</a>
            <a href={githubUrl()} class="footer-link">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
`
}
