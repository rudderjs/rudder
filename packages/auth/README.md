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
import { auth } from '@rudderjs/auth'

export default [
  session(configs.session),
  hash(configs.hash),
  auth(configs.auth),
]
```

## Usage

### Auth Facade

```ts
import { Auth } from '@rudderjs/auth'

// Attempt login
const success = await Auth.attempt({ email, password })

// Manual login/logout
Auth.login(user)
Auth.logout()

// Current user
const user = await Auth.user()    // Authenticatable | null
const id = await Auth.id()        // string | null
const ok = await Auth.check()     // boolean
const no = await Auth.guest()     // boolean

// Switch guard
Auth.guard('api').user()
```

### Middleware

```ts
import { AuthMiddleware, RequireAuth } from '@rudderjs/auth'

// Attach user to request (non-blocking)
Route.get('/profile', handler, [AuthMiddleware()])

// Require authentication (returns 401 if not logged in)
Route.post('/posts', handler, [RequireAuth()])
```

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
