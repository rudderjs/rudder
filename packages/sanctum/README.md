# @rudderjs/sanctum

Lightweight API token authentication for RudderJS. SHA-256 hashed tokens with per-token abilities.

## Installation

```bash
pnpm add @rudderjs/sanctum
```

## Setup

```ts
// bootstrap/providers.ts
import { sanctum } from '@rudderjs/sanctum'

export default [
  auth(configs.auth),
  sanctum({ tokenPrefix: '', expiration: null }),
]
```

## API Tokens

### Creating Tokens

```ts
import { app } from '@rudderjs/core'
import { Sanctum } from '@rudderjs/sanctum'

const sanctum = app().make<Sanctum>('sanctum')

// Create a token with all abilities
const { plainTextToken } = await sanctum.createToken(userId, 'api-key')
// → "1|a3f8c9..." — show once, never stored

// Create with specific abilities
const { plainTextToken } = await sanctum.createToken(userId, 'read-only', ['read'])

// Create with expiration
const { plainTextToken } = await sanctum.createToken(userId, 'temp', ['*'], new Date(Date.now() + 3600_000))
```

### Validating Tokens

```ts
const result = await sanctum.validateToken('Bearer 1|a3f8c9...')
if (result) {
  result.user   // Authenticatable
  result.token  // PersonalAccessToken
}
```

### Checking Abilities

```ts
sanctum.tokenCan(token, 'read')    // true
sanctum.tokenCan(token, 'delete')  // false — unless abilities is null or ['*']
```

### Revoking Tokens

```ts
await sanctum.revokeToken(tokenId)      // revoke one
await sanctum.revokeAllTokens(userId)   // revoke all
const tokens = await sanctum.userTokens(userId)  // list all
```

## Middleware

```ts
import { SanctumMiddleware, RequireToken } from '@rudderjs/sanctum'

// Attach user if token present (non-blocking)
Route.get('/api/data', handler, [SanctumMiddleware()])

// Require valid token
Route.get('/api/secret', handler, [RequireToken()])

// Require specific abilities
Route.delete('/api/posts/:id', handler, [RequireToken('delete')])
```

## Token Guard

For use with the auth system's guard pattern:

```ts
import { TokenGuard } from '@rudderjs/sanctum'

const guard = new TokenGuard(sanctum, req.headers['authorization'])
const user = await guard.user()
guard.tokenCan('read')  // check ability on current token
```

## Testing

`Sanctum.actingAs(user, abilities?)` authenticates a test as a user without seeding a token row or crafting a `Authorization: Bearer …` header — the equivalent of Laravel's `Sanctum::actingAs()`. It installs a `TransientToken` that `SanctumMiddleware` / `RequireToken` pick up in place of header validation, so `req.user`, `req.token`, and `tokenCan()` all resolve to the (possibly synthetic) user.

```ts
import { Sanctum } from '@rudderjs/sanctum'

// All abilities (default) — passes every RequireToken() check
Sanctum.actingAs(user)
await client.get('/api/secret').assertOk()

// Scoped token — exercises 403 paths for missing abilities
Sanctum.actingAs(user, ['posts:read'])
await client.delete('/api/posts/1').assertForbidden()

// Clear it in teardown so the user doesn't leak into later tests
afterEach(() => Sanctum.actingAsGuest())
```

`actingAs()` takes precedence over any Bearer header on the request. It is **test-only**: honored on a non-production runtime, ignored (and warned about) under `NODE_ENV=production`, so a stray call left in shipped code can never authenticate real traffic. The optional third `guard` argument is accepted for Laravel API compatibility but is unused — Sanctum has a single token guard.

## Config

| Option | Default | Description |
|--------|---------|-------------|
| `tokenPrefix` | `''` | Prefix for generated tokens |
| `expiration` | `null` | Default token lifetime in minutes (null = no expiry) |
| `stateful` | `[]` | Domains for SPA cookie auth |
| `provider` | default guard's provider | User provider name in `auth.providers`. Required for pure-API apps that don't configure a session guard. |

## Utility methods

`Sanctum` exposes two static helpers for custom token pipelines (custom repositories, external token issuance, token migration):

### `Sanctum.generateToken()`

Returns a cryptographically random 64-character hex string (32 bytes via `crypto.randomBytes`). This is the same source of entropy used by `createToken()` internally.

```ts
import { Sanctum } from '@rudderjs/sanctum'

const plain = Sanctum.generateToken()
// → "a3f8c9d2..." (64-char hex, unique each call)
```

### `Sanctum.hashToken(plainToken)`

SHA-256 hashes a plain token string and returns the 64-character hex digest. Sanctum stores this hash in the repository, never the plain text. Use it whenever you need to produce or compare a hash outside the normal `createToken()` flow.

```ts
const hashed = Sanctum.hashToken(plain)
// → "e3b0c44..." (SHA-256 hex)
```

### Common scenarios

**Seeding a known token in tests:**

```ts
import { Sanctum, MemoryTokenRepository } from '@rudderjs/sanctum'

const repo = new MemoryTokenRepository()
const plain = 'fixed-test-secret'
await repo.create({
  userId: '1',
  name: 'test-token',
  token: Sanctum.hashToken(plain),
})
// plain token to send in requests: `1|fixed-test-secret`
```

**Migrating existing tokens to Sanctum's format:**

```ts
for (const row of legacyTokens) {
  await newRepo.create({
    userId: row.user_id,
    name: row.label,
    // Hash the existing plain-text values so Sanctum can validate them
    token: Sanctum.hashToken(row.raw_token),
  })
}
```

**Building a custom token repository that accepts a pre-hashed value:**

```ts
const plain  = Sanctum.generateToken()
const hashed = Sanctum.hashToken(plain)
await myRepo.create({ userId, name, token: hashed })
// Hand `plain` to the client — it is never stored
```

## Hiding sensitive user columns

Sanctum strips functions, `password`, and both `rememberToken`/`remember_token` from `req.user` automatically. For app-specific sensitive columns (e.g. `two_factor_secret`, `email_verification_token`), implement `getHidden()` on your User model:

```ts
class User extends Model implements Authenticatable {
  getHidden(): string[] {
    return ['two_factor_secret', 'email_verification_token']
  }
}
```
