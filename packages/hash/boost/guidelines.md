# @rudderjs/hash

## Overview

One-way password hashing — bcrypt (default, pure JS via `bcryptjs`, no native build) and argon2 (optional peer, native). Provides the `Hash` facade with `make`, `check`, and `needsRehash`. **Required peer of `@rudderjs/auth`** — `EloquentUserProvider.validateCredentials()` calls `hashCheck()` internally, and `hash()` must appear before `authProvider()` in the providers array.

## Key Patterns

### Setup

```ts
// config/hash.ts
export default {
  driver: 'bcrypt',
  bcrypt: { rounds: 12 },
  argon2: { memory: 65536, time: 3, threads: 4 },
} satisfies HashConfig

// bootstrap/providers.ts — hash MUST come before authProvider
import { hash } from '@rudderjs/hash'
import { authProvider } from '@rudderjs/auth'

export default [
  hash(configs.hash),
  authProvider(configs.auth),
]
```

### Usage

```ts
import { Hash } from '@rudderjs/hash'

const hashed = await Hash.make('password')         // hash on register/password-change
const valid  = await Hash.check('password', hashed) // verify on login

if (Hash.needsRehash(hashed)) {
  // Rounds changed since this hash was made — rehash after successful login
  const upgraded = await Hash.make('password')
  await User.update(user.id, { password: upgraded })
}
```

### Bcrypt (default)

Uses `bcryptjs` — pure JavaScript, no native compilation. Slower than native bcrypt but works everywhere Node runs (including Bun, Deno, Cloudflare Workers). Default rounds: 12.

### Argon2 (optional)

Install the peer: `pnpm add argon2`. Faster for the same security level, but requires native build (fails on runtimes without native bindings).

## Common Pitfalls

- **`hash()` after `authProvider()` in providers array.** Auth's `validateCredentials` looks up `Hash` at boot; if `hash()` hasn't run yet, auth throws. Order matters.
- **`argon2` not installed.** The driver lazy-loads the SDK. Set `driver: 'argon2'` without installing → error on first `Hash.make()`.
- **Mixing drivers across environments.** A hash generated with bcrypt won't verify with argon2 (different algorithm). Pick one driver per deployment; use `needsRehash()` + re-hash-on-login to migrate gradually.
- **Rounds tuning.** 12 is a reasonable default for 2026. Going below 10 is insecure; going above 14 gets visibly slow on every login. Benchmark on your hardware before changing.
- **Hashing non-passwords.** `@rudderjs/hash` is for passwords specifically (one-way, intentionally slow). For API tokens, use `@rudderjs/crypt` (symmetric encryption) or SHA-256 hashing as appropriate — Passport uses SHA-256 for client secrets and JWT signing for tokens.

## Key Imports

```ts
import { hash, Hash } from '@rudderjs/hash'

import type { HashConfig } from '@rudderjs/hash'
```
