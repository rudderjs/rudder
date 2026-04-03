import { Route } from '@rudderjs/router'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { SessionMiddleware } from '@rudderjs/session'

// Web middleware — session + CSRF apply to all web routes (not API)
const webMw = [
  SessionMiddleware(),
  CsrfMiddleware(),
]

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
