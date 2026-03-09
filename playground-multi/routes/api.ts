import { router } from '@boostkit/router'
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'
import { RateLimit } from '@boostkit/middleware'

const authLimit = RateLimit.perMinute(10).message('Too many auth attempts. Try again later.')

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// GET /api/me — returns current session or null
router.get('/api/me', async (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  })
  return Response.json(session ?? { user: null, session: null })
})

// All /api/auth/* requests are handled by better-auth
router.all('/api/auth/*', (req) => {
  const auth    = app().make<BetterAuthInstance>('auth')
  const honoCtx = req.raw as { req: { raw: Request } }
  return auth.handler(honoCtx.req.raw)
}, [authLimit])

// Catch-all: any unmatched /api/* route returns 404
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
