import { router } from '@boostkit/router'
import { resolve, app, dd, dump } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'
import { Cache } from '@boostkit/cache'
import { Storage } from '@boostkit/storage'
import { RateLimit } from '@boostkit/middleware'
import { notify } from '@boostkit/notification'
import { validate } from '@boostkit/validation'
import { UserService } from '../app/Services/UserService.js'
import { AuthMiddleware } from '../app/Middleware/AuthMiddleware.js'
import { RequestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.js'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'
import { CreateUserRequest } from '../app/Requests/CreateUserRequest.js'
import { TestController } from '../app/Controllers/TestController.js'

// Register decorator-based controllers
router.registerController(TestController)

// Per-route middleware instance — reused across protected routes
const authMw = new AuthMiddleware().toHandler()

// Auth rate limit — keyed by IP + path so each endpoint (sign-in, sign-out, sign-up)
// has its own counter per client. Prevents one action from exhausting another's budget.
const authLimit = RateLimit.perMinute(10)
  .by(req => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? (req.headers['x-real-ip'] as string | undefined)
      ?? 'unknown'
    return `${ip}:${req.path}`
  })
  .message('Too many auth attempts. Try again later.')
  .toHandler()

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// ── dd / dump demo ─────────────────────────────────────────
// GET /api/debug/dump  — prints to terminal, keeps server running
router.get('/api/debug/dump', (req, res) => {
  dump({ note: 'Check your terminal for dump output.' })
  return res.json({ note: 'Check your terminal for dump output.' })
})

// GET /api/debug/dd  — prints to terminal then kills the server (restart required)
router.get('/api/debug/dd', (req) => {
  dd({ note: 'This will terminate the server. Restart required.' })
})

// GET /api/debug/error  — triggers an unhandled error to test the error page
function debugThrow() {
  throw new Error('Something went wrong in a route handler.')
}
router.get('/api/debug/error', debugThrow)

// GET /api/me — returns current session (null if not logged in)
router.get('/api/me', async (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  })
  return Response.json(session ?? { user: null, session: null })
})

// router.get('/id', (_req, res) => res.json({ id: res.header('X-Request-Id') }), [RequestIdMiddleware])  // example of using the RequestIdMiddleware on a specific route

// Public routes — no auth required
// Results are cached for 60 s — subsequent calls skip the DB query
// Rate-limited to 60 req/min per IP
router.get('/api/users', async (_req, res) => {
  const users = await Cache.remember('users:all', 60, () => {
    console.log('Cache miss for users:all — querying database...')
     return resolve<UserService>(UserService).findAll();
  })
  return res.json({ data: users })
})

router.get('/api/users/:id', async (req, res) => {
  const user = await resolve<UserService>(UserService).findById(req.params['id']!)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  return res.json({ data: user })
})

// Protected routes — require Authorization: Bearer <token>
router.post('/api/users', async (req, res) => {
  const user = await resolve<UserService>(UserService).create(req.body as { name: string; email: string; role?: string })
  return res.status(201).json({ data: user })
}, [authMw])

// ── File storage demo ──────────────────────────────────────
// PUT /api/files/:filename  — write a text file (10 uploads/min per IP)
router.put('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  await Storage.put(`uploads/${filename}`, content)
  return res.json({ path: `uploads/${filename}`, url: Storage.url(`uploads/${filename}`) })
}, [RateLimit.perMinute(10).toHandler()])

// GET /api/files  — list uploaded files
router.get('/api/files', async (_req, res) => {
  const files = await Storage.list('uploads')
  return res.json({ files })
})

// GET /api/files/:filename  — read a file
router.get('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  const content = await Storage.text(`uploads/${filename}`)
  if (content === null) return res.status(404).json({ message: 'File not found.' })
  return res.json({ filename, content })
})

// DELETE /api/files/:filename  — delete a file
router.delete('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  await Storage.delete(`uploads/${filename}`)
  return res.json({ deleted: filename })
})

// POST /api/notify/welcome  — send a WelcomeNotification to a notifiable (mail + database)
// Body: { id, email, name? }
router.post('/api/notify/welcome', async (req, res) => {
  const { id, email, name } = req.body as { id?: string; email?: string; name?: string }
  if (!id || !email) return res.status(422).json({ message: 'id and email are required.' })
  await notify({ id, email, name }, new WelcomeNotification())
  return res.json({ sent: true })
})

// ── Validation demo ───────────────────────────────────────
// POST /api/validate/user  — validates body with FormRequest (returns errors on failure)
router.post('/api/validate/user', async (req, res) => {
  const data = await validate(req, CreateUserRequest)
  return res.json({ valid: true, data })
})

// Auth routes — delegate all /api/auth/* requests to better-auth, with a stricter rate limit
router.all('/api/auth/*', (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const honoCtx = req.raw as { req: { raw: Request } }
  return auth.handler(honoCtx.req.raw)
}, [authLimit])

// Catch-all: any unmatched /api/* route returns 404 instead of falling through to Vike
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
