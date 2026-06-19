import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ServiceProvider, config } from '@rudderjs/core'

// ─── Cipher type ──────────────────────────────────────────

export type SupportedCipher = 'aes-256-cbc' | 'aes-256-gcm'

// ─── Crypt Registry ───────────────────────────────────────

export class CryptRegistry {
  private static key: Buffer | null = null
  private static previousKeys: Buffer[] = []
  private static cipher: SupportedCipher = 'aes-256-cbc'

  static set(key: Buffer, previousKeys?: Buffer[], cipher: SupportedCipher = 'aes-256-cbc'): void {
    if (key.length !== 32) {
      throw new Error(`[Rudder Crypt] CryptRegistry.set() requires a 32-byte key for AES-256. Got ${key.length} bytes. Use Crypt.generateKey() to generate a valid key.`)
    }
    for (const [i, k] of (previousKeys ?? []).entries()) {
      if (k.length !== 32) {
        throw new Error(`[Rudder Crypt] CryptRegistry.set() previousKeys[${i}] requires a 32-byte key for AES-256. Got ${k.length} bytes.`)
      }
    }
    this.key?.fill(0)
    for (const k of this.previousKeys) k.fill(0)
    this.key = key
    this.previousKeys = previousKeys ?? []
    this.cipher = cipher
    publishCryptBridge()
  }

  static getKey(): Buffer {
    if (!this.key) throw new Error('[Rudder Crypt] No encryption key set. Add crypt() to providers and set APP_KEY.')
    return this.key
  }

  static getPreviousKeys(): Buffer[] { return this.previousKeys }
  static getCipher(): SupportedCipher { return this.cipher }

  /** Test-cleanup hook (public — other packages reset across the boundary). */
  static reset(): void {
    this.key?.fill(0)
    for (const k of this.previousKeys) k.fill(0)
    this.key = null
    this.previousKeys = []
    this.cipher = 'aes-256-cbc'
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
  iv:    string   // base64 — 16-byte CBC nonce or 12-byte GCM nonce
  value: string   // base64 (ciphertext)
  mac?:  string   // hex (HMAC-SHA256, CBC only)
  tag?:  string   // base64 (AES-GCM auth tag, GCM only)
}

// ─── Core encrypt/decrypt ─────────────────────────────────

const CBC_IV_LENGTH = 16
const GCM_IV_LENGTH = 12

function computeMac(key: Buffer, iv: string, value: string): string {
  return createHmac('sha256', key).update(iv + value).digest('hex')
}

function encryptRaw(key: Buffer, data: Buffer, cipher: SupportedCipher): EncryptedPayload {
  if (cipher === 'aes-256-gcm') {
    const iv = randomBytes(GCM_IV_LENGTH)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([c.update(data), c.final()])
    return {
      iv:    iv.toString('base64'),
      value: encrypted.toString('base64'),
      tag:   c.getAuthTag().toString('base64'),
    }
  }
  // aes-256-cbc
  const iv = randomBytes(CBC_IV_LENGTH)
  const c = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([c.update(data), c.final()])
  const ivBase64    = iv.toString('base64')
  const valueBase64 = encrypted.toString('base64')
  return {
    iv:    ivBase64,
    value: valueBase64,
    mac:   computeMac(key, ivBase64, valueBase64),
  }
}

function decryptRaw(key: Buffer, payload: EncryptedPayload): Buffer {
  const iv = Buffer.from(payload.iv, 'base64')

  if (payload.tag !== undefined) {
    // GCM: auth tag replaces the external HMAC-SHA256 MAC.
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    try {
      return Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64')), decipher.final()])
    } catch {
      throw new Error('[Rudder Crypt] GCM authentication failed — payload may have been tampered with.')
    }
  }

  // CBC: validate HMAC-SHA256 before decrypting.
  if (payload.mac === undefined) {
    throw new Error('[Rudder Crypt] Malformed payload — CBC payload must have a mac field.')
  }
  const expectedMac    = computeMac(key, payload.iv, payload.value)
  const macBuffer      = Buffer.from(payload.mac, 'hex')
  const expectedBuffer = Buffer.from(expectedMac, 'hex')
  if (macBuffer.length !== expectedBuffer.length || !timingSafeEqual(macBuffer, expectedBuffer)) {
    throw new Error('[Rudder Crypt] MAC verification failed — payload may have been tampered with.')
  }
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
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
  throw new Error('[Rudder Crypt] Decryption failed — no matching key found.')
}

function parsePayload(encrypted: string): EncryptedPayload {
  let payload: EncryptedPayload
  try {
    payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as EncryptedPayload
  } catch {
    throw new Error('[Rudder Crypt] Invalid encrypted payload — expected a base64-encoded JSON envelope.')
  }
  if (typeof payload.iv !== 'string' || typeof payload.value !== 'string') {
    throw new Error('[Rudder Crypt] Malformed encrypted payload — iv and value must be strings.')
  }
  if (payload.mac !== undefined && typeof payload.mac !== 'string') {
    throw new Error('[Rudder Crypt] Malformed encrypted payload — mac must be a string.')
  }
  if (payload.tag !== undefined && typeof payload.tag !== 'string') {
    throw new Error('[Rudder Crypt] Malformed encrypted payload — tag must be a string.')
  }
  if (payload.mac === undefined && payload.tag === undefined) {
    throw new Error('[Rudder Crypt] Malformed encrypted payload — must have either mac (CBC) or tag (GCM).')
  }
  return payload
}

function resolvedKeys(): Buffer[] {
  return [CryptRegistry.getKey(), ...CryptRegistry.getPreviousKeys()]
}

// ─── Crypt Facade ─────────────────────────────────────────

export class Crypt {
  /**
   * Encrypt a value (serialized as JSON).
   * Returns a base64-encoded JSON payload containing iv, ciphertext, and MAC or auth tag.
   */
  static encrypt(value: unknown): string {
    const key = CryptRegistry.getKey()
    // JSON.stringify returns the JS value `undefined` (not a string) for
    // undefined / functions / symbols; Buffer.from(undefined) would then throw
    // an opaque node TypeError. Fail with a clear message instead.
    const json = JSON.stringify(value)
    if (json === undefined) {
      throw new Error('[Rudder Crypt] Cannot encrypt a value that serializes to undefined (undefined, function, or symbol).')
    }
    const data = Buffer.from(json, 'utf8')
    const payload = encryptRaw(key, data, CryptRegistry.getCipher())
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }

  /**
   * Decrypt a value (deserialized from JSON).
   * Tries the current key first, then previous keys for rotation support.
   * Auto-detects cipher from the payload shape (tag → GCM, mac → CBC).
   */
  static decrypt<T = unknown>(encrypted: string): T {
    const payload = parsePayload(encrypted)
    const decrypted = tryDecryptWithKeys(resolvedKeys(), payload)
    try {
      return JSON.parse(decrypted.toString('utf8')) as T
    } catch {
      throw new Error('[Rudder Crypt] Decrypted payload is not valid JSON.')
    }
  }

  /**
   * Encrypt a plain string (no JSON serialization).
   */
  static encryptString(value: string): string {
    const key = CryptRegistry.getKey()
    const data = Buffer.from(value, 'utf8')
    const payload = encryptRaw(key, data, CryptRegistry.getCipher())
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }

  /**
   * Decrypt a plain string (no JSON deserialization).
   * Auto-detects cipher from the payload shape (tag → GCM, mac → CBC).
   */
  static decryptString(encrypted: string): string {
    return tryDecryptWithKeys(resolvedKeys(), parsePayload(encrypted)).toString('utf8')
  }

  /**
   * Generate a random key suitable for AES-256 (32 bytes), base64-encoded.
   */
  static generateKey(): string {
    return `base64:${randomBytes(32).toString('base64')}`
  }

  /**
   * Return whether `key` is a valid key for the given `cipher`.
   * Mirrors Laravel's `Encrypter::supported($key, $cipher)`.
   */
  static supported(key: Buffer, cipher: string): boolean {
    return (cipher === 'aes-256-cbc' || cipher === 'aes-256-gcm') && key.length === 32
  }
}

// ─── Key Parsing ──────────────────────────────────────────

export function parseKey(raw: string): Buffer {
  const trimmed = raw.trim()
  if (trimmed.startsWith('base64:')) {
    const buf = Buffer.from(trimmed.slice(7), 'base64')
    if (buf.length !== 32) {
      throw new Error(
        `[Rudder Crypt] APP_KEY decoded to ${buf.length} bytes; expected 32. ` +
        `Regenerate the key with Crypt.generateKey() to get a valid 32-byte key.`,
      )
    }
    return buf
  }
  return Buffer.from(trimmed, 'utf8')
}

// ─── Config ───────────────────────────────────────────────

export interface CryptConfig {
  /** APP_KEY — the primary encryption key. Prefix with `base64:` for base64-encoded keys. */
  key: string
  /** Previous keys for rotation. Decryption tries these after the primary key. */
  previousKeys?: string[]
  /**
   * Encryption cipher. Default `'aes-256-cbc'` (Laravel-compatible CBC + HMAC-SHA256).
   * Set to `'aes-256-gcm'` for authenticated encryption without an external MAC step.
   * Decryption auto-detects the cipher from the stored payload, so existing CBC
   * ciphertexts remain readable after switching to GCM.
   */
  cipher?: SupportedCipher
}

// ─── Service Provider ─────────────────────────────────────

/**
 * Service provider that binds the Crypt service into the container.
 *
 * Supports AES-256-CBC (default, Laravel-compatible) and AES-256-GCM.
 * Only needs `node:crypto`.
 *
 * Picked up automatically by auto-discovery. For explicit registration:
 *
 *   import { CryptProvider } from '@rudderjs/crypt'
 *   export default [..., CryptProvider]
 */
export class CryptProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg = config<CryptConfig>('crypt')

    if (!cfg.key) {
      throw new Error('[Rudder Crypt] APP_KEY is not set. Run `Crypt.generateKey()` and add it to .env.')
    }

    const key = parseKey(cfg.key)
    if (key.length !== 32) {
      throw new Error(`[Rudder Crypt] APP_KEY must be 32 bytes for AES-256. Got ${key.length} bytes.`)
    }

    // Validate rotation keys with the same 32-byte rule as the primary key.
    // Without this a misconfigured previous key (wrong length / stray
    // whitespace) is accepted at boot and silently decrypts nothing — surfacing
    // only as a runtime "no matching key" on live ciphertext, not at deploy.
    const previousKeys = (cfg.previousKeys ?? []).map((raw, i) => {
      const k = parseKey(raw)
      if (k.length !== 32) {
        throw new Error(`[Rudder Crypt] previousKeys[${i}] must be 32 bytes for AES-256. Got ${k.length} bytes.`)
      }
      return k
    })

    const cipher = cfg.cipher ?? 'aes-256-cbc'
    if (cipher !== 'aes-256-cbc' && cipher !== 'aes-256-gcm') {
      throw new Error(`[Rudder Crypt] Unsupported cipher '${cipher as string}'. Supported: aes-256-cbc, aes-256-gcm.`)
    }

    CryptRegistry.set(key, previousKeys, cipher)
    this.app.instance('crypt', Crypt)
  }
}
