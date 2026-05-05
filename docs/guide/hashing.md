# Hashing

`@rudderjs/hash` is the framework's password hashing facade. It ships with bcrypt (pure JavaScript, default) and argon2 (native, opt-in) drivers, exposes a small `Hash` facade, and integrates with `@rudderjs/auth` for password verification on login.

## Setup

```bash
pnpm add @rudderjs/hash
```

For argon2, also install the native package:

```bash
pnpm add argon2
```

```ts
// config/hash.ts
import type { HashConfig } from '@rudderjs/hash'

export default {
  driver: 'bcrypt',
  bcrypt: { rounds: 12 },
  argon2: { memory: 65536, time: 3, threads: 4 },
} satisfies HashConfig
```

The provider is auto-discovered. When `@rudderjs/auth` is also installed, `HashProvider` must boot before `AuthProvider` — auto-discovery orders this correctly via the `infrastructure` stage.

## The Hash facade

```ts
import { Hash } from '@rudderjs/hash'

const hashed = await Hash.make('secret-password')
const ok     = await Hash.check('secret-password', hashed)   // true

if (Hash.needsRehash(hashed)) {
  // Cost parameters changed since this hash was created
  const fresh = await Hash.make('secret-password')
  // persist fresh
}
```

| Method | Returns | Description |
|---|---|---|
| `Hash.make(value)` | `Promise<string>` | Hash a plain-text value |
| `Hash.check(value, hashed)` | `Promise<boolean>` | Verify a plain-text value against a hash |
| `Hash.needsRehash(hashed)` | `boolean` | Sync check: does the hash use the current cost parameters? |

`needsRehash()` parses the hash format directly without performing any cryptographic work, so it's safe to call on every login. The typical pattern is: verify on login, rehash if `needsRehash()` returns true, persist the new hash.

## Drivers

### Bcrypt (default)

Uses `bcryptjs` — pure JavaScript, no native compilation. The `rounds` parameter is the cost factor; each increment doubles hashing time.

```ts
import { BcryptDriver } from '@rudderjs/hash'

const driver = new BcryptDriver({ rounds: 14 })
```

12 is a reasonable default in 2026. 14+ for high-value targets.

### Argon2

Uses the native `argon2` package with argon2id. Argon2 is the OWASP-recommended algorithm for new applications.

```ts
import { Argon2Driver } from '@rudderjs/hash'

const driver = new Argon2Driver({
  memory:  65536,   // 64 MB
  time:    3,       // iterations
  threads: 4,       // parallelism
})
```

The driver records each parameter in the encoded hash, so `needsRehash()` can compare them against the current config without re-hashing.

## Picking a driver

| | Bcrypt | Argon2 |
|---|---|---|
| Native dep | No (`bcryptjs`) | Yes (`argon2`) |
| Memory hardness | No | Yes (configurable) |
| OWASP recommendation (2026) | Acceptable | Preferred for new apps |
| Performance on edge runtimes | Works | Native binding limits portability |

Use bcrypt unless you specifically need argon2's memory hardness — e.g. high-value password databases or compliance requirements. The driver is swappable: change `driver: 'argon2'` and call `Hash.needsRehash()` on login to migrate hashes lazily.

## Custom drivers

Implement `HashDriver` to plug in scrypt, PBKDF2, or a remote hashing service:

```ts
import type { HashDriver } from '@rudderjs/hash'
import { HashRegistry } from '@rudderjs/hash'

class ScryptDriver implements HashDriver {
  async make(value: string): Promise<string> { /* ... */ }
  async check(value: string, hashed: string): Promise<boolean> { /* ... */ }
  needsRehash(hashed: string): boolean { /* ... */ }
}

HashRegistry.set(new ScryptDriver())
```

## When to use hashing vs. encryption

- **Hashing** is one-way. Use it for data you need to *verify* but never read back — passwords, API keys, file fingerprints.
- **Encryption** is reversible. Use it for data you need to read back — encrypted columns, signed cookies. See [Encryption](/guide/encryption).

## Pitfalls

- **Provider order.** `HashProvider` must boot before `AuthProvider` — auth depends on the hash driver for password verification. Auto-discovery handles this; manual orderings need it spelled out.
- **Argon2 native build failures.** Some platforms (Cloudflare Workers, Deno without `--allow-ffi`) can't load native modules. Use bcrypt for portable deployments.
- **Increasing rounds in production.** Raise the cost factor and ship — old hashes still validate, and `Hash.needsRehash()` flags them for migration on next login.
