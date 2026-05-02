import type { TemplateContext } from '../../templates.js'

export function welcomeView(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return welcomeViewVue(ctx)
    case 'solid': return welcomeViewSolid(ctx)
    default:      return welcomeViewReact(ctx)
  }
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

export function welcomeViewReact(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n\n`
  return `${cssImport}// URL this view is served at — MUST match the Route.get('/', ...) in routes/web.ts.
// The scanner reads this constant and writes it into the generated +route.ts,
// so Vike's client router can SPA-navigate here instead of doing full reloads.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  // null when the auth package isn't installed (Laravel's Route::has() idiom).
  loginUrl:      string | null
  registerUrl:   string | null
  signOutUrl?:   string
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
  const signOutUrl  = props.signOutUrl  ?? '/api/auth/sign-out'
  const docsUrl     = props.docsUrl     ?? DEFAULT_DOCS
  const githubUrl   = props.githubUrl   ?? DEFAULT_GITHUB

  async function handleSignOut() {
    await fetch(signOutUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    // Full reload so the server resolves a fresh pageContext (logged-out user).
    window.location.href = '/'
  }

  return (
    <div className="page">
      <nav className="page-nav">
        <div className="brand">
          <span className="brand-dot" />
          RudderJS
        </div>
        <div className="nav-right">
          {props.loginUrl && (props.user ? (
            <>
              <span className="nav-badge">
                Signed in as <strong>{props.user.name}</strong>
              </span>
              <button type="button" onClick={handleSignOut} className="nav-button">
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href={props.loginUrl} className="nav-link">Log in</a>
              {props.registerUrl && (
                <a href={props.registerUrl} className="nav-button">Register</a>
              )}
            </>
          ))}
        </div>
      </nav>

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

export function welcomeViewVue(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
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
${cssImport}
export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  // null when the auth package isn't installed (Laravel's Route::has() idiom).
  loginUrl:      string | null
  registerUrl:   string | null
  signOutUrl?:   string
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

const signOutUrl  = props.signOutUrl  ?? '/api/auth/sign-out'
const docsUrl     = props.docsUrl     ?? DEFAULT_DOCS
const githubUrl   = props.githubUrl   ?? DEFAULT_GITHUB

async function handleSignOut() {
  await fetch(signOutUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{}',
  })
  // Full reload so the server resolves a fresh pageContext (logged-out user).
  window.location.href = '/'
}
</script>

<template>
  <div class="page">
    <nav class="page-nav">
      <div class="brand">
        <span class="brand-dot"></span>
        RudderJS
      </div>
      <div v-if="props.loginUrl" class="nav-right">
        <template v-if="props.user">
          <span class="nav-badge">
            Signed in as <strong>{{ props.user.name }}</strong>
          </span>
          <button type="button" @click="handleSignOut" class="nav-button">
            Sign out
          </button>
        </template>
        <template v-else>
          <a :href="props.loginUrl" class="nav-link">Log in</a>
          <a v-if="props.registerUrl" :href="props.registerUrl" class="nav-button">Register</a>
        </template>
      </div>
    </nav>

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

export function welcomeViewSolid(ctx: TemplateContext): string {
  const cssImport = `import '@/index.css'\n`
  return `${cssImport}import { For, Show } from 'solid-js'

// URL this view is served at — see the React variant for rationale.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  // null when the auth package isn't installed (Laravel's Route::has() idiom).
  loginUrl:      string | null
  registerUrl:   string | null
  signOutUrl?:   string
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
  const signOutUrl  = () => props.signOutUrl  ?? '/api/auth/sign-out'
  const docsUrl     = () => props.docsUrl     ?? DEFAULT_DOCS
  const githubUrl   = () => props.githubUrl   ?? DEFAULT_GITHUB

  async function handleSignOut() {
    await fetch(signOutUrl(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    // Full reload so the server resolves a fresh pageContext (logged-out user).
    window.location.href = '/'
  }

  return (
    <div class="page">
      <nav class="page-nav">
        <div class="brand">
          <span class="brand-dot" />
          RudderJS
        </div>
        <Show when={props.loginUrl}>
          {(loginUrl) => (
            <div class="nav-right">
              <Show
                when={props.user}
                fallback={
                  <>
                    <a href={loginUrl()} class="nav-link">Log in</a>
                    <Show when={props.registerUrl}>
                      {(registerUrl) => (
                        <a href={registerUrl()} class="nav-button">Register</a>
                      )}
                    </Show>
                  </>
                }
              >
                {(user) => (
                  <>
                    <span class="nav-badge">
                      Signed in as <strong>{user().name}</strong>
                    </span>
                    <button type="button" onClick={handleSignOut} class="nav-button">
                      Sign out
                    </button>
                  </>
                )}
              </Show>
            </div>
          )}
        </Show>
      </nav>

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
