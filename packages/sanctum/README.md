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

## Token Storage

Sanctum needs somewhere to persist its tokens. Two repositories ship with the package:

- **`MemoryTokenRepository`** (default) — an in-process store, perfect for tests and local dev. Tokens vanish on restart and aren't shared across instances, so it is **not** for production.
- **`OrmTokenRepository`** — a durable, ORM-backed store (from the `@rudderjs/sanctum/orm` subpath). Use this in production.

`OrmTokenRepository` depends on `@rudderjs/orm` (an optional peer — install it only when you use the durable store):

```bash
pnpm add @rudderjs/orm
```

Pass an instance as the second argument to `sanctum()`:

```ts
// bootstrap/providers.ts
import { sanctum } from '@rudderjs/sanctum'
import { OrmTokenRepository } from '@rudderjs/sanctum/orm'

export default [
  auth(configs.auth),
  sanctum({ expiration: null }, new OrmTokenRepository()),
]
```

Then add the migration (`database/migrations/xxxx_create_personal_access_tokens_table.ts`):

```ts
import { Migration, Schema } from '@rudderjs/orm/native'

export default class extends Migration {
  async up() {
    await Schema.create('personal_access_tokens', (t) => {
      t.ulid('id').primary()
      t.string('userId').index()
      t.string('name')
      t.string('token').unique()       // SHA-256 hash, never the plain text
      t.text('abilities').nullable()   // JSON-encoded string[] | null
      t.dateTime('lastUsedAt').nullable()
      t.dateTime('expiresAt').nullable()
      t.dateTime('createdAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('personal_access_tokens')
  }
}
```

Run it with `pnpm rudder migrate`. The same `PersonalAccessTokenModel` runs on the native engine, Prisma, and Drizzle (string ULID primary key).

To clean up expired tokens with `rudder model:prune`, register the model once at boot:

```ts
import { ModelRegistry } from '@rudderjs/orm'
import { PersonalAccessTokenModel } from '@rudderjs/sanctum/orm'

ModelRegistry.register(PersonalAccessTokenModel)
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
| `provider` | default guard's provider | User provider name in `auth.providers`. Required for pure-API apps that don't configure a session guard. |

## Hiding sensitive user columns

Sanctum strips functions, `password`, and both `rememberToken`/`remember_token` from `req.user` automatically. For app-specific sensitive columns (e.g. `two_factor_secret`, `email_verification_token`), implement `getHidden()` on your User model:

```ts
class User extends Model implements Authenticatable {
  getHidden(): string[] {
    return ['two_factor_secret', 'email_verification_token']
  }
}
```
