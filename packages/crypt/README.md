# @rudderjs/crypt

Symmetric encryption for Rudder. Supports AES-256-CBC (default, Laravel-compatible) and AES-256-GCM. Uses only `node:crypto`.

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
```

```ts
// config/crypt.ts
export default {
  key: env('APP_KEY', ''),
  previousKeys: [],   // see Key Rotation below
  // cipher: 'aes-256-gcm',  // optional — see Cipher below
}
```

`CryptProvider` is picked up by [auto-discovery](https://github.com/rudderjs/rudder/blob/main/docs/guide/service-providers.md#auto-discovery) — `pnpm rudder providers:discover` is all that's needed.

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

## Cipher

The default cipher is `aes-256-cbc` (CBC + HMAC-SHA256, compatible with Laravel's `Encrypter`). Switch to `aes-256-gcm` for modern authenticated encryption without an external MAC step:

```ts
// config/crypt.ts
export default {
  key: env('APP_KEY', ''),
  cipher: 'aes-256-gcm',
}
```

Decryption auto-detects the cipher from the stored payload (presence of `tag` → GCM, `mac` → CBC), so existing CBC ciphertexts remain readable after switching to GCM.

Check whether a key is valid for a given cipher (mirrors Laravel's `Encrypter::supported()`):

```ts
Crypt.supported(key, 'aes-256-gcm') // true/false
```

## Key Rotation

Move the old key into `previousKeys` in `config/crypt.ts` before rotating. Decryption tries the current key first, then previous keys in order. New encryptions always use the current key.

```env
APP_KEY=base64:new-key
APP_KEY_OLD=base64:old-key
```

```ts
// config/crypt.ts
export default {
  key: env('APP_KEY', ''),
  previousKeys: [env('APP_KEY_OLD', '')].filter(Boolean),
}
```

## Security

- AES-256-CBC: HMAC-SHA256 authentication (encrypt-then-MAC), timing-safe MAC comparison
- AES-256-GCM: native authenticated encryption, no external MAC needed
- Random IV per encryption (same plaintext produces different ciphertext)
- Laravel payload format compatibility (IV base64-encoded, same JSON envelope)

## Migration from 1.x

Version 2.0 changes the IV encoding in the CBC payload from **hex to base64** to match Laravel's `Encrypter` wire format. Ciphertexts produced by 1.x are not readable by 2.x. Re-encrypt stored values after upgrading:

```ts
// one-time migration script
const old1xPayload = '...' // from your database / cookies
// 1.x: manually decode the old hex-IV payload and re-encrypt
const raw = JSON.parse(Buffer.from(old1xPayload, 'base64').toString('utf8'))
const iv  = Buffer.from(raw.iv, 'hex')   // 1.x used hex
// ... decrypt with node:crypto directly, then re-encrypt with Crypt.encrypt()
```
