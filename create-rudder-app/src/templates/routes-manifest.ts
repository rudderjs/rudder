import type { TemplateContext } from '../templates.js'

/**
 * One URL the render smoke should hit. Generated from the scaffolder profile
 * via {@link getProfileRoutes} — each contributor (welcome, auth, an admin
 * dashboard) lists its routes here so a Playwright pass can iterate them
 * without a per-profile hand table.
 */
export interface RouteSpec {
  /** URL path the server is expected to serve. */
  path:            string
  /**
   * Symbolic source — used in failure messages to attribute the broken route
   * to the package or template fragment that contributed it.
   */
  contributedBy:   string
  /** Substring asserted in the response HTML. Skipped when omitted. */
  ssrMarker?:      string
  /** Expected HTTP status. Defaults to 200. */
  expectedStatus?: number
}

/**
 * Map a scaffolder profile (TemplateContext) → the set of URLs that should
 * render in the booted app. Stays in lockstep with {@link routesWeb} and the
 * per-package route registrations so adding a new package + its route shows up
 * here and in the render-check.
 */
export function getProfileRoutes(ctx: TemplateContext): RouteSpec[] {
  const routes: RouteSpec[] = []
  const hasFrontend = ctx.frameworks.length >= 1

  if (hasFrontend) {
    // Welcome page exists only for single-framework projects (routes/web.ts
    // gates on `ctx.frameworks.length === 1`). Multi-framework scaffolds use
    // pages/index/+Page.* instead, which also serves `/` — covered separately.
    const welcomeRoute: RouteSpec = { path: '/', contributedBy: 'welcome' }
    if (ctx.frameworks.length === 1) welcomeRoute.ssrMarker = 'Built with RudderJS'
    routes.push(welcomeRoute)
  }
  // No-frontend (api-service) profile manifest TODO — the scaffold can't
  // build today because Vike requires at least one page. Until that's fixed,
  // there's no booting api-service to drive a manifest against.

  // Auth UI — login/register/forgot-password. RequireGuest middleware lets the
  // pages through for an unauthenticated session (which is what the smoke has).
  // Markers come from packages/auth/views/<framework>/. Only react has vendored
  // views today; vue/solid scaffolds resolve to a missing view at boot. The
  // smoke's auth-view copy step (mirrors index.ts) only fires for react, so we
  // gate the manifest the same way to avoid asserting on routes whose template
  // never reached the project. Skipped on API-only profiles (no frontend → no
  // auth pages even when the package is selected for POST endpoints only).
  if (hasFrontend && ctx.packages.auth && ctx.primary === 'react') {
    routes.push(
      { path: '/login',           contributedBy: 'auth', ssrMarker: 'Welcome back' },
      { path: '/register',        contributedBy: 'auth', ssrMarker: 'Create an account' },
      { path: '/forgot-password', contributedBy: 'auth', ssrMarker: 'Forgot password' },
    )
  }

  // Admin dashboards — scaffolder configs leave them publicly mounted (no
  // auth middleware), so an unauthenticated session can reach them. The title
  // bar substring is a cheap SSR marker that won't false-fire on the welcome
  // page or a 404.
  if (ctx.packages.telescope) routes.push({ path: '/telescope', contributedBy: 'telescope', ssrMarker: 'Telescope' })
  if (ctx.packages.pulse)     routes.push({ path: '/pulse',     contributedBy: 'pulse',     ssrMarker: 'Pulse' })
  if (ctx.packages.horizon)   routes.push({ path: '/horizon',   contributedBy: 'horizon',   ssrMarker: 'Horizon' })

  return routes
}
