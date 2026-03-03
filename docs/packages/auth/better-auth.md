# @boostkit/auth-better-auth

better-auth service provider factory for Forge.

## Installation

```bash
pnpm add @boostkit/auth-better-auth better-auth
```

## Setup

### 1. Configure auth

```ts
// config/auth.ts
import { PrismaClient } from '@prisma/client'
import { Env } from '@boostkit/support'
import type { BetterAuthConfig } from '@boostkit/auth-better-auth'

export default {
  secret:   Env.get('AUTH_SECRET'),
  baseUrl:  Env.get('APP_URL', 'http://localhost:3000'),
  database: async () => new PrismaClient(),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [Env.get('APP_URL', 'http://localhost:3000')],
} satisfies BetterAuthConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { betterAuth } from '@boostkit/auth-better-auth'
import configs from '../config/index.js'

export default [
  betterAuth(configs.auth),   // registers /api/auth/* before any route file loads
  // ...other providers
  DatabaseServiceProvider,    // must appear before AppServiceProvider
  AppServiceProvider,
]
```

## Configuration

### `BetterAuthConfig`

| Option              | Type                                       | Description                                                             |
|---------------------|--------------------------------------------|-------------------------------------------------------------------------|
| `secret`            | `string?`                                  | Auth secret used to sign sessions. Falls back to `AUTH_SECRET` env var. |
| `baseUrl`           | `string?`                                  | Base URL of the application. Falls back to `APP_URL` env var.           |
| `database`          | `PrismaClient \| BetterAuthAdapter \| Promise<PrismaClient>` | Database connection. Accepts a PrismaClient instance, a BetterAuth adapter, or an async factory returning a PrismaClient. |
| `databaseProvider`  | `string?`                                  | Explicit database provider hint (e.g. `'sqlite'`, `'postgresql'`).      |
| `emailAndPassword`  | `{ enabled: boolean }?`                    | Enable email/password authentication.                                   |
| `socialProviders`   | `Record<string, object>?`                  | Social OAuth providers (e.g. GitHub, Google) — see better-auth docs.    |
| `trustedOrigins`    | `string[]?`                                | Origins trusted for CORS and CSRF validation.                           |
| `onUserCreated`     | `(user: AuthUser) => Promise<void>?`       | Hook called after a new user is created.                                |

### `betterAuth(config)`

Returns a Forge `ServiceProvider` class that:

1. Wraps the provided `database` with `prismaAdapter` (or uses the adapter directly if provided).
2. Initializes the better-auth instance and binds it in the DI container as `'auth'`.
3. Auto-registers `/api/auth/*` routes during `boot()` — before `routes/api.ts` is loaded — so auth routes always match ahead of any `/api/*` catch-all.

## Accessing the Auth Instance

After the provider has booted, you can retrieve the raw better-auth instance from the DI container:

```ts
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth-better-auth'

const auth = app().make<BetterAuthInstance>('auth')
```

## Route Registration

The `BetterAuthProvider` mounts all `/api/auth/*` routes during its `boot()` phase. Requests are forwarded as native `Request` objects directly to `auth.handler()`, and `Set-Cookie` headers are preserved in the response passthrough.

Because auth routes are registered before `routes/api.ts` loads, they always match before any `/api/*` catch-all route you define.

## Prisma Schema

Add the following models and fields to your `prisma/schema.prisma` after installing better-auth:

```prisma
model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String    @default("user")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?
}
```

After updating the schema, run:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## Notes

- The auth instance is bound in the DI container under the key `'auth'`. Use `app().make<BetterAuthInstance>('auth')` to retrieve it.
- The `database` option accepts an async factory (`() => Promise<PrismaClient>`), which is useful when the Prisma client needs to be lazily instantiated.
- Auth routes are registered during provider `boot()` and always resolve before any `/api/*` catch-all you define in `routes/api.ts`.
