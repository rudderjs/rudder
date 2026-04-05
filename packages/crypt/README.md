# @rudderjs/crypt

Symmetric encryption for RudderJS. AES-256-CBC with HMAC-SHA256 signing. Uses only `node:crypto`.

## Installation

```bash
pnpm add @rudderjs/crypt
```

## Setup

Generate a key:

```ts
import { Crypt } from '@rudderjs/crypt'
console.log(Crypt.generateKey()) // "base64:..."
```

Add to `.env`:

```env
APP_KEY=base64:your-random-32-byte-key
APP_PREVIOUS_KEYS=                        # comma-separated old keys for rotation
```

```ts
// config/crypt.ts
export default {
  key: env('APP_KEY', ''),
  previousKeys: env('APP_PREVIOUS_KEYS', '').split(',').filter(Boolean),
}

// bootstrap/providers.ts
import { crypt } from '@rudderjs/crypt'
export default [crypt(configs.crypt), ...]
```

## Usage

```ts
import { Crypt } from '@rudderjs/crypt'

// Encrypt any JSON-serializable value
const encrypted = Crypt.encrypt({ userId: 42 })
const data = Crypt.decrypt(encrypted) // { userId: 42 }

// String-only (no JSON serialization)
const token = Crypt.encryptString('secret')
const plain = Crypt.decryptString(token) // "secret"
```

## Key Rotation

Add the old key to `APP_PREVIOUS_KEYS` before rotating. Decryption tries the current key first, then previous keys in order. New encryptions always use the current key.

```env
APP_KEY=base64:new-key
APP_PREVIOUS_KEYS=base64:old-key-1,base64:old-key-2
```

## Security

- AES-256-CBC encryption
- HMAC-SHA256 authentication (encrypt-then-MAC)
- Timing-safe MAC comparison
- Random IV per encryption (same plaintext produces different ciphertext)
