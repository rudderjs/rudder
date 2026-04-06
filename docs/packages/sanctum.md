# @rudderjs/sanctum

API token authentication for stateless API routes — create, validate, and revoke personal access tokens with abilities.

## Installation

```bash
pnpm add @rudderjs/sanctum
```

## Setup

1. Create a config file at `config/sanctum.ts`:

```ts
// config/sanctum.ts
import type { SanctumConfig } from '@rudderjs/sanctum'

export default {
  expiration:  null,   // token lifetime in minutes (null = no expiry)
  tokenPrefix: '',     // optional prefix for generated tokens
} satisfies SanctumConfig
```

2. Register the provider in `bootstrap/providers.ts`. The `sanctum()` provider must come after `auth()`:

```ts
// bootstrap/providers.ts
import { auth } from '@rudderjs/auth'
import { sanctum } from '@rudderjs/sanctum'
import configs from '../config/index.js'

export default [
  // ...other providers
  auth(configs.auth),
  sanctum(configs.sanctum),   // must come after auth()
]
```

3. Add the `PersonalAccessToken` model to your Prisma schema:

```prisma
// prisma/schema.prisma

model PersonalAccessToken {
  id          String   @id @default(cuid())
  userId      String
  name        String
  token       String   @unique   // SHA-256 hash
  abilities   String?             // JSON array
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  createdAt   DateTime @default(now())

  @@map("personal_access_tokens")
  @@index([userId])
}
```

After adding the model, regenerate the Prisma client and push the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## Issuing Tokens

Use the `Sanctum` class to create tokens for a user:

```ts
import { router } from '@rudderjs/router'
import { app } from '@rudderjs/core'
import type { Sanctum } from '@rudderjs/sanctum'

router.post('/api/tokens', async (req, res) => {
  const sanctum = app().make<Sanctum>('sanctum')

  const { accessToken, plainTextToken } = await sanctum.createToken(
    req.user.id,           // userId
    'api-token',           // token name
    ['read', 'write'],     // abilities (omit for all abilities)
  )

  // Return the plain-text token — it cannot be retrieved again
  return res.json({ token: plainTextToken })
})
```

The returned `plainTextToken` has the format `{id}|{randomHex}`. Only the SHA-256 hash is stored in the database.

## Middleware

### `SanctumMiddleware()`

Authenticates the request via the `Authorization: Bearer` header. Attaches `req.user` and the token record if valid. Does not block unauthenticated requests:

```ts
// bootstrap/app.ts
import { SanctumMiddleware } from '@rudderjs/sanctum'

Application.configure({ ... })
  .withMiddleware((m) => {
    m.use(SanctumMiddleware())
  })
  .create()
```

### `RequireToken(...abilities)`

Requires a valid Bearer token. Returns `401` if the token is missing or invalid. Optionally checks for specific abilities, returning `403` if the token lacks a required ability:

```ts
import { router } from '@rudderjs/router'
import { RequireToken } from '@rudderjs/sanctum'

// Require any valid token
router.get('/api/profile', RequireToken(), async (req, res) => {
  return res.json({ user: req.user })
})

// Require specific abilities
router.delete('/api/posts/:id', RequireToken('posts:delete'), async (req, res) => {
  // token must have the 'posts:delete' ability
  await deletePost(req.params.id)
  return res.json({ deleted: true })
})
```

## Token Abilities

Abilities are string-based permissions attached to each token. A token with `null` abilities (the default) can do everything. A token with `['*']` also has all abilities:

```ts
const sanctum = app().make<Sanctum>('sanctum')

// Create a read-only token
const { plainTextToken } = await sanctum.createToken(userId, 'read-only', ['read'])

// Check if a token has an ability
const can = sanctum.tokenCan(token, 'write') // false
```

## Managing Tokens

```ts
const sanctum = app().make<Sanctum>('sanctum')

// List all tokens for a user
const tokens = await sanctum.userTokens(userId)

// Revoke a specific token
await sanctum.revokeToken(tokenId)

// Revoke all tokens for a user
await sanctum.revokeAllTokens(userId)
```

## Token Guard

The `TokenGuard` implements the `Guard` interface from `@rudderjs/auth`, enabling Sanctum to integrate with the auth system:

```ts
import { TokenGuard } from '@rudderjs/sanctum'

const guard = new TokenGuard(sanctum, bearerToken)

const user = await guard.user()        // Authenticatable | null
const check = await guard.check()      // boolean
const token = guard.currentToken()     // PersonalAccessToken | null
const can   = guard.tokenCan('read')   // boolean
```

## Configuration

```ts
interface SanctumConfig {
  /** Domains allowed for SPA cookie auth (default: []) */
  stateful?: string[]
  /** Token expiration in minutes (null = no expiry, default: null) */
  expiration?: number | null
  /** Prefix for generated tokens (default: '') */
  tokenPrefix?: string
}
```

## Token Repository

By default, Sanctum uses `MemoryTokenRepository` (suitable for development and testing). For production, pass a custom `TokenRepository` implementation to the `sanctum()` provider:

```ts
// bootstrap/providers.ts
import { sanctum } from '@rudderjs/sanctum'
import { PrismaTokenRepository } from '../app/Repositories/PrismaTokenRepository.js'

export default [
  auth(configs.auth),
  sanctum(configs.sanctum, new PrismaTokenRepository()),
]
```

The `TokenRepository` interface:

```ts
interface TokenRepository {
  create(data: {
    userId: string; name: string; token: string;
    abilities?: string[] | null; expiresAt?: Date | null;
  }): Promise<PersonalAccessToken>

  findByToken(hashedToken: string): Promise<PersonalAccessToken | null>
  findByUserId(userId: string): Promise<PersonalAccessToken[]>
  updateLastUsed(id: string, date: Date): Promise<void>
  delete(id: string): Promise<void>
  deleteByUserId(userId: string): Promise<void>
}
```

## API Reference

| Export | Description |
|---|---|
| `Sanctum` | Core class — `createToken()`, `validateToken()`, `tokenCan()`, `userTokens()`, `revokeToken()`, `revokeAllTokens()` |
| `TokenGuard` | Guard implementation — stateless token-based auth via `Guard` interface |
| `SanctumMiddleware()` | Middleware — authenticates via Bearer token, sets `req.user` (non-blocking) |
| `RequireToken(...abilities)` | Middleware — requires valid token + optional ability check (401/403) |
| `TokenRepository` | Interface — implement for custom token storage backends |
| `MemoryTokenRepository` | Built-in in-memory token store (dev/testing only) |
| `PersonalAccessToken` | Type — token record shape |
| `NewAccessToken` | Type — `{ accessToken, plainTextToken }` returned by `createToken()` |
| `SanctumConfig` | Configuration interface |
| `sanctum(config?, tokenRepository?)` | Provider factory — returns a `ServiceProvider` class |

## Notes

- `sanctum()` must appear after `auth()` in `bootstrap/providers.ts` — it resolves the user provider from the auth manager at boot time.
- Plain-text tokens are returned once from `createToken()` and never stored. Only the SHA-256 hash is persisted.
- `MemoryTokenRepository` is used by default and resets on server restart. Implement `TokenRepository` with your database for production use.
- Expired tokens (past `expiresAt`) are rejected during validation but not automatically deleted from storage.
- `RequireToken()` with no arguments requires any valid token. Pass ability strings to enforce granular permissions.
- Tokens with `null` abilities have unrestricted access. Use `['*']` for the same effect when you want to be explicit.
