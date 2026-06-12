# Sanctum

API token authentication for stateless API routes — create, validate, and revoke personal access tokens with abilities. Lighter than Passport: no OAuth, no JWT, just opaque bearer tokens you issue and verify yourself.

Use Sanctum when:

- You need API tokens but don't need OAuth's third-party-app flows
- You're building a first-party SPA or mobile app talking to your own API
- You want simple ability-scoped tokens without RSA key management

Use [Passport](/packages/passport) when you need third-party OAuth clients, JWTs verifiable without a server call, or device-flow authentication.

## Install

```bash
pnpm add @rudderjs/sanctum
```

```ts
// config/sanctum.ts
import type { SanctumConfig } from '@rudderjs/sanctum'

export default {
  expiration:  null,    // minutes until tokens expire (null = no global expiry)
  tokenPrefix: '',      // optional prefix on generated tokens
  // provider: 'users', // override the user provider — required for pure-API
                        //   apps that don't configure a session guard
} satisfies SanctumConfig
```

The provider is auto-discovered. Sanctum requires `@rudderjs/auth` — register order is enforced by auto-discovery (`auth` → `sanctum`). Sanctum resolves its user provider directly from `auth.providers` and does **not** require `@rudderjs/session` to be installed.

Add the `PersonalAccessToken` table to your Prisma schema:

```bash
pnpm rudder vendor:publish --tag=sanctum-schema
pnpm rudder migrate
```

## Issuing tokens

```ts
import { app } from '@rudderjs/core'
import type { Sanctum } from '@rudderjs/sanctum'

router.post('/api/tokens', async (req, res) => {
  const sanctum = app().make<Sanctum>('sanctum')

  const { plainTextToken } = await sanctum.createToken(
    req.user.id,
    'cli-token',
    ['read', 'write'],   // abilities; omit for unrestricted
  )

  // plainTextToken is shown ONCE — only the SHA-256 hash is persisted
  return res.json({ token: plainTextToken })
})
```

The token shape is `{id}|{randomHex}`. Treat it like a password: surface it once, never recover it.

## Protecting routes

`RequireToken()` validates the `Authorization: Bearer` header. With ability arguments, it also enforces scope:

```ts
import { RequireToken } from '@rudderjs/sanctum'

// Any valid token
router.get('/api/profile', RequireToken(), async (req) => ({ user: req.user }))

// Token must include the 'posts:delete' ability
router.delete('/api/posts/:id', RequireToken('posts:delete'), deletePost)
```

Returns 401 for missing or invalid tokens, 403 when the token lacks a required ability.

For a non-blocking auth check (attach `req.user` if present, allow anonymous otherwise), use `SanctumMiddleware()` instead:

```ts
import { SanctumMiddleware } from '@rudderjs/sanctum'

m.api(SanctumMiddleware())
```

## Abilities

Abilities are string permissions per token. Tokens with `null` or `['*']` abilities can do everything; otherwise the token only authorizes its listed abilities.

```ts
const sanctum = app().make<Sanctum>('sanctum')

const can = sanctum.tokenCan(token, 'write')   // boolean
```

Adopt a convention like `posts:read`, `posts:write`, `admin` and treat unknown abilities as denied.

## Managing tokens

```ts
const sanctum = app().make<Sanctum>('sanctum')

await sanctum.userTokens(userId)         // list
await sanctum.revokeToken(tokenId)       // revoke one
await sanctum.revokeAllTokens(userId)    // revoke all for a user
```

Build an account-page UI on top of these — name + creation date + revoke button is the typical shape.

## Token guard

`TokenGuard` implements `@rudderjs/auth`'s `Guard` interface, so Sanctum slots into the auth manager when you want a non-default guard:

```ts
import { TokenGuard } from '@rudderjs/sanctum'

const guard = new TokenGuard(sanctum, bearerToken)

const user  = await guard.user()
const ok    = await guard.check()
const token = guard.currentToken()
const can   = guard.tokenCan('read')
```

## Storage

The default `MemoryTokenRepository` is in-process and resets on restart — fine for tests, useless for production. Pass a custom repository to the provider:

```ts
import { sanctum } from '@rudderjs/sanctum'
import { PrismaTokenRepository } from '../app/Repositories/PrismaTokenRepository.js'

sanctum(configs.sanctum, new PrismaTokenRepository())
```

The `TokenRepository` interface:

```ts
interface TokenRepository {
  create(data: { userId: string; name: string; token: string; abilities?: string[] | null; expiresAt?: Date | null }): Promise<PersonalAccessToken>
  findByToken(hashedToken: string): Promise<PersonalAccessToken | null>
  findByUserId(userId: string): Promise<PersonalAccessToken[]>
  updateLastUsed(id: string, date: Date): Promise<void>
  delete(id: string): Promise<void>
  deleteByUserId(userId: string): Promise<void>
}
```

A Prisma-backed implementation is ~30 lines — see the package source for a reference.

## Configuration

```ts
interface SanctumConfig {
  stateful?:    string[]      // domains allowed for SPA cookie auth (default: [])
  expiration?:  number | null // global token lifetime in minutes (default: null = no expiry)
  tokenPrefix?: string        // optional prefix on generated tokens
  provider?:    string        // user provider name (default: default guard's provider)
}
```

> `expiration` sets a global token lifetime in minutes: a token is rejected at validation once it is older than `expiration` minutes (measured from its `createdAt`). A per-token `expiresAt` passed to `createToken()` is an explicit override and always wins over the global value. With neither set, tokens never expire.

`stateful` is for first-party SPAs that share a domain with the API — those requests authenticate via the session cookie instead of a Bearer token. Set this to your SPA's domain(s) when applicable.

`provider` overrides which entry in `auth.providers` Sanctum uses to look up users. Set this in pure-API apps that don't configure a session guard, otherwise Sanctum falls back to the default guard's provider.

## Hiding sensitive columns

`req.user` is a serialized snapshot of your authenticatable. Sanctum strips functions, `password`, and both naming conventions of the remember-me token (`rememberToken` + `remember_token`) automatically. To hide app-specific sensitive columns (`two_factor_secret`, `email_verification_token`, etc.), implement `getHidden()` on your User model:

```ts
class User extends Model implements Authenticatable {
  // …
  getHidden(): string[] {
    return ['two_factor_secret', 'email_verification_token']
  }
}
```

These columns will be omitted from `req.user` (and `req.user`'s JSON serialization) without affecting your DB schema or query results.

## Pitfalls

- **`MemoryTokenRepository` in production.** Tokens disappear on restart. Implement `TokenRepository` against your database before going live.
- **Plain-text token leaking.** It comes back from `createToken()` once. Never log it, never persist it server-side beyond the response.
- **Tokens with `null` abilities.** They have unrestricted access. Either explicitly require abilities (`RequireToken('admin')`) or be sure that's what you want.
- **Expired tokens not auto-deleted.** Past-`expiresAt` tokens are rejected at validation but stay in the table. There is no built-in purge — run a periodic cleanup that deletes rows where `expiresAt` is in the past (e.g. a scheduled task against your `TokenRepository` or a direct `DELETE` on the tokens table).
