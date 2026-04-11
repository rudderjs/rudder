import type { Router } from '@rudderjs/router'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { view } from '@rudderjs/view'
import { RequireGuest } from './require-guest.js'

export interface RegisterAuthRoutesOptions {
  /** View ids override — default: `auth.login`, `auth.register`, `auth.forgot-password`, `auth.reset-password`. */
  views?: {
    login?:         string
    register?:      string
    forgotPassword?: string
    resetPassword?:  string
  }
  /** Route path override — default: `/login`, `/register`, `/forgot-password`, `/reset-password`. */
  paths?: {
    login?:         string
    register?:      string
    forgotPassword?: string
    resetPassword?:  string
  }
  /** Where to redirect already-authenticated users visiting a guest page. */
  homeUrl?: string
  /** Extra middleware to prepend to all guest routes (e.g. CsrfMiddleware). */
  middleware?: MiddlewareHandler[]
  /** Disable RequireGuest (useful in tests). */
  allowAuthenticated?: boolean
}

/**
 * Register auth UI routes (login, register, forgot-password, reset-password) on a router.
 *
 * View files must exist under `app/Views/Auth/` in the consumer project — either
 * hand-vendored from `@rudderjs/auth/views/react/` (v1) or published via
 * `vendor:publish --tag=auth-views` (v2).
 *
 * POST submit handlers are NOT registered here — they live with the consumer's
 * existing `/api/auth/*` endpoints (e.g. `/api/auth/sign-in/email`).
 *
 * Example:
 * ```ts
 * import { Route } from '@rudderjs/router'
 * import { registerAuthRoutes } from '@rudderjs/auth/routes'
 * registerAuthRoutes(Route)
 * ```
 */
export function registerAuthRoutes(
  router: Router,
  opts: RegisterAuthRoutesOptions = {},
): void {
  const homeUrl = opts.homeUrl ?? '/'
  const paths   = {
    login:          opts.paths?.login          ?? '/login',
    register:       opts.paths?.register       ?? '/register',
    forgotPassword: opts.paths?.forgotPassword ?? '/forgot-password',
    resetPassword:  opts.paths?.resetPassword  ?? '/reset-password',
  }
  const views = {
    login:          opts.views?.login          ?? 'auth.login',
    register:       opts.views?.register       ?? 'auth.register',
    forgotPassword: opts.views?.forgotPassword ?? 'auth.forgot-password',
    resetPassword:  opts.views?.resetPassword  ?? 'auth.reset-password',
  }

  const guestOnly: MiddlewareHandler[] = [
    ...(opts.middleware ?? []),
    ...(opts.allowAuthenticated ? [] : [RequireGuest(homeUrl)]),
  ]

  router.get(paths.login,          async () => view(views.login,          { registerUrl: paths.register, forgotPasswordUrl: paths.forgotPassword, homeUrl }), guestOnly)
  router.get(paths.register,       async () => view(views.register,       { loginUrl: paths.login, homeUrl }), guestOnly)
  router.get(paths.forgotPassword, async () => view(views.forgotPassword, { loginUrl: paths.login, resetPasswordUrl: paths.resetPassword }), guestOnly)
  router.get(paths.resetPassword,  async () => view(views.resetPassword,  { loginUrl: paths.login, forgotPasswordUrl: paths.forgotPassword }), guestOnly)
}
