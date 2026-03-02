import { router } from '@forge/router'
import { resolve, app } from '@forge/core'
import type { BetterAuthInstance } from '@forge/auth-better-auth'
import { Cache } from '@forge/cache'
import { Storage } from '@forge/storage'
import { UserService } from '../app/Services/UserService.js'
import { AuthMiddleware } from '../app/Middleware/AuthMiddleware.js'
import { RequestIdMiddleware } from 'app/Middleware/RequestIdMiddleware.js'

// Per-route middleware instance — reused across protected routes
const authMw = new AuthMiddleware().toHandler()

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

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
router.get('/api/users', async (_req, res) => {
  const users = await Cache.remember('users:all', 60, () =>
    resolve<UserService>(UserService).findAll()
  )
  return res.json({ data: users })
}, [authMw])  // optional per-route middleware, e.g. for logging or auth

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
// PUT /api/files/:filename  — write a text file
router.put('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  await Storage.put(`uploads/${filename}`, content)
  return res.json({ path: `uploads/${filename}`, url: Storage.url(`uploads/${filename}`) })
})

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

// Catch-all: any unmatched /api/* route returns 404 instead of falling through to Vike
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
