import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { RequireGuest } from '@rudderjs/auth'
import { AuthController } from '../app/Controllers/AuthController.js'

// Auth routes — Laravel Breeze-style. Loaded from routes/web.ts via side-effect
// import so they're tagged with the `web` group and inherit session + auth
// middleware. The POST endpoints live at /api/auth/... but still need session
// for Auth.attempt / Auth.login to persist state.
//
// `@rudderjs/auth` also ships a `registerAuthRoutes(Route, { … })` helper for
// one-line wiring — inlined here for visibility.

// CSRF + RequireGuest — signed-in users visiting /login get bounced to '/'.
// SessionMiddleware + AuthMiddleware are auto-installed on the web group.
const guestOnly = [CsrfMiddleware(), RequireGuest('/')]

// ── GET view pages ─────────────────────────────────────────
Route.get('/login', async () =>
  view('auth.login', {
    registerUrl:       '/register',
    forgotPasswordUrl: '/forgot-password',
    homeUrl:           '/',
  }),
  guestOnly,
)

Route.get('/register', async () =>
  view('auth.register', {
    loginUrl: '/login',
    homeUrl:  '/',
  }),
  guestOnly,
)

Route.get('/forgot-password', async () =>
  view('auth.forgot-password', {
    loginUrl:         '/login',
    resetPasswordUrl: '/reset-password',
  }),
  guestOnly,
)

Route.get('/reset-password', async () =>
  view('auth.reset-password', {
    loginUrl:          '/login',
    forgotPasswordUrl: '/forgot-password',
  }),
  guestOnly,
)

// ── POST handlers ──────────────────────────────────────────
// /api/auth/sign-{up,in,out}/…, /request-password-reset, /reset-password
Route.registerController(AuthController)
