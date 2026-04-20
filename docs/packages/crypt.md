# @rudderjs/crypt

Symmetric encryption and decryption using AES-256-CBC with HMAC-SHA256 signing.

## Installation

```bash
pnpm add @rudderjs/crypt
```

No additional dependencies required — uses Node.js built-in `node:crypto`.

## Setup

1. Generate an encryption key:

```ts
import { Crypt } from '@rudderjs/crypt'

console.log(Crypt.generateKey())
// base64:A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v=
```

Add the generated key to your `.env` file:

```bash
APP_KEY=base64:A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v=
```

2. Create a config file at `config/crypt.ts`:

```ts
// config/crypt.ts
import { Env } from '@rudderjs/support'
import type { CryptConfig } from '@rudderjs/crypt'

export default {
  key: Env.get('APP_KEY', ''),
  previousKeys: [],
} satisfies CryptConfig
```

3. Register the provider in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { crypt } from '@rudderjs/crypt'
import configs from '../config/index.js'

export default [
  // ...other providers
  crypt(configs.crypt),
]
```

## Crypt Facade

The `Crypt` class provides a static facade for encryption and decryption:

```ts
import { Crypt } from '@rudderjs/crypt'

// Encrypt any value (serialized as JSON internally)
const encrypted = Crypt.encrypt({ userId: 42, role: 'admin' })

// Decrypt back to the original value
const data = Crypt.decrypt<{ userId: number; role: string }>(encrypted)
// { userId: 42, role: 'admin' }

// Encrypt/decrypt plain strings (no JSON serialization)
const cipher = Crypt.encryptString('sensitive-data')
const plain  = Crypt.decryptString(cipher)
// 'sensitive-data'
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `Crypt.encrypt(value)` | `string` | Encrypt any value (JSON-serialized). Returns a base64-encoded payload. |
| `Crypt.decrypt<T>(encrypted)` | `T` | Decrypt a value (JSON-deserialized). |
| `Crypt.encryptString(value)` | `string` | Encrypt a plain string (no JSON wrapping). |
| `Crypt.decryptString(encrypted)` | `string` | Decrypt a plain string (no JSON unwrapping). |
| `Crypt.generateKey()` | `string` | Generate a random 32-byte key, base64-encoded with `base64:` prefix. |

## Key Rotation

To rotate your encryption key without breaking existing encrypted data, move the old key to `previousKeys`:

```ts
// config/crypt.ts
export default {
  key: Env.get('APP_KEY', ''),
  previousKeys: [
    Env.get('APP_KEY_OLD', ''),   // previous key(s) for decryption
  ],
} satisfies CryptConfig
```

`Crypt.decrypt()` tries the current key first, then falls back to each previous key in order. New data is always encrypted with the current key.

## Key Parsing

The `parseKey()` function converts a key string to a `Buffer`:

```ts
import { parseKey } from '@rudderjs/crypt'

// base64-encoded key (recommended)
const key = parseKey('base64:A1b2C3d4...')

// raw UTF-8 key (must be exactly 32 bytes)
const key2 = parseKey('01234567890123456789012345678901')
```

The key must be exactly 32 bytes for AES-256. The provider validates this at boot time.

## Configuration

```ts
interface CryptConfig {
  /** APP_KEY — the primary encryption key. Prefix with `base64:` for base64-encoded keys. */
  key: string
  /** Previous keys for rotation. Decryption tries these after the primary key. */
  previousKeys?: string[]
}
```

## API Reference

| Export | Description |
|---|---|
| `Crypt` | Static facade — `encrypt()`, `decrypt()`, `encryptString()`, `decryptString()`, `generateKey()` |
| `CryptRegistry` | Global registry — `set(key, previousKeys?)`, `getKey()`, `getPreviousKeys()` |
| `CryptConfig` | Configuration interface |
| `parseKey(raw)` | Converts a key string (`base64:...` or raw) to a `Buffer` |
| `crypt(config)` | Provider factory — returns a `ServiceProvider` class |

## Notes

- Uses AES-256-CBC with HMAC-SHA256 for authenticated encryption — every payload contains an IV, ciphertext, and MAC.
- MAC verification uses `timingSafeEqual` to prevent timing attacks.
- Each `encrypt()` call generates a fresh random IV, so encrypting the same value twice produces different ciphertexts.
- The provider throws at boot time if `APP_KEY` is missing or not exactly 32 bytes.
- `Crypt.encrypt()` JSON-serializes the value before encrypting. Use `Crypt.encryptString()` when you need to encrypt a raw string without JSON wrapping.
- Used internally by `@rudderjs/orm` for encrypted attribute casts.
