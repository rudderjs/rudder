# @rudderjs/auth

## Overview

Full-featured authentication and authorization package for RudderJS. Provides session-based guards, an Eloquent user provider, password reset broker, email verification, and a Laravel-style Gate/Policy authorization system. Uses `AsyncLocalStorage` for request-scoped auth context, integrates with `@rudderjs/hash` for password checking and `@rudderjs/session` for cookie-based sessions.

## Key Patterns

### Authentication Guards

Guards implement the `Guard` contract (`user()`, `check()`, `attempt()`, `login()`, `logout()`). The `SessionGuard` is the built-in driver that stores `auth_user_id` in the session.

```ts
// config/auth.ts
export default {
  defaults: { guard: 'web' },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: User },
  },
} satisfies AuthConfig
```

Use `AuthMiddleware()` to populate `req.user` without blocking, or `RequireAuth()` to return 401 for unauthenticated requests:

```ts
router.get('/profile', RequireAuth(), async (req, res) => {
  res.json(req.user) // AuthUser — id, name, email + extra fields
})
```

Use the `Auth` facade inside route handlers (request-scoped via AsyncLocalStorage):

```ts
const success = await Auth.attempt({ email, password })
await Auth.login(user)
await Auth.logout()
const user = await Auth.user()
```

### Password Hashing

Auth delegates hashing to `@rudderjs/hash`. The hash provider **must** be registered before auth in the provider array:

```ts
// bootstrap/providers.ts
export default [hash(configs.hash), auth(configs.auth), ...]
```

The `EloquentUserProvider` calls `hashCheck(plain, hashed)` internally during `validateCredentials()`.

### Email Verification

Implement `MustVerifyEmail` on your User model:

```ts
class User extends Model implements Authenticatable, MustVerifyEmail {
  hasVerifiedEmail() { return this.emailVerifiedAt !== null }
  markEmailAsVerified() { this.emailVerifiedAt = new Date().toISOString(); return Promise.resolve() }
  getEmailForVerification() { return this.email }
}
```

Use the middleware and helpers:

```ts
router.get('/dashboard', RequireAuth(), EnsureEmailIsVerified(), handler)

// Generate a signed verification URL (requires @rudderjs/router)
const url = verificationUrl(user)

// Handle verification in the route
await handleEmailVerification(req.params.id, req.params.hash, (id) => User.find(id))
```

### Authorization (Gates/Policies)

Define abilities and policies, then check them anywhere:

```ts
// In a provider's boot()
Gate.define('edit-post', (user, post) => user.id === post.authorId)
Gate.policy(Post, PostPolicy)
Gate.before((user) => user.isAdmin ? true : undefined)

// In a handler
await Gate.authorize('edit-post', post) // throws AuthorizationError (403)
if (await Gate.allows('edit-post', post)) { ... }

// Scoped to a specific user
await Gate.forUser(user).allows('edit-post', post)
```

Policies are classes with method names matching ability names:

```ts
class PostPolicy extends Policy {
  before(user: Authenticatable) { return user.isAdmin ? true : undefined }
  update(user: Authenticatable, post: Post) { return user.id === post.authorId }
  delete(user: Authenticatable, post: Post) { return user.id === post.authorId }
}
```

## Common Pitfalls

- **Provider order matters**: `hash()` must come before `auth()` in the providers array, or boot throws.
- **Missing session**: `@rudderjs/session` is a required peer dep. The session middleware must run before `AuthMiddleware`.
- **Auth outside middleware context**: `Auth.user()` / `Gate.allows()` only work inside the `AuthMiddleware` scope (AsyncLocalStorage). Outside that scope you get "No auth context" errors.
- **Password stripped from AuthUser**: The `userToPlain()` helper removes `password` from `req.user` automatically.
- **Gate.reset()**: Only for testing. Gate state is static/global.

## Key Imports

```ts
// Provider factory
import { auth } from '@rudderjs/auth'

// Middleware
import { AuthMiddleware, RequireAuth, EnsureEmailIsVerified } from '@rudderjs/auth'

// Facades & managers
import { Auth, Gate, Policy, AuthorizationError } from '@rudderjs/auth'

// Password reset
import { PasswordBroker, MemoryTokenRepository } from '@rudderjs/auth'

// Email verification
import { verificationUrl, handleEmailVerification, mustVerifyEmail } from '@rudderjs/auth'

// User provider
import { EloquentUserProvider, toAuthenticatable } from '@rudderjs/auth'

// Types
import type { Authenticatable, AuthUser, Guard, UserProvider, AuthConfig, MustVerifyEmail } from '@rudderjs/auth'
```
