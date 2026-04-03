# @rudderjs/auth

Authentication types, service provider factory, and middleware for RudderJS applications — powered by [better-auth](https://better-auth.com).

## Installation

```bash
pnpm add @rudderjs/auth better-auth
```

## Quick Setup

### 1. Add the config

```ts
// config/auth.ts
import { Env } from '@rudderjs/support'
import type { BetterAuthConfig } from '@rudderjs/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'change-me-32-chars-min'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },
} satisfies BetterAuthConfig
```

### 2. Register the provider

Register `database()` first — `auth()` will auto-discover the Prisma client from the DI container:

```ts
// bootstrap/providers.ts
import { database } from '@rudderjs/orm-prisma'
import { auth } from '@rudderjs/auth'
import configs from '../config/index.js'

export default [
  database(configs.database),  // binds PrismaClient to DI as 'prisma'
  auth(configs.auth),          // auto-discovers 'prisma' — no DB config needed
  // ...
]
```

> If you are not using `@rudderjs/orm-prisma`, pass database config as the second argument:
> `auth(configs.auth, { driver: 'sqlite', url: 'file:./dev.db' })`

### 3. Protect routes

```ts
import { AuthMiddleware } from '@rudderjs/auth'

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
import { auth } from '@rudderjs/auth'

export default [
  auth(configs.auth),
]
```

The provider:
1. Tries `app().make('prisma')` first — works automatically when `database()` runs before it.
2. Falls back to creating its own `PrismaClient` using `dbConfig` if no `'prisma'` binding exists.
3. Binds the better-auth instance to DI as `'auth'`.

`dbConfig` is optional but required when `database()` is not registered:

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
import { AuthMiddleware } from '@rudderjs/auth'

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
import { app } from '@rudderjs/core'
import type { BetterAuthInstance } from '@rudderjs/auth'

const auth = app().make<BetterAuthInstance>('auth')

// Verify a session
const session = await auth.api.getSession({ headers: request.headers })
```

---

## Schema Publishing

The auth package provides its own Prisma schema file containing the `User`, `Session`, `Account`, and `Verification` models. Publish it into your project's multi-file schema directory:

```bash
pnpm rudder vendor:publish --tag=auth-schema
```

This creates `prisma/schema/auth.prisma`. Then push the schema:

```bash
pnpm rudder db:push
```

If you are using Drizzle instead of Prisma, the auth package auto-detects the ORM at runtime and works with the Drizzle adapter directly — no schema publishing needed. Define the auth tables in your Drizzle schema file as described in the [better-auth Drizzle documentation](https://www.better-auth.com/docs/adapters/drizzle).

---

## Auth Pages

The auth package can publish pre-built authentication pages into your project:

```bash
pnpm rudder vendor:publish --tag=auth-pages
```

This creates the following pages under `pages/(auth)/`:

| Page | Path | Description |
|------|------|-------------|
| Login | `/login` | Email/password sign-in form |
| Register | `/register` | New user registration form |
| Forgot Password | `/forgot-password` | Request a password reset email |
| Reset Password | `/reset-password?token=...` | Set a new password using a reset token |

### Password Reset

Password reset requires the `sendResetPassword` callback in your auth config to send the reset email:

```ts
// config/auth.ts
export default {
  // ...
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // Send the password reset email
      // `url` contains the full reset link with token
      await mail.send(new PasswordResetMail(user, url))
    },
  },
} satisfies BetterAuthConfig
```

### Login Redirect

The login page supports a `redirect` query parameter. After successful authentication, the user is redirected to the specified path:

```
/login?redirect=/dashboard
```

---

## Drizzle Support

`@rudderjs/auth` auto-detects which ORM is in use at runtime. When `@rudderjs/orm-drizzle` is registered instead of `@rudderjs/orm-prisma`, the auth provider automatically uses better-auth's Drizzle adapter. No additional configuration is needed beyond having the auth tables defined in your Drizzle schema.

---

## Notes

- `@rudderjs/auth` includes `better-auth` as a direct dependency — no separate install needed beyond `@rudderjs/auth`.
- `AUTH_SECRET` must be at least 32 characters.
- Auth routes (`/api/auth/*`) are registered during provider `boot()`, before `routes/api.ts` loads — they always resolve before any `/api/*` catch-all.
- The deprecated alias `betterAuth` still works — prefer `auth`.
