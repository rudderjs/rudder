import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ServiceProvider, config } from '@rudderjs/core'

// ─── Crypt Registry ───────────────────────────────────────

export class CryptRegistry {
  private static key: Buffer | null = null
  private static previousKeys: Buffer[] = []

  static set(key: Buffer, previousKeys?: Buffer[]): void {
    this.key = key
    this.previousKeys = previousKeys ?? []
    publishCryptBridge()
  }

  static getKey(): Buffer {
    if (!this.key) throw new Error('[RudderJS Crypt] No encryption key set. Add crypt() to providers and set APP_KEY.')
    return this.key
  }

  static getPreviousKeys(): Buffer[] { return this.previousKeys }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    this.key = null
    this.previousKeys = []
    delete (globalThis as Record<string, unknown>)['__rudderjs_crypt_registry__']
  }
}

// ─── globalThis bridge ────────────────────────────────────
// `@rudderjs/orm`'s `encrypted` cast can't import this node-only package (its
// cast funnel must stay client-bundle safe), so we publish a synchronous
// encrypt/decrypt pair onto a globalThis registry — the same pattern the
// `hashed` cast uses to reach `@rudderjs/hash` (`__rudderjs_hash_registry__`).
// Published whenever a key is set; cleared on reset. The string forms are used
// because the cast does its own JSON (de)serialization.
function publishCryptBridge(): void {
  ;(globalThis as Record<string, unknown>)['__rudderjs_crypt_registry__'] = {
    encrypt: (value: string): string => Crypt.encryptString(value),
    decrypt: (value: string): string => Crypt.decryptString(value),
  }
}

// ─── Payload ──────────────────────────────────────────────

interface EncryptedPayload {
  iv:   string  // hex
  value: string // base64 (ciphertext)
  mac:  string  // hex (HMAC-SHA256)
}

// ─── Core encrypt/decrypt ─────────────────────────────────

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

function computeMac(key: Buffer, iv: string, value: string): string {
  return createHmac('sha256', key).update(iv + value).digest('hex')
}

function encryptRaw(key: Buffer, data: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])

  const ivHex = iv.toString('hex')
  const valueBase64 = encrypted.toString('base64')
  const mac = computeMac(key, ivHex, valueBase64)

  return { iv: ivHex, value: valueBase64, mac }
}

function decryptRaw(key: Buffer, payload: EncryptedPayload): Buffer {
  const expectedMac = computeMac(key, payload.iv, payload.value)
  const macBuffer = Buffer.from(payload.mac, 'hex')
  const expectedBuffer = Buffer.from(expectedMac, 'hex')

  if (macBuffer.length !== expectedBuffer.length || !timingSafeEqual(macBuffer, expectedBuffer)) {
    throw new Error('[RudderJS Crypt] MAC verification failed — payload may have been tampered with.')
  }

  const iv = Buffer.from(payload.iv, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  return Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64')), decipher.final()])
}

function tryDecryptWithKeys(keys: Buffer[], payload: EncryptedPayload): Buffer {
  for (const key of keys) {
    try {
      return decryptRaw(key, payload)
    } catch {
      // try next key
    }
  }
  throw new Error('[RudderJS Crypt] Decryption failed — no matching key found.')
}

// ─── Crypt Facade ─────────────────────────────────────────

export class Crypt {
  /**
   * Encrypt a value (serialized as JSON).
   * Returns a base64-encoded JSON payload containing iv, ciphertext, and MAC.
   */
  static encrypt(value: unknown): string {
    const key = CryptRegistry.getKey()
    const data = Buffer.from(JSON.stringify(value), 'utf8')
    const payload = encryptRaw(key, data)
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }

  /**
   * Decrypt a value (deserialized from JSON).
   * Tries the current key first, then previous keys for rotation support.
   */
  static decrypt<T = unknown>(encrypted: string): T {
    let payload: EncryptedPayload
    try {
      payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as EncryptedPayload
    } catch {
      throw new Error('[RudderJS Crypt] Invalid encrypted payload — expected a base64-encoded JSON envelope.')
    }
    const keys = [CryptRegistry.getKey(), ...CryptRegistry.getPreviousKeys()]
    const decrypted = tryDecryptWithKeys(keys, payload)
    try {
      return JSON.parse(decrypted.toString('utf8')) as T
    } catch {
      throw new Error('[RudderJS Crypt] Decrypted payload is not valid JSON.')
    }
  }

  /**
   * Encrypt a plain string (no JSON serialization).
   */
  static encryptString(value: string): string {
    const key = CryptRegistry.getKey()
    const data = Buffer.from(value, 'utf8')
    const payload = encryptRaw(key, data)
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }

  /**
   * Decrypt a plain string (no JSON deserialization).
   */
  static decryptString(encrypted: string): string {
    let payload: EncryptedPayload
    try {
      payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as EncryptedPayload
    } catch {
      throw new Error('[RudderJS Crypt] Invalid encrypted payload — expected a base64-encoded JSON envelope.')
    }
    const keys = [CryptRegistry.getKey(), ...CryptRegistry.getPreviousKeys()]
    return tryDecryptWithKeys(keys, payload).toString('utf8')
  }

  /**
   * Generate a random key suitable for AES-256 (32 bytes), base64-encoded.
   */
  static generateKey(): string {
    return `base64:${randomBytes(32).toString('base64')}`
  }
}

// ─── Key Parsing ──────────────────────────────────────────

export function parseKey(raw: string): Buffer {
  const trimmed = raw.trim()
  if (trimmed.startsWith('base64:')) {
    return Buffer.from(trimmed.slice(7), 'base64')
  }
  return Buffer.from(trimmed, 'utf8')
}

// ─── Config ───────────────────────────────────────────────

export interface CryptConfig {
  /** APP_KEY — the primary encryption key. Prefix with `base64:` for base64-encoded keys. */
  key: string
  /** Previous keys for rotation. Decryption tries these after the primary key. */
  previousKeys?: string[]
}

// ─── Service Provider Factory ─────────────────────────────

/**
 * Returns a CryptServiceProvider configured for the given config.
 *
 * Uses AES-256-CBC with HMAC-SHA256 signing. Only needs `node:crypto`.
 *
 * Usage in bootstrap/providers.ts:
 *   import { crypt } from '@rudderjs/crypt'
 *   import configs from '../config/index.js'
 *   export default [..., crypt(configs.crypt), ...]
 */
export class CryptProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<CryptConfig>('crypt')

    if (!cfg.key) {
      throw new Error('[RudderJS Crypt] APP_KEY is not set. Run `Crypt.generateKey()` and add it to .env.')
    }

    const key = parseKey(cfg.key)
    if (key.length !== 32) {
      throw new Error(`[RudderJS Crypt] APP_KEY must be 32 bytes for AES-256. Got ${key.length} bytes.`)
    }

    const previousKeys = (cfg.previousKeys ?? []).map(parseKey)
    CryptRegistry.set(key, previousKeys)
    this.app.instance('crypt', Crypt)
  }
}
