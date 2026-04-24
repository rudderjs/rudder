import '@/index.css'

// URL this view is served at — MUST match the controller in routes/web.ts.
// The scanner reads this constant and writes it into the generated +route.ts,
// so Vike's client router can SPA-navigate here instead of doing full reloads.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  loginUrl?:     string
  registerUrl?:  string
  signOutUrl?:   string
  docsUrl?:      string
  githubUrl?:    string
}

interface Feature {
  title:       string
  description: string
  href:        string
}

const DEFAULT_DOCS   = 'https://github.com/rudderjs/rudder'
const DEFAULT_GITHUB = 'https://github.com/rudderjs/rudder'

const features: Feature[] = [
  {
    title:       'Controllers & Routing',
    description: 'Explicit routes in routes/api.ts with middleware, params, named routes, and return types that just work.',
    href:        `${DEFAULT_DOCS}#routing`,
  },
  {
    title:       'Eloquent ORM',
    description: 'Laravel-style models on Prisma or Drizzle. Query relationships, scopes, and eager loading without changing mental models.',
    href:        `${DEFAULT_DOCS}#orm`,
  },
  {
    title:       'Controller Views',
    description: "The page you're looking at — return view() from a controller, rendered through Vike SSR. Zero adapter, full SPA nav.",
    href:        `${DEFAULT_DOCS}#views`,
  },
  {
    title:       'Rudder CLI',
    description: 'Laravel-style make:* generators, schedule, db:seed, and custom commands. Run `pnpm rudder` for the full list.',
    href:        `${DEFAULT_DOCS}#cli`,
  },
  {
    title:       'Queues & Jobs',
    description: 'Dispatch background jobs with sync, database, or Redis drivers. Monitor them with @rudderjs/horizon.',
    href:        `${DEFAULT_DOCS}#queue`,
  },
  {
    title:       'Auth, Guards, Policies',
    description: 'Session-backed auth, password reset, gates, and RequireAuth / RequireGuest middleware — all through one provider.',
    href:        `${DEFAULT_DOCS}#auth`,
  },
]

export default function Welcome(props: WelcomeProps) {
  const loginUrl    = props.loginUrl    ?? '/login'
  const registerUrl = props.registerUrl ?? '/register'
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
          {props.user ? (
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
              <a href={loginUrl} className="nav-link">Log in</a>
              <a href={registerUrl} className="nav-button">Register</a>
            </>
          )}
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
          <div>
            Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.
          </div>
          <div className="footer-links">
            <a href={docsUrl} className="footer-link">Docs</a>
            <a href={githubUrl} className="footer-link">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
