import type { MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Middleware that requires **all** listed OAuth scopes on the Bearer token
 * (AND semantics). Must be used after BearerMiddleware or RequireBearer.
 *
 * @example
 * router.get('/admin', [RequireBearer(), scope('admin')], handler)
 * router.post('/orders', [RequireBearer(), scope('write', 'place-orders')], handler)
 */
export function scope(...requiredScopes: string[]): MiddlewareHandler {
  return async function ScopeMiddleware(req, res, next) {
    const raw = req.raw as Record<string, unknown>
    const tokenScopes = raw['__passport_scopes'] as string[] | undefined

    if (!tokenScopes) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: 'Token does not have the required scopes.',
        required: requiredScopes,
      })
      return
    }

    // Wildcard scope grants everything
    if (tokenScopes.includes('*')) {
      await next()
      return
    }

    const missing = requiredScopes.filter(s => !tokenScopes.includes(s))
    if (missing.length > 0) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: `Token is missing scope(s): ${missing.join(', ')}`,
        required: requiredScopes,
        missing,
      })
      return
    }

    await next()
  }
}

/**
 * Middleware that requires **any** of the listed OAuth scopes on the Bearer
 * token (OR semantics — Laravel's `scopes` vs `scope` middleware). Must be
 * used after BearerMiddleware or RequireBearer.
 *
 * @example
 * // Either scope is enough
 * router.get('/orders', [RequireBearer(), scopeAny('orders:read', 'orders:write')], handler)
 */
export function scopeAny(...allowedScopes: string[]): MiddlewareHandler {
  return async function ScopeAnyMiddleware(req, res, next) {
    const raw = req.raw as Record<string, unknown>
    const tokenScopes = raw['__passport_scopes'] as string[] | undefined

    if (!tokenScopes) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: 'Token does not have any of the required scopes.',
        required: allowedScopes,
      })
      return
    }

    // Wildcard scope grants everything
    if (tokenScopes.includes('*')) {
      await next()
      return
    }

    // Calling scopeAny() with no arguments is a no-op safety net rather than
    // an instant 403 — mirrors Laravel's behavior when the dev forgets the list.
    if (allowedScopes.length === 0) {
      await next()
      return
    }

    const matched = allowedScopes.some(s => tokenScopes.includes(s))
    if (!matched) {
      res.status(403).json({
        error: 'insufficient_scope',
        message: `Token must have at least one of: ${allowedScopes.join(', ')}`,
        required: allowedScopes,
      })
      return
    }

    await next()
  }
}
