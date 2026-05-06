# Authentication

`@rudderjs/auth` is the framework's authentication system: guards, user providers, session login, password reset, email verification, and the `Auth` facade. It pairs with `@rudderjs/session` for cookie-based web auth and with `@rudderjs/passport` for token-based API auth.

## Setup

Install the trio:

```bash
pnpm add @rudderjs/auth @rudderjs/session @rudderjs/hash
```

Add the config:

```ts
// config/auth.ts
import { User } from '../app/Models/User.js'
import type { AuthConfig } from '@rudderjs/auth'

export default {
  defaults:  { guard: 'web' },
  guards:    { web: { driver: 'session', provider: 'users' } },
  providers: { users: { driver: 'eloquent', model: User } },
} satisfies AuthConfig
```

`HashProvider` must boot before `AuthProvider`, and `SessionProvider` must be installed — both are peer dependencies. Auto-discovery wires this correctly when all three packages are installed.

```ts
// bootstrap/providers.ts (manual order, when not using auto-discovery)
import { SessionProvider } from '@rudderjs/session'
import { HashProvider } from '@rudderjs/hash'
import { AuthProvider } from '@rudderjs/auth'

export default [
  SessionProvider,
  HashProvider,
  AuthProvider,
]
```

The auth provider auto-installs `AuthMiddleware` on the `web` route group, so every web request has `req.user` populated before your handler runs. API routes stay stateless.

## Reading the current user

Three equivalent shapes — pick whichever reads best at the call site:

```ts
import { auth, Auth } from '@rudderjs/auth'

const user = await auth().user()           // helper — request-scoped
const user = await Auth.user()             // facade — same thing
const user = req.user                      // populated on every web request
```

`auth()` and `Auth` read from AsyncLocalStorage. They work in any handler, service, or middleware that runs inside the `AuthMiddleware` scope. Outside that scope they throw — see [Request Lifecycle](/guide/lifecycle).

`Auth.user()` soft-fails to `null` if there's no auth context, matching the facade convention. Use `Auth.check()` for a boolean.

## Login and logout

```ts
const ok = await Auth.attempt({ email, password })   // returns boolean
await Auth.login(user)                                // after sign-up or social login
await Auth.logout()
```

`attempt()` verifies the password via `@rudderjs/hash`. `login()` regenerates the session ID to prevent session fixation.

## Route protection

Three middleware factories cover the common cases:

```ts
import { RequireAuth, RequireGuest, EnsureEmailIsVerified } from '@rudderjs/auth'

Route.post('/posts',     handler, [RequireAuth()])
Route.get ('/login',     showLogin, [RequireGuest('/')])
Route.get ('/dashboard', handler, [RequireAuth(), EnsureEmailIsVerified()])
```

`RequireAuth` returns 401 (or redirects to `/login` for HTML requests). `RequireGuest` redirects already-authenticated users away from sign-in pages. `EnsureEmailIsVerified` returns 403 until the user verifies.

For non-default guards on a specific route, mount `AuthMiddleware('api')` explicitly before `RequireAuth('api')`.

## Auth views

`@rudderjs/auth` ships presentational components for login, register, forgot-password, and reset-password. Publish them into your app and wire the routes:

```bash
pnpm rudder vendor:publish --tag=auth-views
# → app/Views/Auth/{Login,Register,ForgotPassword,ResetPassword}.{tsx,vue}
```

```ts
// routes/web.ts
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route)
```

`registerAuthRoutes` mounts:

| View | URL | Notes |
|---|---|---|
| Login | `/login` | Email/password sign-in; supports `?redirect=/dashboard` |
| Register | `/register` | New user form |
| Forgot Password | `/forgot-password` | Request reset email |
| Reset Password | `/reset-password?token=…` | Set a new password |

POST handlers (`/auth/sign-in/email`, `/auth/sign-up/email`, `/auth/sign-out`, `/auth/request-password-reset`, `/auth/reset-password`) live on your `AuthController` (extends `BaseAuthController`). The published views are yours to edit — the package doesn't own them after publish.

## Password reset

The `PasswordBroker` orchestrates token generation, email sending, and consumption:

```ts
import { PasswordBroker } from '@rudderjs/auth'
import { Mail } from '@rudderjs/mail'

await PasswordBroker.sendResetLink({ email }, (user, token) => {
  const url = `https://app.example.com/reset-password?token=${token}&email=${user.email}`
  return Mail.to(user.email).send(new PasswordResetMail(url))
})

await PasswordBroker.reset({ email, token, password }, async (user, password) => {
  await User.update(user.id, { password: await hash(password) })
})
```

The default token store is in-memory — fine for development. For production, implement `TokenRepository` over Redis or a database table.

## Email verification

Implement `MustVerifyEmail` on your User model:

```ts
import type { Authenticatable, MustVerifyEmail } from '@rudderjs/auth'

class User extends Model implements Authenticatable, MustVerifyEmail {
  hasVerifiedEmail()  { return this.emailVerifiedAt !== null }
  async markEmailAsVerified() {
    await User.update(this.id, { emailVerifiedAt: new Date() })
  }
  getEmailForVerification() { return this.email }
}
```

Then issue a signed verification URL (1-hour expiry) and handle it on the receiving route:

```ts
import { verificationUrl, handleEmailVerification } from '@rudderjs/auth'
import { ValidateSignature } from '@rudderjs/router'

const url = verificationUrl(user)

Route.get('/email/verify/:id/:hash', async (req, res) => {
  const ok = await handleEmailVerification(req.params.id, req.params.hash, (id) => User.find(id))
  return ok
    ? res.json({ message: 'Email verified.' })
    : res.status(400).json({ message: 'Invalid link.' })
}, [ValidateSignature()]).name('verification.verify')
```

## API authentication

`req.user` is undefined on API routes — `AuthMiddleware` runs only on the `web` group. For token-based API auth, install `@rudderjs/passport` (OAuth 2 server + bearer middleware) and gate routes with `RequireBearer()`:

```ts
import { RequireBearer, scope } from '@rudderjs/passport'

Route.get('/api/posts', [RequireBearer(), scope('read')], handler)
```

For lighter token auth without OAuth, `@rudderjs/sanctum` (simple API token issuance and verification) is the alternative.

## Pitfalls

- **Provider order.** `HashProvider` must precede `AuthProvider`; `SessionProvider` must be installed. Auto-discovery handles this — manual orderings need it spelled out.
- **`Auth.user()` outside a request.** `auth()` reads from AsyncLocalStorage and only works inside `AuthMiddleware`. Calling it from a script or a `boot()` hook throws.
- **`req.user` undefined on API routes.** Expected — the auth middleware is on the `web` group only. Use `RequireBearer()` from `@rudderjs/passport`.
- **Ghost user across requests.** `AuthManager` must not cache `SessionGuard` instances — the manager is process-wide, and a cached guard's `_user` field leaks between requests. Don't reintroduce the `_guards` Map (the framework dropped it for this reason).
- **Duplicating session middleware.** The provider installs session on the `web` group automatically. Don't add `m.use(sessionMiddleware(...))` globally — you'll get two `SessionInstance`s and lose data between requests.
