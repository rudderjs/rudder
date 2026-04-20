# @rudderjs/sanctum

## Overview

Lightweight API token authentication — SHA-256 hashed tokens with per-token abilities. The "middle ground" between session auth (`@rudderjs/auth`) and full OAuth 2 (`@rudderjs/passport`). Use Sanctum when you want simple API tokens without OAuth's complexity: SPAs with the same domain, mobile apps, personal access tokens without scopes you'd publish in a discovery doc.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { authProvider } from '@rudderjs/auth'
import { sanctum }      from '@rudderjs/sanctum'

export default [
  authProvider(configs.auth),
  sanctum({ tokenPrefix: '', expiration: null }),
]
```

### Creating tokens

```ts
import { app } from '@rudderjs/core'
import type { Sanctum } from '@rudderjs/sanctum'

const sanctum = app().make<Sanctum>('sanctum')

// All abilities
const { plainTextToken } = await sanctum.createToken(userId, 'api-key')
// → "1|a3f8c9..." — show once, never recoverable

// Restricted abilities
const { plainTextToken } = await sanctum.createToken(userId, 'read-only', ['read'])

// With expiration
const { plainTextToken } = await sanctum.createToken(
  userId,
  'temp',
  ['*'],
  new Date(Date.now() + 3600_000),
)
```

The returned `plainTextToken` is `<id>|<plaintext>`. Only the ID + SHA-256 hash is stored — the plaintext never touches the DB after creation.

### Validating tokens

```ts
const result = await sanctum.validateToken('Bearer 1|a3f8c9...')
if (result) {
  result.user    // Authenticatable
  result.token   // PersonalAccessToken — has .can(ability), .tokenable_id, etc.
}
```

### Middleware

```ts
import { SanctumMiddleware, RequireAbility } from '@rudderjs/sanctum'

// Validate the bearer token, populate req.user + req.token
Route.get('/api/me', handler, [SanctumMiddleware()])

// Enforce ability
Route.post('/api/posts', handler, [SanctumMiddleware(), RequireAbility('write')])
```

### Sanctum vs Passport

| Feature | Sanctum | Passport |
|---|---|---|
| Auth model | Simple tokens with abilities | Full OAuth 2 (authcode, PKCE, clients, refresh, device) |
| Token format | Opaque `<id>|<plain>` | RS256-signed JWT |
| Server verification | DB lookup required | Signature verification (can offload) |
| Third-party clients | No formal client concept | First-class OAuth clients |
| Use case | First-party SPAs, mobile apps, PATs | Public APIs, integrations, SSO |

Use Sanctum for "my own app's tokens." Use Passport when third parties need to authenticate against you.

## Common Pitfalls

- **`sanctum()` before `authProvider()`.** Sanctum depends on the auth user resolver — auth must boot first.
- **Expecting the DB schema to auto-create.** Publish the Prisma schema: `pnpm rudder vendor:publish --tag=sanctum-schema`.
- **Abilities as scopes.** Abilities check equality or wildcard `*`. No hierarchical scopes (`admin.users.read`) — pick flat abilities like `['read', 'write', 'admin']`.
- **Forgetting `tokenable_type` on plural user models.** The default assumes the `User` model. If you have multiple authenticatable models (e.g. `User` + `ApiClient`), use `tokenable_type` to disambiguate.
- **Revoking.** `sanctum.revokeToken(tokenId)` for one, or `revokeAllTokens(userId)` for all. Reading the current token inside a route after `SanctumMiddleware`: `req.token`.
- **Mixing with `@rudderjs/passport`.** Both can coexist — Sanctum for first-party API, Passport for third-party OAuth. Don't try to validate Passport JWTs with Sanctum's `validateToken` — different formats.

## Key Imports

```ts
import { sanctum, Sanctum, SanctumMiddleware, RequireAbility } from '@rudderjs/sanctum'

import type { SanctumConfig, PersonalAccessToken } from '@rudderjs/sanctum'
```
