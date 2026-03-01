import { render, redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

/**
 * Page-level auth guard — Vike's equivalent of middleware for pages.
 *
 * Runs server-side before the page renders. If the check fails, Vike
 * aborts the render and shows the error page (or redirects).
 *
 * In a real app, check a session cookie or JWT here.
 * Forge's resolve() works here too — you can inject AuthService, etc.
 *
 * Test:
 *   /users              → 401 (no token)
 *   /users?token=valid  → 200 (renders page)
 */
export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!isAuthenticated(pageContext)) {
    // Option A — render the error page with 401
    throw render(401, 'You must be logged in to view this page.')

    // Option B — redirect to a login page
    // throw redirect('/login')
  }
}

function isAuthenticated(pageContext: { urlParsed: { search: Record<string, string> } }): boolean {
  // Demo only: check for ?token=valid query param.
  // In production, check a session cookie or JWT:
  //   const session = await resolve<SessionService>(SessionService).verify(pageContext.cookies?.session)
  return pageContext.urlParsed.search['token'] === 'valid'
}
