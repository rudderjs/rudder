# @rudderjs/auth

Authentication for RudderJS, powered by [better-auth](https://www.better-auth.com/). Provides email/password login, session management, password reset, and an auth middleware -- with auto-detection of your ORM (Prisma or Drizzle) and database driver.

## Installation

```bash
pnpm add @rudderjs/auth
```

## Setup

### 1. Register the provider

```ts
// bootstrap/providers.ts
import { auth } from '@rudderjs/auth'
import configs from '../config/index.ts'

export default [
  database(configs.database),   // must come before auth
  auth(configs.auth),
  // ...
]
```

`auth()` auto-discovers the database client from the DI container. It checks for a Prisma client first (`'prisma'` key), then Drizzle (`'drizzle'` key). If neither is bound, you can pass an explicit `AuthDbConfig` as the second argument:

```ts
auth(configs.auth, { driver: 'postgresql', url: process.env['DATABASE_URL'] })
```

### 2. Publish the database schema

Auth ships its own schema files for every supported ORM and database driver. Publish the correct one with:

```bash
pnpm rudder vendor:publish --tag=auth-schema
```

The command auto-detects your ORM (Prisma or Drizzle) and DB driver (SQLite, PostgreSQL, or MySQL), then publishes the appropriate file:

- **Prisma** -- publishes `auth.prisma` to `prisma/schema/`
- **Drizzle** -- publishes the driver-specific schema (e.g. `auth.drizzle.pg.ts`) to `database/schema/`

After publishing, run your ORM's migration or push command to apply the schema.

### 3. Configuration

```ts
// config/auth.ts
import type { BetterAuthConfig } from '@rudderjs/auth'

export default {
  secret: process.env['AUTH_SECRET'],
  baseUrl: process.env['APP_URL'],
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: ['http://localhost:3000'],
} satisfies BetterAuthConfig
```

## Auth Pages

Auth ships pre-built login, register, forgot-password, and reset-password pages for React, Vue, and Solid. Publish them with:

```bash
pnpm rudder vendor:publish --tag=auth-pages          # React (default)
pnpm rudder vendor:publish --tag=auth-pages-react
pnpm rudder vendor:publish --tag=auth-pages-vue
pnpm rudder vendor:publish --tag=auth-pages-solid
```

Pages are published to the `pages/(auth)/` route group. They use Vike's `navigate()` for smooth client-side transitions between auth pages and after successful login/register.

### Redirect support

The login page reads a `?redirect=/path` query parameter. After a successful login, the user is navigated to that path instead of the default redirect. This makes it easy to send unauthenticated users to login and return them to where they were going:

```ts
navigate(`/login?redirect=${encodeURIComponent(currentPath)}`)
```

## Password Reset

To enable the forgot-password / reset-password flow, provide a `sendResetPassword` callback in your auth config:

```ts
// config/auth.ts
export default {
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // Send email with the reset URL
      console.log(`Reset for ${user.email}: ${url}`)
    },
  },
} satisfies BetterAuthConfig
```

The published auth pages include forgot-password and reset-password forms that work with this callback out of the box.

## Auth Middleware

`AuthMiddleware()` verifies the session via better-auth and attaches the authenticated user to `req.user`. Returns 401 if no valid session exists.

```ts
import { AuthMiddleware } from '@rudderjs/auth'
import { Route } from '@rudderjs/router'

Route.post('/api/posts', handler, [AuthMiddleware()])
```

`req.user` is typed as `AuthUser | undefined` via module augmentation on `AppRequest`.

## ORM Support

Auth works with both Prisma and Drizzle. At boot, it auto-detects which ORM is bound in the DI container:

1. **Prisma** -- if a `'prisma'` key is bound, uses `prismaAdapter` from better-auth
2. **Drizzle** -- if a `'drizzle'` key is bound, uses `drizzleAdapter` from better-auth
3. **Fallback** -- if neither is bound, creates a standalone PrismaClient from the `dbConfig` argument

Make sure your ORM provider is registered before `auth()` in the providers array.

## API Reference

### Types

- `AuthUser` -- authenticated user object (`id`, `name`, `email`, `emailVerified`, `image?`, `createdAt`, `updatedAt`)
- `AuthSession` -- session object (`id`, `userId`, `token`, `expiresAt`, `ipAddress?`, `userAgent?`, `createdAt`, `updatedAt`)
- `AuthResult` -- `{ user: AuthUser; session: AuthSession }`
- `BetterAuthConfig` -- configuration options for the auth provider
- `BetterAuthInstance` -- the type of the better-auth instance bound to DI as `'auth'`
- `AuthDbConfig` -- `{ driver?: 'postgresql' | 'sqlite' | 'libsql' | 'mysql'; url?: string }`

### Functions

- `auth(config, dbConfig?)` -- returns a ServiceProvider class that configures better-auth
- `betterAuth(config, dbConfig?)` -- deprecated alias for `auth()`
- `AuthMiddleware()` -- returns a middleware handler that enforces authentication

## Notes

- The auth instance is bound to the DI container as `'auth'` -- retrieve it with `app().make<BetterAuthInstance>('auth')`
- Auth mounts routes at `/api/auth/*` -- register the auth provider before any catch-all API route handler
- `AUTH_SECRET` must be at least 32 characters in production
