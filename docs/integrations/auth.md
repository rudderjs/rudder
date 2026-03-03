# Authentication

This guide walks through setting up full user authentication in a Forge app using `@boostkit/auth-better-auth` and [better-auth](https://better-auth.com).

## Overview

Forge's auth integration:

1. **`@boostkit/auth`** — shared `AuthUser`, `AuthSession`, `AuthResult` types
2. **`@boostkit/auth-better-auth`** — service provider factory that wires better-auth into Forge
3. **better-auth** — the underlying auth library (handles sessions, OAuth, etc.)

## Installation

```bash
pnpm add @boostkit/auth-better-auth better-auth @prisma/client
```

## 1. Configure the Database

better-auth stores users, sessions, accounts, and verification tokens in your database. Add the required tables to your Prisma schema:

```prisma
// prisma/schema.prisma

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

Apply the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## 2. Auth Configuration

Create `config/auth.ts`:

```ts
import { Env } from '@boostkit/support'
import { PrismaClient } from '@prisma/client'
import type { BetterAuthConfig } from '@boostkit/auth-better-auth'

export default {
  secret:   Env.get('AUTH_SECRET'),
  baseUrl:  Env.get('APP_URL', 'http://localhost:3000'),

  // Async factory — better-auth auto-detects and wraps PrismaClient
  database: async () => new PrismaClient(),

  emailAndPassword: {
    enabled: true,
  },

  trustedOrigins: [
    Env.get('APP_URL', 'http://localhost:3000'),
  ],
} satisfies BetterAuthConfig
```

Add to `.env`:

```dotenv
AUTH_SECRET=your-secret-here-at-least-32-chars
APP_URL=http://localhost:3000
```

## 3. Wire the Provider

In `bootstrap/providers.ts`, add `betterAuth()` before `DatabaseServiceProvider` — it does not depend on the ORM and registers `/api/auth/*` routes during its own `boot()`:

```ts
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { betterAuth } from '@boostkit/auth-better-auth'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  betterAuth(configs.auth),       // Registers auth + mounts /api/auth/*
  // ...other providers
  DatabaseServiceProvider,        // must appear before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
]
```

The `betterAuth()` provider automatically:
- Wraps your Prisma client with better-auth's Prisma adapter
- Mounts all auth routes at `/api/auth/*`
- Binds the auth instance in the DI container under the `'auth'` token

## 4. Auth Routes

better-auth exposes a suite of built-in routes at `/api/auth/*`. No manual route registration is needed.

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/sign-up/email` | POST | Register with email + password |
| `/api/auth/sign-in/email` | POST | Sign in with email + password |
| `/api/auth/sign-out` | POST | Sign out (clears session) |
| `/api/auth/session` | GET | Get current session |
| `/api/auth/get-session` | GET | Alternative session endpoint |

## 5. Sign Up and Sign In

From the client side:

```ts
// Sign up
const res = await fetch('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Alice',
    email: 'alice@example.com',
    password: 'secret123',
  }),
})

// Sign in
const res = await fetch('/api/auth/sign-in/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'alice@example.com',
    password: 'secret123',
  }),
})
```

The response sets a session cookie automatically.

## 6. Protecting Routes

Create an `AuthMiddleware` that validates the session:

```ts
// app/Http/Middleware/AuthMiddleware.ts
import { Middleware } from '@boostkit/middleware'
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth-better-auth'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

export class AuthMiddleware extends Middleware {
  async handle(req: ForgeRequest, res: ForgeResponse, next: () => Promise<void>) {
    const auth = app().make<BetterAuthInstance>('auth')

    // Pass the raw Hono request to better-auth
    const rawReq = (req.raw as any).req?.raw ?? req.raw
    const session = await auth.api.getSession({ headers: rawReq.headers })

    if (!session) {
      return res.status(401).json({ message: 'Unauthenticated.' })
    }

    // Attach session and user to request for downstream handlers
    ;(req as any).session = session.session
    ;(req as any).user    = session.user

    await next()
  }
}
```

Use it on protected routes:

```ts
import { Controller, Get, Middleware } from '@boostkit/router'
import { AuthMiddleware } from '../Http/Middleware/AuthMiddleware.js'

@Controller('/api/me')
class ProfileController {
  @Get('/')
  @Middleware([AuthMiddleware])
  async profile(req: ForgeRequest, res: ForgeResponse) {
    return res.json({ user: (req as any).user })
  }
}
```

## 7. Accessing the Auth Instance

Anywhere after boot:

```ts
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth-better-auth'

const auth = app().make<BetterAuthInstance>('auth')

// Verify a session token
const session = await auth.api.getSession({ headers: request.headers })

// Create a user programmatically
const user = await auth.api.signUpEmail({
  body: { name: 'Bob', email: 'bob@example.com', password: 'secret' },
})
```

## 8. Social Providers

To add OAuth (Google, GitHub, etc.), extend the auth config:

```ts
// config/auth.ts
export default {
  // ...
  socialProviders: {
    github: {
      clientId:     Env.require('GITHUB_CLIENT_ID'),
      clientSecret: Env.require('GITHUB_CLIENT_SECRET'),
    },
    google: {
      clientId:     Env.require('GOOGLE_CLIENT_ID'),
      clientSecret: Env.require('GOOGLE_CLIENT_SECRET'),
    },
  },
}
```

Then initiate OAuth from the client:

```ts
// Redirect to GitHub OAuth
window.location.href = '/api/auth/sign-in/social?provider=github&callbackURL=/dashboard'
```

## Notes

- `AUTH_SECRET` must be at least 32 characters for HMAC signing
- better-auth sets `HttpOnly` cookies by default — no manual cookie handling needed
- `trustedOrigins` must include your frontend's origin for cross-origin requests
- The `database` config field accepts a `PrismaClient` (auto-adapted) or a pre-built better-auth adapter
