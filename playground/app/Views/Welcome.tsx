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
    <div className="min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          RudderJS
        </div>
        <div className="flex items-center gap-4 text-sm">
          {props.user ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">
                Signed in as{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{props.user.name}</span>
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <a
                href={loginUrl}
                className="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Log in
              </a>
              <a
                href={registerUrl}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Register
              </a>
            </>
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{props.appName}</h1>
        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
          Laravel&apos;s developer experience, Vike&apos;s performance, Node&apos;s ecosystem.
          <br className="hidden sm:block" />
          This page is served by a controller, rendered through{' '}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">view(&apos;welcome&apos;)</code>.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 text-xs text-zinc-500">
          <span>RudderJS v{props.rudderVersion}</span>
          <span>•</span>
          <span>Node {props.nodeVersion}</span>
          <span>•</span>
          <span>env={props.env}</span>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(f => (
            <a
              key={f.title}
              href={f.href}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-100"
            >
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
                {f.description}
              </p>
            </a>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-200 dark:border-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:justify-between">
          <div>
            Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.
          </div>
          <div className="flex gap-4">
            <a href={docsUrl} className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
              Docs
            </a>
            <a href={githubUrl} className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
