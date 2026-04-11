import { app } from '@rudderjs/core'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { AuthManager, runWithAuth, Auth } from './auth-manager.js'
import type { AuthConfig } from './auth-manager.js'

/**
 * Middleware that blocks authenticated users from guest-only pages
 * (login, register, forgot-password, reset-password).
 *
 * Replaces the Vike `+guard.ts` pattern — guards now live in the router
 * middleware chain alongside `RequireAuth`, `RateLimit`, and `CsrfMiddleware`.
 */
export function RequireGuest(redirectTo = '/', guardName?: string): MiddlewareHandler {
  return async function RequireGuest(req, res, next) {
    const manager = app().make<AuthManager>('auth.manager')
    let user: unknown = null
    await runWithAuth(manager, async () => {
      const guard = Auth.guard(guardName ?? (manager as unknown as { config: AuthConfig }).config.defaults.guard)
      user = await guard.user()
    })
    if (user) {
      res.redirect(redirectTo)
      return
    }
    await next()
  }
}
