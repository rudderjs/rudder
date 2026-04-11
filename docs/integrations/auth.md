# Authentication

This guide walks through setting up full user authentication in a RudderJS app using `@rudderjs/auth` and [better-auth](https://better-auth.com).

## Overview

RudderJS's auth integration:

1. **`@rudderjs/auth`** — shared `AuthUser`, `AuthSession`, `AuthResult` types + `auth()` provider factory
2. **`AuthMiddleware()`** — zero-config middleware that validates sessions and sets `req.user`
3. **better-auth** — the underlying auth library (handles sessions, OAuth, etc.)

## Installation

```bash
pnpm add @rudderjs/auth better-auth
```

## 1. Configure the Database

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

## 2. Auth Configuration

Create `config/auth.ts`:

```ts
import { Env } from '@rudderjs/support'
import type { BetterAuthConfig } from '@rudderjs/auth'

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

## 3. Wire the Provider

Register `prismaProvider` first — `auth()` auto-discovers the Prisma client from the DI container:

```ts
// bootstrap/providers.ts
import { database } from '@rudderjs/orm-prisma'
import { auth } from '@rudderjs/auth'
import configs from '../config/index.js'

export default [
  database(configs.database),  // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),          // auto-discovers 'prisma' — no DB config needed
  // ...other providers
]
```

The `auth()` provider automatically:
- Wraps the Prisma client with better-auth's Prisma adapter
- Mounts all auth routes at `/api/auth/*`
- Binds the auth instance in the DI container under the `'auth'` token

## 4. Auth Routes

better-auth exposes built-in routes at `/api/auth/*` — no manual route registration needed.

| Route | Method | Description |
|---|---|---|
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

Use `AuthMiddleware()` from `@rudderjs/auth` — it validates the session and attaches the user to `req.user`:

```ts
import { AuthMiddleware } from '@rudderjs/auth'

const authMw = AuthMiddleware()

Route.get('/api/me', (req, res) => {
  res.json({ user: req.user })
}, [authMw])

Route.get('/api/dashboard', handler, [authMw])
```

`req.user` is typed as `AuthUser | undefined` — no casting needed.

## 7. Accessing the Auth Instance

Anywhere after boot:

```ts
import { app } from '@rudderjs/core'
import type { BetterAuthInstance } from '@rudderjs/auth'

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
      clientId:     Env.get('GITHUB_CLIENT_ID'),
      clientSecret: Env.get('GITHUB_CLIENT_SECRET'),
    },
    google: {
      clientId:     Env.get('GOOGLE_CLIENT_ID'),
      clientSecret: Env.get('GOOGLE_CLIENT_SECRET'),
    },
  },
} satisfies BetterAuthConfig
```

Then initiate OAuth from the client:

```ts
// Redirect to GitHub OAuth
window.location.href = '/api/auth/sign-in/social?provider=github&callbackURL=/dashboard'
```

## 9. Password Reset

To enable password reset, configure the `sendResetPassword` callback in your auth config. This callback is invoked when a user requests a password reset and is responsible for sending the email containing the reset link.

### Configure the callback

```ts
// config/auth.ts
import { Env } from '@rudderjs/support'
import type { BetterAuthConfig } from '@rudderjs/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'change-me-at-least-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // url is the full reset link: https://yourapp.com/reset-password?token=...
      // Send the email using @rudderjs/mail, nodemailer, or any email service
      await mail.send(new PasswordResetMail(user, url))
    },
  },
  trustedOrigins: [Env.get('APP_URL', 'http://localhost:3000')],
} satisfies BetterAuthConfig
```

### Auth views

Publish the pre-built auth view components if you haven't already:

```bash
pnpm rudder vendor:publish --tag=auth-views
```

This vendors view files into `app/Views/Auth/` (Login, Register, ForgotPassword, ResetPassword). Wire the routes in `routes/web.ts`:

```ts
import { registerAuthRoutes } from '@rudderjs/auth/routes'
registerAuthRoutes(Route, { middleware: [SessionMiddleware(), CsrfMiddleware()] })
```

This registers:

- **`/forgot-password`** — form where the user enters their email to request a reset link
- **`/reset-password?token=...`** — form where the user sets a new password using the token from the email

### How it works

1. User visits `/forgot-password` and submits their email
2. The client calls `POST /api/auth/request-password-reset` with the email
3. better-auth generates a reset token, builds the URL, and calls your `sendResetPassword` callback
4. The user clicks the link in the email and lands on `/reset-password?token=abc123`
5. The client calls `POST /api/auth/reset-password` with the token and new password
6. better-auth validates the token and updates the password

### better-auth endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/auth/request-password-reset` | POST | `{ email }` | Sends the reset email via your callback |
| `/api/auth/reset-password` | POST | `{ token, newPassword }` | Validates token and sets new password |

## Notes

- `AUTH_SECRET` must be at least 32 characters for HMAC signing.
- better-auth sets `HttpOnly` cookies by default — no manual cookie handling needed.
- `trustedOrigins` must include your frontend's origin for cross-origin requests.
- Auth routes are registered during provider `boot()` and always resolve before any `/api/*` catch-all you define in `routes/api.ts`.
