# @rudderjs/crypt

## Overview

Symmetric encryption — AES-256-CBC with HMAC-SHA256 authentication. Uses only `node:crypto` (no third-party deps). Provides the `Crypt` facade (`encrypt`/`decrypt` for any JSON value, `encryptString`/`decryptString` for raw strings) and key rotation via `APP_PREVIOUS_KEYS`. Required peer for the `encrypted` / `encrypted:array` / `encrypted:object` ORM casts.

## Key Patterns

### Setup

```ts
// Generate a key once, store in .env
import { Crypt } from '@rudderjs/crypt'
console.log(Crypt.generateKey())  // "base64:..." — 32-byte AES-256 key

// .env
APP_KEY=base64:your-random-32-byte-key
APP_PREVIOUS_KEYS=                  # comma-separated old keys during rotation

// config/crypt.ts
export default {
  key: process.env.APP_KEY ?? '',
  previousKeys: (process.env.APP_PREVIOUS_KEYS ?? '').split(',').filter(Boolean),
}

// bootstrap/providers.ts
import { crypt } from '@rudderjs/crypt'
export default [crypt(configs.crypt), ...]
```

### Usage

```ts
import { Crypt } from '@rudderjs/crypt'

// Any JSON-serializable value
const token = Crypt.encrypt({ userId: 42, scope: 'admin' })
const data  = Crypt.decrypt<{ userId: number; scope: string }>(token)

// Raw strings (no JSON wrapping)
const encrypted = Crypt.encryptString('secret')
const plain     = Crypt.decryptString(encrypted)
```

Both encrypt methods produce an authenticated ciphertext (HMAC-SHA256) — tampered ciphertexts fail to decrypt with a clear error rather than returning garbage.

### Key rotation

Add the outgoing key to `APP_PREVIOUS_KEYS` **before** deploying the new `APP_KEY`:

```env
APP_KEY=base64:new-key
APP_PREVIOUS_KEYS=base64:old-key-1,base64:old-key-2
```

Decryption tries the current key first, then falls through previous keys in order. New encryptions always use the current key. Once all existing ciphertext has been re-encrypted (or expired), drop old keys from `APP_PREVIOUS_KEYS`.

### Encrypted ORM casts

```ts
class User extends Model {
  static casts = {
    apiSecret:     'encrypted',          // string encrypted at rest
    metadata:      'encrypted:object',   // JSON encrypted at rest
    tagList:       'encrypted:array',    // array encrypted at rest
  }
}
```

The ORM calls `Crypt.encrypt()` on write and `Crypt.decrypt()` on read. Requires `@rudderjs/crypt` installed and registered.

## Common Pitfalls

- **Missing `APP_KEY`.** Throws at first `Crypt.encrypt()`/`decrypt()` call. Run `Crypt.generateKey()` once and add the output to `.env`.
- **Rotating without `APP_PREVIOUS_KEYS`.** Existing ciphertexts become undecryptable. Always add the outgoing key to `APP_PREVIOUS_KEYS` before deploying a new `APP_KEY`.
- **Storing encrypted values in columns with length limits.** Ciphertexts include IV + MAC + base64 overhead (~2× plaintext size). Use `TEXT` / unbounded columns.
- **Using `Crypt` for passwords.** Wrong tool — passwords need one-way hashing (`@rudderjs/hash`). `Crypt` is symmetric (decryptable), which is explicitly what you do NOT want for passwords.
- **Encrypting per-row sensitive data and then querying on it.** You can't `WHERE apiSecret = '...'` when `apiSecret` is encrypted. Either query on a deterministic hash column alongside, or decrypt in application code (slower but queryable plaintext never touches the DB).

## Key Imports

```ts
import { crypt, Crypt } from '@rudderjs/crypt'

import type { CryptConfig } from '@rudderjs/crypt'
```
