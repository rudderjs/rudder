import { Middleware } from '@forge/core'
import type { ForgeRequest, ForgeResponse } from '@forge/core'

/**
 * Example per-route middleware.
 *
 * Checks for a Bearer token in the Authorization header.
 * In a real app, you'd verify a JWT or session here.
 *
 * Usage in routes/api.ts:
 *   const auth = new AuthMiddleware().toHandler()
 *   router.post('/api/posts', handler, [auth])
 */
export class AuthMiddleware extends Middleware {
  handle(req: ForgeRequest, res: ForgeResponse, next: () => Promise<void>): Promise<void> {
    console.log('auth middleware: checking Authorization header')
    
    const header = req.headers['authorization'] ?? ''

    if (!header.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Unauthorized. Provide a Bearer token.' })
      return Promise.resolve()
    }

    // Token is present — attach it to the request for downstream handlers
    const token = header.slice(7)
    ;(req as unknown as Record<string, unknown>)['token'] = token

    return next()
  }
}
