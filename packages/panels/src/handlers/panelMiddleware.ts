import type { MiddlewareHandler } from '@boostkit/core'
import type { Panel } from '../Panel.js'
import type { PanelContext } from '../types.js'

export function buildPanelMiddleware(panel: Panel): MiddlewareHandler[] {
  const guard = panel.getGuard()
  if (!guard) return []

  const mw: MiddlewareHandler = async (req, res, next) => {
    // Resolve the authenticated user from the session (via better-auth),
    // falling back to req.user if AuthMiddleware has already set it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let user: Record<string, unknown> | undefined = (req as any).user
    if (!user) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { app } = await import('@boostkit/core') as any
        const auth    = app().make('auth')
        const session = await auth.api.getSession({
          headers: new Headers(req.headers as Record<string, string>),
        })
        user = session?.user ?? undefined
      } catch {
        // auth not configured
      }
    }

    const ctx: PanelContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user:    user as any,
      headers: req.headers as Record<string, string>,
      path:    req.path,
    }
    const allowed = await guard(ctx)
    if (!allowed) {
      return res.status(401).json({ message: 'Unauthorized.' })
    }
    await next()
  }

  return [mw]
}
