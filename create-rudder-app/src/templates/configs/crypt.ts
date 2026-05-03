export function configCrypt(): string {
  return `import { Env } from '@rudderjs/core'
import type { CryptConfig } from '@rudderjs/crypt'

// AES-256-CBC encryption with HMAC-SHA256 signing. Generate a key with:
//   node -e "console.log('base64:' + require('crypto').randomBytes(32).toString('base64'))"
//
// Rotating keys: move the old key into \`previousKeys\` and set a new \`key\`.
// Decryption tries the primary key first, then walks previousKeys in order.
export default {
  key:          Env.get('APP_KEY', ''),
  previousKeys: [],
} satisfies CryptConfig
`
}
