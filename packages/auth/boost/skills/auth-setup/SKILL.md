---
name: auth-setup
description: Setting up authentication with guards, sessions, registration, password reset, gates/policies, and vendor views in RudderJS
---

# Auth Setup

## When to use this skill

Load this skill when you need to set up authentication, configure guards, add login/register views, implement authorization gates/policies, or work with password reset and email verification.

## Key concepts

- **AuthManager**: Process-wide DI singleton that creates fresh `SessionGuard` instances per call (never cached -- prevents ghost user leaks across requests).
- **Guard contract**: `user()`, `check()`, `guest()`, `attempt()`, `login()`, `logout()` -- all async.
- **`auth()` helper**: Returns the current request's `AuthManager` via AsyncLocalStorage. Mirrors Laravel's `auth()->user()`.
- **Auth facade**: `Auth.user()`, `Auth.check()` etc. -- static class that proxies to `currentAuth()`.
- **AuthMiddleware**: Sets up the auth ALS context and populates `req.user` for every request.
- **RequireAuth**: Returns 401 if not authenticated.
- **RequireGuest**: Redirects authenticated users away from guest-only pages (login, register).
- **Gate/Policy**: Authorization system for checking abilities and model-level policies.

## Step-by-step

### 1. Install dependencies

Auth requires `@rudderjs/session` and `@rudderjs/hash` as peer dependencies:

```bash
pnpm add @rudderjs/auth @rudderjs/session @rudderjs/hash
```

### 2. Configure auth (config/auth.ts)

```ts
import { User } from '../app/Models/User.js'
import type { AuthConfig } from '@rudderjs/auth'

export default {
  defaults: {
    guard: 'web',
  },
  guards: {
    web: {
      driver: 'session',
      provider: 'users',
    },
  },
  providers: {
    users: {
      driver: 'eloquent',
      model: User,
    },
  },
} satisfies AuthConfig
```

### 3. Register the provider (bootstrap/providers.ts)

```ts
import { defaultProviders } from '@rudderjs/core'
// AuthProvider is auto-discovered via defaultProviders() if @rudderjs/auth is installed.
// It requires HashProvider and SessionProvider to boot before it.
export default [
  ...(await defaultProviders()),
  // ... your app providers
]
```

### 4. Make the User model authenticatable

```ts
import { Model, Hidden } from '@rudderjs/orm'
import type { Authenticatable } from '@rudderjs/auth'

export class User extends Model implements Authenticatable {
  static fillable = ['name', 'email', 'password']

  @Hidden password = ''

  getAuthIdentifier(): string { return String(this.id) }
  getAuthPassword(): string { return this.password }
  getRememberToken(): string | null { return null }
  setRememberToken(_token: string): void {}
}
```

### 5. Use auth in route handlers

```ts
import { auth, Auth, RequireAuth } from '@rudderjs/auth'

// Using the auth() helper (Laravel-style)
router.get('/api/me', async (req, res) => {
  const user = await auth().user()
  if (!user) return res.status(401).json({ message: 'Unauthorized' })
  res.json({ user })
})

// Using the Auth facade
router.get('/api/profile', async (req, res) => {
  if (await Auth.guest()) return res.status(401).json({ message: 'Unauthorized' })
  const user = await Auth.user()
  res.json({ user })
})

// Using RequireAuth middleware
router.get('/api/dashboard', RequireAuth(), async (req, res) => {
  // req.user is guaranteed to exist here
  res.json({ user: req.user })
})
```

### 6. Login / logout endpoints

```ts
router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const success = await auth().attempt({ email, password })
  if (!success) {
    return res.status(422).json({ message: 'Invalid credentials.' })
  }
  const user = await auth().user()
  res.json({ user })
})

router.post('/api/auth/register', async (req, res) => {
  const user = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,  // hashed by Attribute mutator
  })
  await auth().login(user)
  res.json({ user })
})

router.post('/api/auth/logout', RequireAuth(), async (req, res) => {
  await auth().logout()
  res.json({ message: 'Logged out.' })
})
```

### 7. Set up auth views (login/register pages)

Vendor the view files into your app:

```bash
pnpm rudder vendor:publish --tag=auth-views
```

This copies `@rudderjs/auth/views/react/` into `app/Views/Auth/`. Then register routes:

```ts
// routes/web.ts
import { Route } from '@rudderjs/router'
import { registerAuthRoutes } from '@rudderjs/auth/routes'

registerAuthRoutes(Route)
// Registers: GET /login, GET /register, GET /forgot-password, GET /reset-password
```

Customize paths and view ids:

```ts
registerAuthRoutes(Route, {
  paths: {
    login: '/sign-in',
    register: '/sign-up',
  },
  views: {
    login: 'auth.sign-in',       // maps to app/Views/Auth/SignIn.tsx
    register: 'auth.sign-up',
  },
  homeUrl: '/dashboard',          // redirect destination for authenticated users
})
```

### 8. Authorization with Gates

```ts
import { Gate, Policy, AuthorizationError } from '@rudderjs/auth'

// Define abilities
Gate.define('manage-settings', (user) => user.role === 'admin')
Gate.define('edit-post', (user, post) => post.authorId === user.getAuthIdentifier())

// Check in handlers
if (await Gate.allows('manage-settings')) { /* ... */ }
if (await Gate.denies('edit-post', post)) { /* ... */ }

// Throw 403 if denied
await Gate.authorize('edit-post', post)

// Before callback -- runs before all checks
Gate.before((user, ability) => {
  if (user.role === 'super-admin') return true  // allow everything
  return null  // fall through to normal checks
})
```

### 9. Model policies

```ts
import { Policy } from '@rudderjs/auth'
import type { Authenticatable } from '@rudderjs/auth'

class PostPolicy extends Policy {
  before(user: Authenticatable) {
    if ((user as any).role === 'admin') return true
    return null  // fall through
  }

  view(user: Authenticatable, post: Post) {
    return post.isPublished || post.authorId === user.getAuthIdentifier()
  }

  update(user: Authenticatable, post: Post) {
    return post.authorId === user.getAuthIdentifier()
  }

  delete(user: Authenticatable, post: Post) {
    return post.authorId === user.getAuthIdentifier()
  }
}

// Register the policy
Gate.policy(Post, PostPolicy)

// Use it
await Gate.authorize('update', post)  // auto-finds PostPolicy.update()
```

### 10. Email verification

```ts
import { EnsureEmailIsVerified, verificationUrl, handleEmailVerification } from '@rudderjs/auth'
import type { MustVerifyEmail } from '@rudderjs/auth'

// Make user implement MustVerifyEmail
class User extends Model implements Authenticatable, MustVerifyEmail {
  hasVerifiedEmail() { return this.emailVerifiedAt !== null }
  async markEmailAsVerified() { await User.update(this.id, { emailVerifiedAt: new Date() }) }
  getEmailForVerification() { return this.email }
}

// Protect routes
router.get('/dashboard', RequireAuth(), EnsureEmailIsVerified(), handler)

// Generate verification URL (for sending in emails)
const url = verificationUrl(user)
```

### 11. Password reset

```ts
import { PasswordBroker, MemoryTokenRepository } from '@rudderjs/auth'

const broker = new PasswordBroker(new MemoryTokenRepository())
// In production, implement TokenRepository backed by your database
```

## Examples

See `playground/config/auth.ts` for configuration, `playground/app/Models/User.ts` for the model, `playground/routes/web.ts` for route registration, and `playground/app/Views/Auth/` for vendored view files.

## Common pitfalls

- **Ghost signed-in user**: `AuthManager` must NOT cache `SessionGuard` instances. The manager is a DI singleton; cached guards leak `_user` across requests.
- **Provider boot order**: `HashProvider` and `SessionProvider` must boot before `AuthProvider`. With `defaultProviders()`, this is handled automatically.
- **Session middleware required**: Auth views require session middleware. Ensure `@rudderjs/session` is installed and its provider is registered.
- **View route override**: Auth view files need `export const route = '/login'` etc. so SPA navigation works correctly (URL must match Vike's route table).
- **POST handlers not included**: `registerAuthRoutes()` only registers GET routes for the UI pages. POST endpoints for login/register/logout are your responsibility in `routes/api.ts`.
- **Guard driver**: Currently only `'session'` is supported as a guard driver. API token guards are planned.
