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

## Config

| Option | Default | Description |
|--------|---------|-------------|
| `tokenPrefix` | `''` | Prefix for generated tokens |
| `expiration` | `null` | Default token lifetime in minutes (null = no expiry) |
| `stateful` | `[]` | Domains for SPA cookie auth |
