# @rudderjs/hash

Password hashing facade with bcrypt and argon2 drivers.

## Installation

```bash
pnpm add @rudderjs/hash
```

For the argon2 driver, install the optional native dependency:

```bash
pnpm add argon2
```

## Setup

1. Create a config file at `config/hash.ts`:

```ts
// config/hash.ts
import type { HashConfig } from '@rudderjs/hash'

export default {
  driver: 'bcrypt',

  bcrypt: {
    rounds: 12,
  },

  argon2: {
    memory:  65536,
    time:    3,
    threads: 4,
  },
} satisfies HashConfig
```

2. Register the provider in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { hash } from '@rudderjs/hash'
import configs from '../config/index.js'

export default [
  // ...other providers
  hash(configs.hash),
]
```

## Hash Facade

The `Hash` class provides a static facade for hashing and verifying passwords:

```ts
import { Hash } from '@rudderjs/hash'

// Hash a password
const hashed = await Hash.make('secret-password')

// Verify a password against a hash
const valid = await Hash.check('secret-password', hashed) // true

// Check if a hash needs rehashing (e.g. after changing rounds)
if (Hash.needsRehash(hashed)) {
  const newHash = await Hash.make('secret-password')
  // persist newHash
}
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `Hash.make(value)` | `Promise<string>` | Hash a plain-text value |
| `Hash.check(value, hashed)` | `Promise<boolean>` | Check a plain-text value against a hash |
| `Hash.needsRehash(hashed)` | `boolean` | Determine if a hash needs rehashing (e.g. cost parameters changed) |

## Drivers

### BcryptDriver (default)

Uses `bcryptjs` (pure JS, no native compilation). The `rounds` parameter controls the cost factor:

```ts
import { BcryptDriver } from '@rudderjs/hash'

const driver = new BcryptDriver({ rounds: 14 })
const hashed = await driver.make('password')
```

Higher `rounds` values increase hashing time exponentially. The default is `12`.

### Argon2Driver

Uses the native `argon2` package with argon2id. Requires `pnpm add argon2`:

```ts
import { Argon2Driver } from '@rudderjs/hash'

const driver = new Argon2Driver({
  memory:  65536,   // 64 MB
  time:    3,       // iterations
  threads: 4,       // parallelism
})
```

`needsRehash()` parses the encoded parameters from the hash string and compares them against the current config. If any parameter differs, it returns `true`.

## Configuration

```ts
interface HashConfig {
  driver: 'bcrypt' | 'argon2'
  bcrypt?: BcryptConfig
  argon2?: Argon2Config
}

interface BcryptConfig {
  rounds?: number    // default: 12
}

interface Argon2Config {
  memory?:  number   // default: 65536 (64 MB)
  time?:    number   // default: 3
  threads?: number   // default: 4
}
```

## API Reference

| Export | Description |
|---|---|
| `Hash` | Static facade — `make()`, `check()`, `needsRehash()` |
| `HashDriver` | Interface — implement for custom drivers |
| `HashRegistry` | Global registry — `set(driver)`, `get()` |
| `BcryptDriver` | Built-in bcrypt driver (uses `bcryptjs`) |
| `Argon2Driver` | Built-in argon2 driver (uses native `argon2` package) |
| `HashConfig` | Configuration interface |
| `hash(config)` | Provider factory — returns a `ServiceProvider` class |

## Notes

- `hash()` must be registered before `auth()` in `bootstrap/providers.ts` — the auth system uses the hash driver for password verification.
- `BcryptDriver` uses `bcryptjs` (pure JavaScript) — no native compilation required.
- `Argon2Driver` requires the native `argon2` package: `pnpm add argon2`.
- `needsRehash()` is synchronous — it parses cost parameters from the hash string without performing any cryptographic operations.
- The `hash()` provider also binds the driver as `'hash'` in the DI container, accessible via `app().make<HashDriver>('hash')`.
