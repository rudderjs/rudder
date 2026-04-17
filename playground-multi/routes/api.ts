import { router } from '@rudderjs/router'
import { auth } from '@rudderjs/auth'

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// GET /api/me — returns the currently authenticated user, or null
router.get('/api/me', async (_req, res) => {
  const user = await auth().user()
  return res.json(user ? { user } : { user: null })
})

// Catch-all: any unmatched /api/* route returns 404
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
