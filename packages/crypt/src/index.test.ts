import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { crypt, Crypt, CryptRegistry, parseKey } from './index.js'

const TEST_KEY = `base64:${randomBytes(32).toString('base64')}`
const TEST_KEY_2 = `base64:${randomBytes(32).toString('base64')}`

function setup(key = TEST_KEY, previousKeys?: string[]) {
  CryptRegistry.reset()
  CryptRegistry.set(parseKey(key), previousKeys?.map(parseKey))
}

// ─── Crypt.encrypt / decrypt ─────────────────────────────

describe('Crypt.encrypt / decrypt', () => {
  beforeEach(() => setup())

  it('round-trips a string value', () => {
    const encrypted = Crypt.encrypt('hello')
    assert.strictEqual(Crypt.decrypt(encrypted), 'hello')
  })

  it('round-trips a number', () => {
    const encrypted = Crypt.encrypt(42)
    assert.strictEqual(Crypt.decrypt(encrypted), 42)
  })

  it('round-trips an object', () => {
    const obj = { userId: 1, role: 'admin' }
    const encrypted = Crypt.encrypt(obj)
    assert.deepStrictEqual(Crypt.decrypt(encrypted), obj)
  })

  it('round-trips an array', () => {
    const arr = [1, 'two', { three: 3 }]
    const encrypted = Crypt.encrypt(arr)
    assert.deepStrictEqual(Crypt.decrypt(encrypted), arr)
  })

  it('round-trips null', () => {
    const encrypted = Crypt.encrypt(null)
    assert.strictEqual(Crypt.decrypt(encrypted), null)
  })

  it('round-trips boolean', () => {
    assert.strictEqual(Crypt.decrypt(Crypt.encrypt(true)), true)
    assert.strictEqual(Crypt.decrypt(Crypt.encrypt(false)), false)
  })

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = Crypt.encrypt('same')
    const b = Crypt.encrypt('same')
    assert.notStrictEqual(a, b)
  })

  it('fails to decrypt with a different key', () => {
    const encrypted = Crypt.encrypt('secret')
    setup(TEST_KEY_2)
    assert.throws(() => Crypt.decrypt(encrypted), /failed/)
  })

  it('detects tampered ciphertext', () => {
    const encrypted = Crypt.encrypt('data')
    const payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'))
    payload.value = payload.value.slice(0, -2) + 'XX'
    const tampered = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    assert.throws(() => Crypt.decrypt(tampered), /failed/)
  })

  it('detects tampered MAC', () => {
    const encrypted = Crypt.encrypt('data')
    const payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'))
    payload.mac = '00'.repeat(32)
    const tampered = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    assert.throws(() => Crypt.decrypt(tampered), /failed/)
  })
})

// ─── Crypt.encryptString / decryptString ──────────────────

describe('Crypt.encryptString / decryptString', () => {
  beforeEach(() => setup())

  it('round-trips a plain string', () => {
    const encrypted = Crypt.encryptString('hello world')
    assert.strictEqual(Crypt.decryptString(encrypted), 'hello world')
  })

  it('handles empty string', () => {
    const encrypted = Crypt.encryptString('')
    assert.strictEqual(Crypt.decryptString(encrypted), '')
  })

  it('handles unicode', () => {
    const text = 'مرحبا بالعالم 🌍'
    const encrypted = Crypt.encryptString(text)
    assert.strictEqual(Crypt.decryptString(encrypted), text)
  })

  it('produces different ciphertext each time', () => {
    const a = Crypt.encryptString('same')
    const b = Crypt.encryptString('same')
    assert.notStrictEqual(a, b)
  })
})

// ─── Key Rotation ─────────────────────────────────────────

describe('Key rotation', () => {
  it('decrypts with the previous key after rotation', () => {
    // Encrypt with old key
    setup(TEST_KEY)
    const encrypted = Crypt.encrypt('rotated')

    // Rotate: new primary key, old key as previous
    setup(TEST_KEY_2, [TEST_KEY])
    assert.strictEqual(Crypt.decrypt(encrypted), 'rotated')
  })

  it('new encryptions use the current key', () => {
    setup(TEST_KEY_2, [TEST_KEY])
    const encrypted = Crypt.encrypt('new')

    // Decrypt with only the new key (no previous)
    setup(TEST_KEY_2)
    assert.strictEqual(Crypt.decrypt(encrypted), 'new')
  })

  it('fails when neither current nor previous keys match', () => {
    setup(TEST_KEY)
    const encrypted = Crypt.encrypt('lost')

    const thirdKey = `base64:${randomBytes(32).toString('base64')}`
    setup(thirdKey)
    assert.throws(() => Crypt.decrypt(encrypted), /failed/)
  })
})

// ─── Crypt.generateKey ────────────────────────────────────

describe('Crypt.generateKey', () => {
  it('produces a base64:-prefixed string', () => {
    const key = Crypt.generateKey()
    assert.ok(key.startsWith('base64:'))
  })

  it('decodes to 32 bytes', () => {
    const key = Crypt.generateKey()
    const buf = parseKey(key)
    assert.strictEqual(buf.length, 32)
  })

  it('generates unique keys', () => {
    const a = Crypt.generateKey()
    const b = Crypt.generateKey()
    assert.notStrictEqual(a, b)
  })
})

// ─── parseKey ─────────────────────────────────────────────

describe('parseKey', () => {
  it('parses a base64:-prefixed key', () => {
    const raw = randomBytes(32)
    const buf = parseKey(`base64:${raw.toString('base64')}`)
    assert.ok(buf.equals(raw))
  })

  it('parses a raw UTF-8 key (32 chars)', () => {
    const raw = 'a'.repeat(32)
    const buf = parseKey(raw)
    assert.strictEqual(buf.length, 32)
    assert.strictEqual(buf.toString('utf8'), raw)
  })

  it('trims whitespace', () => {
    const raw = randomBytes(32)
    const buf = parseKey(`  base64:${raw.toString('base64')}  `)
    assert.ok(buf.equals(raw))
  })
})

// ─── CryptRegistry ────────────────────────────────────────

describe('CryptRegistry', () => {
  beforeEach(() => CryptRegistry.reset())

  it('throws when no key is set', () => {
    assert.throws(() => CryptRegistry.getKey(), /No encryption key set/)
  })

  it('returns the key after set()', () => {
    const key = randomBytes(32)
    CryptRegistry.set(key)
    assert.ok(CryptRegistry.getKey().equals(key))
  })

  it('returns previous keys', () => {
    const key = randomBytes(32)
    const prev = [randomBytes(32)]
    CryptRegistry.set(key, prev)
    assert.strictEqual(CryptRegistry.getPreviousKeys().length, 1)
  })

  it('reset() clears everything', () => {
    CryptRegistry.set(randomBytes(32))
    CryptRegistry.reset()
    assert.throws(() => CryptRegistry.getKey())
  })
})

// ─── crypt() provider ─────────────────────────────────────

describe('crypt() provider', () => {
  beforeEach(() => CryptRegistry.reset())

  const fakeApp = { instance: () => undefined } as never

  it('boots and registers the key', async () => {
    const Provider = crypt({ key: TEST_KEY })
    await new Provider(fakeApp).boot?.()
    assert.ok(CryptRegistry.getKey().length === 32)
  })

  it('boots with previous keys', async () => {
    const Provider = crypt({ key: TEST_KEY, previousKeys: [TEST_KEY_2] })
    await new Provider(fakeApp).boot?.()
    assert.strictEqual(CryptRegistry.getPreviousKeys().length, 1)
  })

  it('throws when key is empty', async () => {
    const Provider = crypt({ key: '' })
    await assert.rejects(
      () => new Provider(fakeApp).boot?.() as Promise<void>,
      /APP_KEY is not set/,
    )
  })

  it('throws when key is wrong length', async () => {
    const Provider = crypt({ key: 'too-short' })
    await assert.rejects(
      () => new Provider(fakeApp).boot?.() as Promise<void>,
      /must be 32 bytes/,
    )
  })

  it('register() is a no-op', () => {
    const Provider = crypt({ key: TEST_KEY })
    assert.doesNotThrow(() => new Provider(fakeApp).register?.())
  })
})
