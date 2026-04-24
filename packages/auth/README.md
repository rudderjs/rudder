# @rudderjs/auth

Native authentication for RudderJS. Laravel-style guards, user providers, and Auth facade.

## Installation

```bash
pnpm add @rudderjs/auth @rudderjs/hash @rudderjs/session
```

## Setup

```ts
// config/auth.ts
import { User } from '../app/Models/User.js'

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
}

// bootstrap/providers.ts
import { session } from '@rudderjs/session'
import { hash } from '@rudderjs/hash'
import { authProvider } from '@rudderjs/auth'

export default [
  session(configs.session),
  hash(configs.hash),
  authProvider(configs.auth),
]
```

> `authProvider()` is the service-provider factory.
> `auth()` (lowercase) is the per-request helper — see below.

## Usage

### Reading the current user

Three equivalent shapes, pick whichever reads best at the call site:

```ts
import { auth, Auth } from '@rudderjs/auth'

// 1. `auth()` helper — Laravel's `auth()->user()`
const user = await auth().user()
const ok   = await auth().check()
const user = await auth().guard('api').user()  // non-default guard

// 2. `Auth` facade — same thing, static methods
const user = await Auth.user()
const ok   = await Auth.check()

// 3. `req.user` — populated on every request, zero await
Route.get('/profile', async (req) => {
  return { user: req.user ?? null }
})
```

**No per-route wiring needed on web routes.** `authProvider()` auto-installs
`AuthMiddleware` on the `web` route group during `boot()`, so every request
matched by `withRouting({ web })` has the auth context populated before your
handler runs.

**API routes stay stateless.** `AuthMiddleware` does not run on the `api` group
by default — `req.user` will be `undefined`, and `Auth.user()` returns `null`.
For token-based API auth, reach for [`@rudderjs/passport`](../passport):
`[RequireBearer(), scope('read')]`. Or mount `AuthMiddleware('api')` per-route
with a token guard if you've wired one.

### Login / logout

```ts
// Attempt with credentials
const success = await Auth.attempt({ email, password })

// Manual login (after a sign-up flow, social login, etc.)
await Auth.login(user)

// Logout
await Auth.logout()
```

### Route protection

```ts
import { RequireAuth, RequireGuest } from '@rudderjs/auth'

// 401 if not logged in
Route.post('/posts', handler, [RequireAuth()])

// Bounce already-logged-in users away (e.g. /login, /register)
Route.get('/login', showLoginPage, [RequireGuest('/')])
```

### `AuthMiddleware` — advanced only

```ts
import { AuthMiddleware } from '@rudderjs/auth'
```

**You don't normally attach this on web routes.** `authProvider()` already
installs `AuthMiddleware()` on the `web` route group, so `req.user` and `auth()`
work automatically on every web request. Reach for it manually in two cases:

**1. A non-default guard on a specific web route** — the RudderJS equivalent
of Laravel's `->middleware('auth:api')`:

```ts
Route.get('/admin/stats', handler, [
  AuthMiddleware('api'),   // populate req.user using the 'api' guard
  RequireAuth('api'),      // 401 if not authenticated against 'api'
])
```

**2. Opting an API route into a token-backed guard** — API routes are
stateless by default, so wire the guard per-route:

```ts
Route.get('/api/admin/stats', handler, [
  AuthMiddleware('api'),
  RequireAuth('api'),
])
```

On web routes, you can forget `AuthMiddleware` exists — use `auth()`, `Auth`,
or `req.user` directly.

### Authenticatable Contract

Your User model must implement:

```ts
interface Authenticatable {
  getAuthIdentifier(): string
  getAuthPassword(): string
  getRememberToken(): string | null
  setRememberToken(token: string): void
}
```

The `EloquentUserProvider` auto-wraps ORM model records with these methods (mapping `id`, `password`, `rememberToken` fields).

## Architecture

- **Guards** determine *how* users are authenticated (session cookies, API tokens)
- **User Providers** determine *where* users are retrieved from (Eloquent model, raw DB)
- **Auth facade** delegates to the current guard via `AsyncLocalStorage`
- **AuthManager** creates guards + providers from config, one per request

### Built-in Guards

| Guard | Driver | Description |
|-------|--------|-------------|
| Session | `session` | Cookie-based auth via `@rudderjs/session` |

### Built-in Providers

| Provider | Driver | Description |
|----------|--------|-------------|
| Eloquent | `eloquent` | Uses `@rudderjs/orm` Model class |

## Auth views

Ships React views for Login, Register, ForgotPassword, ResetPassword under `views/react/`. `create-rudder-app` vendors them into `app/Views/Auth/` at scaffold time so the app owns the files from day one and can edit them freely.

To re-vendor manually (e.g. after upgrading this package):

```bash
cp -R node_modules/@rudderjs/auth/views/react/. app/Views/Auth/
```

### Upgrading from 3.1.x → 3.2.0

The auth views were refactored to use semantic class names (`auth-wrap`, `form-card`, `form-input`, `auth-link`, …) instead of inline Tailwind utilities. The visual output is unchanged when paired with the matching CSS shipped by `create-rudder-app@0.0.30+`.

If your app vendored the previous React auth views, you have two paths:

- **Re-vendor + update CSS** — copy the new view files (command above) and ensure your `app/index.css` defines the semantic class selectors. The reference CSS lives in `create-rudder-app/src/templates.ts` (`semanticRulesApply()` for Tailwind apps, `indexCssPlain()` for non-Tailwind apps).
- **Keep your existing vendored copies** — your old auth views still work, just don't pull in the new ones.

Bumping `@rudderjs/auth` alone won't touch your vendored copies; the views only get re-applied when you explicitly re-vendor.
