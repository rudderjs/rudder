# @rudderjs/auth

Laravel-style authentication for RudderJS — guards, user providers, the `Auth` facade, password reset, email verification, and a Gate/Policy authorization system. Ships with session-based auth out of the box; token-based API auth lives in [`@rudderjs/passport`](../passport).

## Installation

```bash
pnpm add @rudderjs/auth @rudderjs/hash @rudderjs/session
```

## Setup

### 1. Config

```ts
// config/auth.ts
import { User } from '../app/Models/User.js'
import type { AuthConfig } from '@rudderjs/auth'

export default {
  defaults: {
    guard: 'web',
  },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: User },
  },
} satisfies AuthConfig
```

### 2. Register the provider

`hash()` must come before `authProvider()`, and `session()` must be installed — both are peer dependencies.

```ts
// bootstrap/providers.ts
import { session }       from '@rudderjs/session'
import { hash }          from '@rudderjs/hash'
import { authProvider }  from '@rudderjs/auth'
import configs from '../config/index.js'

export default [
  session(configs.session),
  hash(configs.hash),
  authProvider(configs.auth),
]
```

> `authProvider()` is the **service provider factory**. `auth()` (lowercase) is the **per-request helper** — see below.

The provider auto-installs `AuthMiddleware` on the `web` route group, so every web request has `req.user` populated before your handler runs. API routes stay stateless — opt into token auth per-route with `@rudderjs/passport`.

---

## Reading the current user

Three equivalent shapes, pick whichever reads best at the call site:

```ts
import { auth, Auth } from '@rudderjs/auth'

// 1. `auth()` helper — Laravel's `auth()->user()`
const user = await auth().user()
const ok   = await auth().check()
const admin = await auth().guard('api').user()  // non-default guard

// 2. `Auth` facade — same thing, static methods
const user = await Auth.user()
const ok   = await Auth.check()

// 3. `req.user` — populated on every web request, zero await
Route.get('/profile', async (req) => {
  return { user: req.user ?? null }
})
```

On API routes `req.user` is `undefined` by default — `AuthMiddleware` only runs on the `web` group. For token-based API auth see [`@rudderjs/passport`](../passport).

---

## Login and logout

```ts
// Attempt with credentials
const success = await Auth.attempt({ email, password })

// Manual login (after a sign-up flow, social login, etc.)
await Auth.login(user)

// Logout
await Auth.logout()
```

`attempt()` calls `hashCheck()` via `@rudderjs/hash` to verify the password. `login()` regenerates the session ID to prevent session fixation.

---

## Route protection

```ts
import { RequireAuth, RequireGuest, EnsureEmailIsVerified } from '@rudderjs/auth'

// 401 if not logged in
Route.post('/posts', handler, [RequireAuth()])

// Bounce already-logged-in users away (e.g. /login, /register)
Route.get('/login', showLogin, [RequireGuest('/')])

// Require verified email (403 if unverified)
Route.get('/dashboard', handler, [RequireAuth(), EnsureEmailIsVerified()])
```

### `AuthMiddleware` — advanced only

You don't normally attach `AuthMiddleware` manually — the provider installs it on the `web` group. Reach for it when you need a non-default guard on a specific route:

```ts
import { AuthMiddleware } from '@rudderjs/auth'

// The RudderJS equivalent of Laravel's ->middleware('auth:api')
Route.get('/admin/stats', handler, [
  AuthMiddleware('api'),
  RequireAuth('api'),
])
```

---

## Guards & User Providers

**Guards** determine *how* users are authenticated (session cookies, API tokens). **User providers** determine *where* users are retrieved from (an ORM model, a raw DB query, a remote service).

### Built-in guards

| Guard | Driver | Description |
|---|---|---|
| Session | `session` | Cookie-based auth via `@rudderjs/session` |

Token-based guards ship in `@rudderjs/passport` (bearer tokens with OAuth 2 scopes).

### Built-in providers

| Provider | Driver | Description |
|---|---|---|
| Eloquent | `eloquent` | Retrieves users from an `@rudderjs/orm` Model |

### Authenticatable contract

Your User model must implement:

```ts
interface Authenticatable {
  getAuthIdentifier(): string
  getAuthPassword():   string
  getRememberToken():  string | null
  setRememberToken(token: string): void
}
```

The `EloquentUserProvider` auto-wraps ORM model records with these methods — you only implement the interface if you need custom behavior.

---

## Authorization (Gates & Policies)

Define abilities globally, or bundle them into policy classes per model.

### Gates

```ts
import { Gate } from '@rudderjs/auth'

// In a provider's boot()
Gate.define('edit-post', (user, post) => user.id === post.authorId)
Gate.before((user) => user.isAdmin ? true : undefined)   // admin override

// In a handler
await Gate.authorize('edit-post', post)            // throws AuthorizationError (403)
if (await Gate.allows('edit-post', post)) { ... }
if (await Gate.denies('edit-post', post)) { ... }

// Scoped to a specific user
await Gate.forUser(someUser).allows('edit-post', post)
```

### Policies

Policies are classes with method names matching ability names — cleaner for models with many abilities:

```ts
import { Policy } from '@rudderjs/auth'

class PostPolicy extends Policy {
  before(user: Authenticatable) { return user.isAdmin ? true : undefined }

  update(user: Authenticatable, post: Post) { return user.id === post.authorId }
  delete(user: Authenticatable, post: Post) { return user.id === post.authorId }
}

// Register in a provider
Gate.policy(Post, PostPolicy)

// Use the same way as gates
await Gate.authorize('update', post)
```

---

## Password reset

Uses the `PasswordBroker` with a token repository:

```ts
import { PasswordBroker, MemoryTokenRepository } from '@rudderjs/auth'

// Send reset link
const ok = await PasswordBroker.sendResetLink({ email }, (user, token) => {
  const url = `https://app.example.com/reset-password?token=${token}&email=${user.email}`
  return Mail.to(user.email).send(new PasswordResetMail(url))
})

// Reset password on the receiving end
await PasswordBroker.reset({ email, token, password }, async (user, password) => {
  await User.update(user.id, { password: await hash(password) })
})
```

The default token repository is `MemoryTokenRepository` — fine for dev, not for production. Implement `TokenRepository` over Redis or a DB table for real use.

---

## Email verification

Implement `MustVerifyEmail` on your User model:

```ts
import type { MustVerifyEmail } from '@rudderjs/auth'

class User extends Model implements Authenticatable, MustVerifyEmail {
  hasVerifiedEmail() { return this.emailVerifiedAt !== null }
  async markEmailAsVerified() {
    await User.update(this.id, { emailVerifiedAt: new Date().toISOString() })
  }
  getEmailForVerification() { return this.email }
}
```

Generate a signed verification URL (1-hour expiry) and handle it on the receiving route:

```ts
import { verificationUrl, handleEmailVerification } from '@rudderjs/auth'
import { ValidateSignature } from '@rudderjs/router'

const url = verificationUrl(user)

Route.get('/email/verify/:id/:hash', async (req, res) => {
  const verified = await handleEmailVerification(
    req.params.id,
    req.params.hash,
    (id) => User.find(id),
  )
  verified
    ? res.json({ message: 'Email verified.' })
    : res.status(400).json({ message: 'Invalid verification link.' })
}, [ValidateSignature()]).name('verification.verify')
```

---

## Auth views & routes

`@rudderjs/auth` ships presentational view components under `views/react/` and `views/vue/`. Publish them into your project, then wire the routes:

```bash
pnpm rudder vendor:publish --tag=auth-views
# → app/Views/Auth/{Login,Register,ForgotPassword,ResetPassword}.tsx
```

```ts
// routes/web.ts — middleware groups cover session + CSRF globally on the web group
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route)
```

`registerAuthRoutes` registers these GET pages, each guarded by `RequireGuest`:

| View | Path | Description |
|------|------|-------------|
| Login | `/login` | Email/password sign-in form |
| Register | `/register` | New user registration form |
| Forgot Password | `/forgot-password` | Request a password reset email |
| Reset Password | `/reset-password?token=...` | Set a new password with a token |

POST submit handlers (`/api/auth/sign-in/email`, `/api/auth/sign-up/email`, sign-out, etc.) live with your `AuthController`. Customize any view by editing `app/Views/Auth/Login.tsx` — the package doesn't own them after publish.

The login page supports a `?redirect=/dashboard` query parameter — the user is sent there after successful authentication.

---

## API Reference

### `authProvider(config)`

Service provider factory. Installs `AuthMiddleware` on the `web` group, resolves the configured guard and user provider, binds `AuthManager` as `'auth.manager'` in the container.

### `auth()` / `Auth`

Request-scoped helpers via `AsyncLocalStorage`. Available inside any handler or middleware wrapped by `AuthMiddleware`. Both return the same underlying guard — pick whichever reads best.

### `AuthMiddleware(guard?)` / `RequireAuth(guard?)` / `RequireGuest(redirectTo?)`

Middleware factories. `AuthMiddleware` populates `req.user` without blocking; `RequireAuth` returns 401 when unauthenticated; `RequireGuest` redirects logged-in users away from auth-only routes.

### `Gate` / `Policy` / `AuthorizationError`

Static Gate facade. `Gate.define()`, `Gate.policy()`, `Gate.before()` register; `Gate.authorize()`, `Gate.allows()`, `Gate.denies()` check; `Gate.forUser()` scopes to a specific user. `AuthorizationError` is thrown as a 403.

### Types

```ts
import type {
  Authenticatable,
  AuthUser,
  Guard,
  UserProvider,
  AuthConfig,
  MustVerifyEmail,
} from '@rudderjs/auth'
```

---

## Common pitfalls

- **Provider order**: `hash()` must come before `authProvider()` or boot throws.
- **Missing session**: `@rudderjs/session` is a required peer. Provider boot installs session on the `web` group; don't duplicate it via `m.use(sessionMiddleware(...))` — you'll end up with two `SessionInstance`s and lose your data between requests.
- **`Auth.user()` outside a request**: `auth()` and `Auth` read from `AsyncLocalStorage` — they throw outside the `AuthMiddleware` scope. `SessionGuard.user()` soft-fails with `null` instead (matches Laravel's `Auth::user()` semantics), which is what the facade uses.
- **`req.user` is `undefined` on api routes**: expected. `AuthMiddleware` runs only on the `web` group. For api auth reach for `@rudderjs/passport` (`RequireBearer()` + `scope(...)`).
- **Ghost signed-in user across requests**: `AuthManager` must NOT cache `SessionGuard` instances — the manager is process-wide, and a cached guard's `_user` field leaks between requests. Don't reintroduce the `_guards` Map.
- **Password field in `req.user`**: `userToPlain()` removes `password` automatically — you never see it on the request.

---

## Related

- [`@rudderjs/passport`](../passport) — OAuth 2 server + bearer token middleware for API auth
- [`@rudderjs/session`](../session) — session store (cookie or Redis)
- [`@rudderjs/hash`](../hash) — password hashing
