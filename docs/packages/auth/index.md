# @boostkit/auth

Authentication types, service provider factory, and middleware for BoostKit applications — powered by [better-auth](https://better-auth.com).

## Installation

```bash
pnpm add @boostkit/auth better-auth
```

## Quick Setup

### 1. Add the config

```ts
// config/auth.ts
import { Env } from '@boostkit/support'
import type { BetterAuthConfig } from '@boostkit/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'change-me-32-chars-min'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },
} satisfies BetterAuthConfig
```

### 2. Register the provider

Register `prismaProvider` first — `auth()` will auto-discover the Prisma client from the DI container:

```ts
// bootstrap/providers.ts
import { prismaProvider } from '@boostkit/orm-prisma'
import { auth } from '@boostkit/auth'
import configs from '../config/index.js'

export default [
  prismaProvider(configs.database),  // binds PrismaClient to DI as 'prisma'
  auth(configs.auth),                // auto-discovers 'prisma' — no DB config needed
  // ...
]
```

> If you are not using `@boostkit/orm-prisma`, pass database config as the second argument:
> `auth(configs.auth, { driver: 'sqlite', url: 'file:./dev.db' })`

### 3. Protect routes

```ts
import { AuthMiddleware } from '@boostkit/auth'

const authMw = AuthMiddleware()

Route.get('/api/me', (req, res) => {
  res.json({ user: req.user })
}, [authMw])
```

For a full setup guide including Prisma schema, social providers, and auth routes see the [better-auth setup guide](./better-auth).

---

## API

### `auth(config, dbConfig?)`

Returns a `ServiceProvider` class that initialises better-auth and binds the auth instance to the DI container as `'auth'`.

```ts
import { auth } from '@boostkit/auth'

export default [
  auth(configs.auth),
]
```

The provider:
1. Tries `app().make('prisma')` first — works automatically when `prismaProvider` runs before it.
2. Falls back to creating its own `PrismaClient` using `dbConfig` if no `'prisma'` binding exists.
3. Binds the better-auth instance to DI as `'auth'`.

`dbConfig` is optional but required when `prismaProvider` is not registered:

```ts
auth(configs.auth, {
  driver: 'postgresql',
  url:    'postgresql://user:pass@localhost:5432/mydb',
})
```

| `AuthDbConfig` | Type | Description |
|---|---|---|
| `driver` | `'sqlite' \| 'postgresql' \| 'libsql' \| 'mysql'` | Database driver. Auto-detected from `DATABASE_URL` if omitted. |
| `url` | `string` | Connection string. Falls back to `DATABASE_URL`. |

### `AuthMiddleware()`

Zero-config factory that validates the better-auth session on each request and attaches the authenticated user to `req.user`. Returns `401` if no valid session exists.

```ts
import { AuthMiddleware } from '@boostkit/auth'

const authMw = AuthMiddleware()

Route.get('/api/dashboard', handler, [authMw])
```

`req.user` is typed as `AuthUser | undefined` via module augmentation on `AppRequest`.

### `BetterAuthConfig`

| Option | Type | Description |
|---|---|---|
| `secret` | `string?` | Auth secret (min 32 chars). Falls back to `AUTH_SECRET` env var. |
| `baseUrl` | `string?` | Base URL. Falls back to `APP_URL` env var. |
| `emailAndPassword` | `{ enabled?: boolean; requireEmailVerification?: boolean }?` | Email/password auth. |
| `socialProviders` | `Record<string, { clientId: string; clientSecret: string }>?` | OAuth providers. |
| `trustedOrigins` | `string[]?` | Origins trusted for CSRF validation. |
| `onUserCreated` | `(user: { id, name, email }) => void \| Promise<void>?` | Hook called after a new user registers. |

---

## Types

### `AuthUser`

```ts
interface AuthUser {
  id:            string
  name:          string
  email:         string
  emailVerified: boolean
  image?:        string
  createdAt:     Date
  updatedAt:     Date
}
```

### `AuthSession`

```ts
interface AuthSession {
  id:          string
  userId:      string
  token:       string
  expiresAt:   Date
  ipAddress?:  string
  userAgent?:  string
  createdAt:   Date
  updatedAt:   Date
}
```

### `AuthResult`

```ts
interface AuthResult {
  user:    AuthUser
  session: AuthSession
}
```

### `BetterAuthInstance`

The raw better-auth instance type — use when calling better-auth APIs directly:

```ts
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'

const auth = app().make<BetterAuthInstance>('auth')

// Verify a session
const session = await auth.api.getSession({ headers: request.headers })
```

---

## Notes

- `@boostkit/auth` includes `better-auth` as a direct dependency — no separate install needed beyond `@boostkit/auth`.
- `AUTH_SECRET` must be at least 32 characters.
- Auth routes (`/api/auth/*`) are registered during provider `boot()`, before `routes/api.ts` loads — they always resolve before any `/api/*` catch-all.
- The deprecated alias `betterAuth` still works — prefer `auth`.
