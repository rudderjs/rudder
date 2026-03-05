import { Route } from '@boostkit/router'
import { CsrfMiddleware } from '@boostkit/middleware'
import { sessionMiddleware } from '@boostkit/session'
import configs from '../config/index.js'

// Web middleware — session + CSRF apply to all web routes (not API)
const webMw = [
  sessionMiddleware(configs.session),
  new CsrfMiddleware().toHandler(),
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
