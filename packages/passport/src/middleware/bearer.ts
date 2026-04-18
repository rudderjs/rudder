import type { MiddlewareHandler } from '@rudderjs/contracts'
import { verifyToken } from '../token.js'
import { Passport } from '../Passport.js'
import type { AccessToken } from '../models/AccessToken.js'

/**
 * Middleware that authenticates via Bearer token (JWT).
 * Validates the JWT signature, checks expiration, checks revocation in DB.
 * Attaches user to the request if valid. Does not block unauthenticated requests.
 */
export function BearerMiddleware(): MiddlewareHandler {
  return async function BearerMiddleware(req, _res, next) {
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) {
      await next()
      return
    }

    const jwt = authHeader.slice(7).trim()
    try {
      const payload = await verifyToken(jwt)

      // Check revocation in DB
      const AccessTokenCls = await Passport.tokenModel()
      const token = await AccessTokenCls.query()
        .where('id', payload.jti)
        .first() as AccessToken | null

      if (!token || token.revoked) {
        await next()
        return
      }

      // Attach token info to the raw request
      const raw = req.raw as Record<string, unknown>
      raw['__passport_token'] = token
      raw['__passport_scopes'] = payload.scopes
      raw['__passport_user_id'] = payload.sub

      // Resolve user if we have a userId
      if (payload.sub) {
        try {
          const { app } = await import('@rudderjs/core')
          const manager = app().make<{ guard(): { provider: { retrieveById(id: string): Promise<unknown> } } }>('auth.manager')
          const user = await manager.guard().provider.retrieveById(payload.sub)
          if (user) {
            const plain: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(user as Record<string, unknown>)) {
              if (typeof v !== 'function' && k !== 'password') plain[k] = v
            }
            raw['__rjs_user'] = plain
            try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }
          }
        } catch { /* auth not available */ }
      }
    } catch {
      // Invalid JWT — continue without auth
    }

    await next()
  }
}

/**
 * Middleware that requires a valid Bearer token. Returns 401 if missing/invalid.
 */
export function RequireBearer(): MiddlewareHandler {
  return async function RequireBearer(req, res, next) {
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthenticated', message: 'Bearer token required.' })
      return
    }

    const jwt = authHeader.slice(7).trim()
    try {
      const payload = await verifyToken(jwt)

      // Check revocation
      const AccessTokenCls = await Passport.tokenModel()
      const token = await AccessTokenCls.query()
        .where('id', payload.jti)
        .first() as AccessToken | null

      if (!token || token.revoked) {
        res.status(401).json({ error: 'unauthenticated', message: 'Token has been revoked.' })
        return
      }

      const raw = req.raw as Record<string, unknown>
      raw['__passport_token'] = token
      raw['__passport_scopes'] = payload.scopes
      raw['__passport_user_id'] = payload.sub

      if (payload.sub) {
        try {
          const { app } = await import('@rudderjs/core')
          const manager = app().make<{ guard(): { provider: { retrieveById(id: string): Promise<unknown> } } }>('auth.manager')
          const user = await manager.guard().provider.retrieveById(payload.sub)
          if (user) {
            const plain: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(user as Record<string, unknown>)) {
              if (typeof v !== 'function' && k !== 'password') plain[k] = v
            }
            raw['__rjs_user'] = plain
            try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }
          }
        } catch { /* auth not available */ }
      }

      await next()
    } catch {
      res.status(401).json({ error: 'unauthenticated', message: 'Invalid or expired token.' })
    }
  }
}
