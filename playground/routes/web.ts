import { createRequire } from 'node:module'
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { app, config } from '@rudderjs/core'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { SessionMiddleware } from '@rudderjs/session'
import { registerAuthRoutes } from '@rudderjs/auth/routes'
import { AuthManager, Auth, runWithAuth } from '@rudderjs/auth'

// Web middleware — session + CSRF apply to all web routes (not API)
const webMw = [
  SessionMiddleware(),
  CsrfMiddleware(),
]

// Auth UI routes — login/register/forgot-password/reset-password
// Views live in app/Views/Auth/ (vendored from @rudderjs/auth/views/react/)
registerAuthRoutes(Route, { middleware: webMw })

// Read RudderJS version from @rudderjs/core's package.json at boot time.
const _require = createRequire(import.meta.url)
const rudderCorePkg = _require('@rudderjs/core/package.json') as { version: string }

// Welcome page — replaces the pages/index/ Vike page with a controller view.
// Delete this route and app/Views/Welcome.tsx to swap in your own landing page.
Route.get('/', async () => {
  let user: { name: string; email: string } | null = null
  try {
    const manager = app().make<AuthManager>('auth.manager')
    await runWithAuth(manager, async () => {
      const authUser = await Auth.user()
      if (authUser) {
        const record = authUser as unknown as Record<string, unknown>
        user = {
          name:  String(record['name']  ?? ''),
          email: String(record['email'] ?? ''),
        }
      }
    })
  } catch {
    // auth provider not registered — welcome page just won't show user info
  }
  return view('welcome', {
    appName:       config<string>('app.name', 'RudderJS'),
    rudderVersion: rudderCorePkg.version,
    nodeVersion:   process.version.replace(/^v/, ''),
    env:           config<string>('app.env', 'development'),
    user,
  })
}, webMw)

// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

Route.get('/test-get-route', (_req, res) => {
  res.send('test response')
}, webMw)

// GET /session/demo — increments a visit counter across requests
Route.get('/session/demo', (req, res) => {
  req.session.put('visits', (req.session.get<number>('visits') ?? 0) + 1)
  res.json({ visits: req.session.get('visits') })
}, webMw)
