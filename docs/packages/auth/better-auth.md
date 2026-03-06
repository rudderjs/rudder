# Setup with better-auth

Full setup guide for integrating [better-auth](https://better-auth.com) with BoostKit via `@boostkit/auth`.

## Installation

```bash
pnpm add @boostkit/auth better-auth
```

## 1. Prisma Schema

better-auth stores users, sessions, accounts, and verification tokens in your database. Add the required models to `prisma/schema.prisma`:

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

Apply the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## 2. Auth Config

```ts
// config/auth.ts
import { Env } from '@boostkit/support'
import type { BetterAuthConfig } from '@boostkit/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'change-me-at-least-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },
  trustedOrigins:   [Env.get('APP_URL', 'http://localhost:3000')],
} satisfies BetterAuthConfig
```

Add to `.env`:

```dotenv
AUTH_SECRET=your-secret-here-at-least-32-chars
APP_URL=http://localhost:3000
```

## 3. Register the Provider

`auth()` auto-discovers the Prisma client from the DI container when `prismaProvider` runs first:

```ts
// bootstrap/providers.ts
import { prismaProvider } from '@boostkit/orm-prisma'
import { auth } from '@boostkit/auth'
import configs from '../config/index.js'

export default [
  prismaProvider(configs.database),  // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),                // auto-discovers 'prisma' — no DB config needed
  // ...other providers
]
```

If you are **not** using `@boostkit/orm-prisma`, pass the database config explicitly:

```ts
auth(configs.auth, { driver: 'sqlite', url: 'file:./dev.db' })
// or
auth(configs.auth, { driver: 'postgresql', url: process.env.DATABASE_URL })
```

## 4. Auth Routes

better-auth exposes built-in routes at `/api/auth/*` — no manual registration needed.

| Route | Method | Description |
|---|---|---|
| `/api/auth/sign-up/email` | POST | Register with email + password |
| `/api/auth/sign-in/email` | POST | Sign in with email + password |
| `/api/auth/sign-out` | POST | Sign out (clears session) |
| `/api/auth/session` | GET | Get current session |

## 5. Protecting Routes

Use the built-in `AuthMiddleware()` factory from `@boostkit/auth`:

```ts
import { AuthMiddleware } from '@boostkit/auth'

const authMw = AuthMiddleware()

// Single protected route
Route.get('/api/me', (req, res) => {
  res.json({ user: req.user })
}, [authMw])

// Multiple protected routes
Route.get('/api/posts', listPosts, [authMw])
Route.post('/api/posts', createPost, [authMw])
```

`AuthMiddleware()` validates the better-auth session and attaches the user to `req.user` (typed as `AuthUser | undefined`). Returns `401` if no valid session exists.

## 6. Client-Side Usage

```ts
// Sign up
const res = await fetch('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: 'secret123' }),
})

// Sign in
const res = await fetch('/api/auth/sign-in/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'secret123' }),
})
// Sets a session cookie automatically

// Get current session
const res = await fetch('/api/auth/session', { credentials: 'include' })
```

## 7. Social Providers

Add OAuth providers to `config/auth.ts`:

```ts
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
} satisfies BetterAuthConfig
```

Initiate OAuth from the client:

```ts
window.location.href = '/api/auth/sign-in/social?provider=github&callbackURL=/dashboard'
```

## 8. Accessing the Auth Instance

```ts
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'

const auth = app().make<BetterAuthInstance>('auth')

// Verify a session token
const session = await auth.api.getSession({ headers: request.headers })

// Create a user programmatically
const user = await auth.api.signUpEmail({
  body: { name: 'Bob', email: 'bob@example.com', password: 'secret' },
})
```

## 9. Post-Registration Hook

Run logic after a new user registers (dispatch events, send welcome emails, etc.):

```ts
export default {
  // ...
  onUserCreated: async (user) => {
    await dispatch(new UserRegistered(user.id, user.name, user.email))
  },
} satisfies BetterAuthConfig
```

## Notes

- `AUTH_SECRET` must be at least 32 characters for HMAC signing.
- better-auth sets `HttpOnly` session cookies automatically — no manual cookie handling needed.
- `trustedOrigins` must include your frontend origin for cross-origin requests.
- Auth routes are registered during provider `boot()` and always resolve before any `/api/*` catch-all.
