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

The auth provider auto-installs `AuthMiddleware` on the `web` route group, so every authenticated web request has `req.user` populated before your handler runs (unauthenticated requests leave it unset). API routes stay stateless.

## Reading the current user

Three equivalent shapes — pick whichever reads best at the call site:

```ts
import { auth, Auth } from '@rudderjs/auth'

const user = await auth().user()           // helper — request-scoped
const user = await Auth.user()             // facade — same thing
const user = req.user                      // populated on every web request
```

`auth()` and `Auth` read from AsyncLocalStorage. They work in any handler, service, or middleware that runs inside the `AuthMiddleware` scope. Outside that scope they throw — see [Request Lifecycle](/guide/lifecycle).

`Auth.user()` returns `null` when an auth context is present but nobody is signed in. With no auth context at all (a script, a `boot()` hook, a route outside `AuthMiddleware`) it throws like the rest of the facade. Use `Auth.check()` for a boolean.

## Login and logout

```ts
const ok = await Auth.attempt({ email, password })   // returns boolean
await Auth.login(user)                                // after sign-up or social login
await Auth.logout()
```

`attempt()` verifies the password via `@rudderjs/hash`. `login()` regenerates the session ID to prevent session fixation.

## Remember me (persistent login)

Pass `true` as the second argument to `attempt()` or `login()` to issue a persistent remember-me cookie:

```ts
const ok = await Auth.attempt({ email, password }, true)  // remember-me login
await Auth.login(user, true)                               // after sign-up / social login
```

`logout()` always invalidates the cookie, regardless of whether remember-me was used.

### What happens under the hood

1. A 256-bit random token is generated, stored on the `rememberToken` column, and a long-lived signed cookie (`rudderjs_remember`, default 400 days) is written to the response.
2. On a later request with no session but a valid remember cookie, `AuthMiddleware` decodes the cookie, looks the user up by id, constant-time-compares the stored token, and re-establishes the session automatically.
3. The token is **not rotated per request** — it changes only on a fresh remember-login or on logout. Multiple devices share the same token, so a single `logout()` invalidates all of them at once (matching Laravel's behaviour).

### Requirements

**`rememberToken` column** — your users table needs this column:

```ts
// database/migrations/xxxx_create_users_table.ts
Schema.create('users', (table) => {
  table.id()
  table.string('email').unique()
  table.string('password')
  table.string('rememberToken').nullable()  // required for remember-me
  table.timestamps()
})
```

The `EloquentUserProvider` maps this column automatically. If you wrote a custom `UserProvider`, implement the two optional methods on the `UserProvider` contract:

```ts
async retrieveByToken(userId: string, token: string): Promise<Authenticatable | null>
async updateRememberToken(userId: string, token: string | null): Promise<void>
```

**`AUTH_SECRET` env var** — the remember cookie is HMAC-signed. In production the framework throws at sign-time if `AUTH_SECRET` is unset; in development it falls back to a placeholder and logs a notice. Set it to any random string of 32+ characters:

```
AUTH_SECRET=your-32-char-or-longer-random-secret-here
```

The same variable is used by `PasswordBroker` for reset tokens, so if you already have it set for password reset, remember-me works without any extra config.

## Lifecycle events

The guard and auth controller dispatch typed events at every auth transition through the [event bus](./events.md), mirroring Laravel's auth events. Hook them for audit logging, welcome emails, clearing other device sessions, presence broadcasting, or Telescope/Horizon integration — without subclassing or monkey-patching the guard.

| Event | Fired when | Payload |
|---|---|---|
| `Attempting` | before credentials are checked | `credentials`, `remember` |
| `Validated` | credentials matched, before the session is written | `user` |
| `Login` | a session is established (`login`, `attempt`, remember-cookie resume) | `user`, `remember` |
| `Failed` | a credential check fails | `credentials`, `user` (the matched user on a wrong password, else `null`) |
| `Logout` | a user is logged out | `user` (or `null`) |
| `Registered` | a new account is created via `BaseAuthController.signUp` | `user` |
| `PasswordReset` | a password reset completes | `user` |

Register listeners in `bootstrap/providers.ts`:

```ts
import { eventsProvider } from '@rudderjs/core'
import { Login, Failed, Registered } from '@rudderjs/auth'

export default [
  // ...defaultProviders
  eventsProvider({
    Login:      [LogSuccessfulLogin],
    Failed:     [LogFailedLogin],
    Registered: [SendWelcomeEmail],
  }),
]
```

A listener is any object with a `handle(event)` method:

```ts
import type { Listener } from '@rudderjs/core'
import type { Login } from '@rudderjs/auth'

export class LogSuccessfulLogin implements Listener<Login> {
  async handle(event: Login) {
    console.log(`User ${event.user.getAuthIdentifier()} logged in (remember=${event.remember})`)
  }
}
```

`attempt()` fires `Attempting` → `Validated` → `Login` on success, and `Attempting` → `Failed` on failure. `once()` (request-only auth, no session write) fires `Attempting`/`Validated`/`Failed` but never `Login`. With no listeners registered, every dispatch is a cheap no-op.

## Route protection

Three middleware factories cover the common cases:

```ts
import { RequireAuth, RequireGuest, EnsureEmailIsVerified } from '@rudderjs/auth'

Route.post('/posts',     handler, [RequireAuth()])
Route.get ('/login',     showLogin, [RequireGuest('/')])
Route.get ('/dashboard', handler, [RequireAuth(), EnsureEmailIsVerified()])
```

`RequireAuth` returns a 401 JSON response when nobody is signed in. `RequireGuest` redirects already-authenticated users away from sign-in pages. `EnsureEmailIsVerified` returns 403 until the user verifies.

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

## Auth controller

`BaseAuthController` gives you the five auth POST endpoints without writing handler bodies. Subclass it, point it at your User model and hash service, and register it from the `web` group:

```ts
// app/Http/Controllers/AuthController.ts
import {
  BaseAuthController,
  PasswordBroker,
  MemoryTokenRepository,
  EloquentUserProvider,
  type AuthUserModelLike,
} from '@rudderjs/auth'
import { Hash } from '@rudderjs/hash'
import { User } from 'App/Models/User.js'

export class AuthController extends BaseAuthController {
  protected userModel = User as unknown as AuthUserModelLike
  protected hash      = Hash

  // Optional. Enables /auth/request-password-reset + /auth/reset-password.
  // Leave it unset and those two routes return an enumeration-safe stub
  // instead of sending mail. Swap MemoryTokenRepository for a persistent
  // store (Prisma/Redis) in production.
  protected passwordBroker = new PasswordBroker(
    new MemoryTokenRepository(),
    new EloquentUserProvider(User as unknown as never, (plain, hashed) => Hash.check(plain, hashed)),
    { secret: process.env.AUTH_SECRET ?? '' },
  )
}
```

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { AuthController } from 'App/Http/Controllers/AuthController.js'

Route.registerController(AuthController)
```

Register from `web` so `AuthMiddleware` and `SessionMiddleware` are in scope, which lets `Auth.attempt` / `Auth.login` read and write the session. Only `userModel` and `hash` are required; everything else has a default.

### Endpoints

| Method + path | Handler | Body | Behavior |
|---|---|---|---|
| `POST /auth/sign-in/email` | `signIn` | `email`, `password`, `remember?` | 422 on missing fields, 401 on bad credentials |
| `POST /auth/sign-up/email` | `signUp` | `name?`, `email`, `password` | 422 if password < 8 chars, 409 on duplicate email; signs the user in and fires `Registered` |
| `POST /auth/sign-out` | `signOut` | none | logs out, clears the session |
| `POST /auth/request-password-reset` | `requestPasswordReset` | `email` | always `{ status: 'sent' }` (enumeration-safe); sends mail only when `passwordBroker` is set |
| `POST /auth/reset-password` | `resetPassword` | `token`, `email`, `newPassword` | 400 on an invalid/expired token, 500 if no `passwordBroker` |

The published [auth views](#auth-views) POST to exactly these paths, so a vendored login/register form works against this controller with no extra wiring. To send real reset emails, set `passwordBroker` (see [Password reset](#password-reset)); leave it unset and `requestPasswordReset` returns its stub without sending mail (in development it logs a one-line warning so the gap is visible).

### Rate limits

The controller applies per-method limits out of the box via `DEFAULT_AUTH_RATE_LIMITS`:

| Method | Default | Keyed by |
|---|---|---|
| `signIn` | 10 / minute | IP |
| `signUp` | 5 / minute | IP |
| `requestPasswordReset` | 3 / minute | submitted email (falls back to IP) |

Override per method with the static `rateLimits` field. Spread the defaults and replace only the ones you want:

```ts
import { RateLimit } from '@rudderjs/middleware'
import { BaseAuthController, DEFAULT_AUTH_RATE_LIMITS } from '@rudderjs/auth'

export class AuthController extends BaseAuthController {
  protected userModel = User as unknown as AuthUserModelLike
  protected hash      = Hash

  static override rateLimits = {
    ...DEFAULT_AUTH_RATE_LIMITS,
    signIn: RateLimit.perMinute(3).message('Too many login attempts.'),
  }
}
```

Set `static override rateLimits = {}` to disable rate limiting entirely (for example an internal admin panel already behind VPN auth). The field is read once when the controller is first registered, so mutating it afterward has no effect. `RateLimit` needs a [cache provider](./cache.md) registered, or it silently passes through.

## Password reset

The `PasswordBroker` orchestrates token generation, email sending, and consumption:

```ts
import { PasswordBroker, MemoryTokenRepository } from '@rudderjs/auth'
import { Hash } from '@rudderjs/hash'
import { Mail } from '@rudderjs/mail'

const broker = new PasswordBroker(new MemoryTokenRepository(), userProvider, {
  secret: process.env.AUTH_SECRET,   // required in production — throws without it
})

await broker.sendResetLink({ email }, (user, token) => {
  const url = `https://app.example.com/reset-password?token=${token}&email=${user.email}`
  return Mail.to(user.email).send(new PasswordResetMail(url))
})

await broker.reset({ email, token, password }, async (user, password) => {
  await User.update(user.id, { password: await Hash.make(password) })
})
```

`userProvider` is the same `UserProvider` your guard uses (resolve it from the auth manager or construct an `EloquentUserProvider` over your User model). `MemoryTokenRepository` is in-memory — fine for development. For production, implement `TokenRepository` over Redis or a database table.

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

Route.get('/api/posts', handler, [RequireBearer(), scope('read')])
```

For lighter token auth without OAuth, `@rudderjs/sanctum` (simple API token issuance and verification) is the alternative.

## Pitfalls

- **Provider order.** `HashProvider` must precede `AuthProvider`; `SessionProvider` must be installed. Auto-discovery handles this — manual orderings need it spelled out.
- **`Auth.user()` outside a request.** `auth()` reads from AsyncLocalStorage and only works inside `AuthMiddleware`. Calling it from a script or a `boot()` hook throws.
- **`req.user` undefined on API routes.** Expected — the auth middleware is on the `web` group only. Use `RequireBearer()` from `@rudderjs/passport`.
- **Ghost user across requests.** `AuthManager` must not cache `SessionGuard` instances — the manager is process-wide, and a cached guard's `_user` field leaks between requests. Don't reintroduce the `_guards` Map (the framework dropped it for this reason).
- **Duplicating session middleware.** The provider installs session on the `web` group automatically. Don't add `m.use(sessionMiddleware(...))` globally — you'll get two `SessionInstance`s and lose data between requests.
