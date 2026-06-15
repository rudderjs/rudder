import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Url } from '@rudderjs/router'
import type { AppRequest } from '@rudderjs/contracts'
import {
  Gate,
  Policy,
  EloquentUserProvider,
  toAuthenticatable,
  PasswordBroker,
  MemoryTokenRepository,
  verifyEmailFromRequest,
  type Authenticatable,
  type UserProvider,
} from './index.js'

// ─── Gate: policy ability cannot resolve to an Object.prototype member ────────
//
// A naive `policy[ability]` lookup is fail-open: every object inherits callable
// members from Object.prototype (toString/valueOf/hasOwnProperty/…), all of
// which return a truthy value. So `allows('toString', policiedModel)` would call
// Object.prototype.toString and treat its result as "allowed". The fix resolves
// the method only from the policy's own prototype chain (excluding Object's).

class Doc {
  constructor(public ownerId: string) {}
}

class DocPolicy extends Policy {
  update(user: Authenticatable, doc: Doc) {
    return (user as unknown as Record<string, unknown>)['id'] === doc.ownerId
  }
}

function authUser(overrides?: Record<string, unknown>): Authenticatable {
  return toAuthenticatable({ id: '1', name: 'John', email: 'john@example.com', password: 'h', rememberToken: null, ...overrides })
}

describe('Gate — policy method resolution is fail-closed against Object.prototype', () => {
  beforeEach(() => Gate.reset())

  for (const inherited of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'constructor', '__proto__']) {
    it(`denies the inherited member "${inherited}" instead of fail-opening to allow`, async () => {
      Gate.policy(Doc, DocPolicy)
      const user = authUser({ id: '1' })
      const doc  = new Doc('1')
      // The user even OWNS the doc, but the ability name is not a real policy
      // method — it must still deny (the method must come from DocPolicy, never
      // from Object.prototype).
      assert.strictEqual(await Gate.forUser(user).allows(inherited, doc), false)
    })
  }

  it('still routes a genuine policy method (regression guard for the fix)', async () => {
    Gate.policy(Doc, DocPolicy)
    assert.strictEqual(await Gate.forUser(authUser({ id: '1' })).allows('update', new Doc('1')), true)
    assert.strictEqual(await Gate.forUser(authUser({ id: '2' })).allows('update', new Doc('1')), false)
  })

  it('GateForUser denies a null principal instead of running a policy with user=null', async () => {
    Gate.policy(Doc, DocPolicy)
    // forUser's type forbids null, but a runtime null must not reach a policy.
    assert.strictEqual(await Gate.forUser(null as unknown as Authenticatable).allows('update', new Doc('1')), false)
  })
})

// ─── EloquentUserProvider: empty stored hash never authenticates ──────────────

function fakeModel(users: Record<string, unknown>[]) {
  return {
    find: async (id: string | number) => users.find(u => u['id'] === String(id)) ?? null,
    query: () => {
      const filters: Record<string, unknown> = {}
      const builder = {
        where(col: string, val: unknown) { filters[col] = val; return builder },
        async first() {
          return users.find(u => Object.entries(filters).every(([k, v]) => u[k] === v)) ?? null
        },
      }
      return builder
    },
  }
}

describe('EloquentUserProvider — empty stored password hash is rejected', () => {
  it('returns false for a row with an empty password even when the hasher would say true', async () => {
    const checked: Array<[string, string]> = []
    const spyCheck = async (plain: string, hashed: string) => { checked.push([plain, hashed]); return true }
    const provider = new EloquentUserProvider(fakeModel([]), spyCheck)

    // OAuth-only / not-yet-set account: password column is empty.
    const passwordless = toAuthenticatable({ id: '9', email: 'oauth@x.com', password: '' })
    const result = await provider.validateCredentials(passwordless, { password: 'anything' })

    assert.strictEqual(result, false, 'a passwordless row must never authenticate by password')
    // Timing flat: a dummy verify still ran (against a well-formed, non-empty
    // hash) so "no password" is indistinguishable from "wrong password".
    assert.equal(checked.length, 1, 'a dummy verify must still run to keep timing flat')
    assert.ok(checked[0]![1].length > 0, 'the dummy verify must use a non-empty hash, not the empty stored one')
  })

  it('still authenticates a row with a real hash (regression guard)', async () => {
    const provider = new EloquentUserProvider(fakeModel([]), async () => true)
    const user = toAuthenticatable({ id: '1', email: 'john@x.com', password: '$2b$04$real' })
    assert.strictEqual(await provider.validateCredentials(user, { password: 'secret' }), true)
  })
})

// ─── PasswordBroker: a successful reset cycles the remember token ─────────────

describe('PasswordBroker — reset invalidates outstanding remember cookies', () => {
  it('cycles the remember token on a successful reset (Laravel parity)', async () => {
    const user = toAuthenticatable({ id: '1', email: 'john@x.com', password: 'h', rememberToken: 'stolen-cookie-token' })
    const rememberWrites: Array<[string, string | null]> = []
    const users: UserProvider = {
      async retrieveById()        { return user },
      async retrieveByCredentials(c) { return c['email'] === 'john@x.com' ? user : null },
      async validateCredentials() { return true },
      async updateRememberToken(id, token) { rememberWrites.push([id, token]) },
    }

    const tokens = new MemoryTokenRepository()
    const broker = new PasswordBroker(tokens, users, { secret: 'test-secret-test-secret-test-secret' })

    let plainToken = ''
    await broker.sendResetLink({ email: 'john@x.com' }, async (_u, t) => { plainToken = t })

    const status = await broker.reset(
      { email: 'john@x.com', token: plainToken, password: 'new-password' },
      async () => { /* password update is the app's job */ },
    )

    assert.strictEqual(status, 'PASSWORD_RESET')
    assert.equal(rememberWrites.length, 1, 'reset must cycle the remember token exactly once')
    assert.equal(rememberWrites[0]![0], '1')
    assert.ok(rememberWrites[0]![1] && rememberWrites[0]![1] !== 'stolen-cookie-token',
      'the new token must be a fresh, non-null value that invalidates the captured cookie')
  })

  it('does not fail an otherwise-successful reset when token cycling throws', async () => {
    const user = toAuthenticatable({ id: '1', email: 'john@x.com', password: 'h', rememberToken: null })
    const users: UserProvider = {
      async retrieveById()        { return user },
      async retrieveByCredentials(c) { return c['email'] === 'john@x.com' ? user : null },
      async validateCredentials() { return true },
      async updateRememberToken() { throw new Error('no remember-token column') },
    }
    const tokens = new MemoryTokenRepository()
    const broker = new PasswordBroker(tokens, users, { secret: 'test-secret-test-secret-test-secret' })

    let plainToken = ''
    await broker.sendResetLink({ email: 'john@x.com' }, async (_u, t) => { plainToken = t })

    const status = await broker.reset(
      { email: 'john@x.com', token: plainToken, password: 'new-password' },
      async () => {},
    )
    assert.strictEqual(status, 'PASSWORD_RESET', 'a failed token-cycle write must not break the reset')
  })
})

// ─── verifyEmailFromRequest: enforces the URL signature itself ────────────────

function sha256(s: string) { return createHash('sha256').update(s).digest('hex') }

function verifyUser(email: string) {
  let verified = false
  return {
    id: '1',
    getAuthIdentifier: () => '1',
    hasVerifiedEmail: () => verified,
    markEmailAsVerified: async () => { verified = true },
    getEmailForVerification: () => email,
    get _verified() { return verified },
  }
}

function fakeVerifyReq(url: string, params: Record<string, string>): AppRequest {
  return { url, params } as unknown as AppRequest
}

describe('verifyEmailFromRequest — fails closed without a valid signature', () => {
  beforeEach(() => Url.setKey('test-app-key-test-app-key-test-app-key'))

  const email = 'victim@x.com'
  const hash  = sha256(email)
  const path  = `/email/verify/1/${hash}`

  it('verifies when the signature is valid and the email hash matches', async () => {
    const signed = Url.sign(path)
    const user = verifyUser(email)
    const ok = await verifyEmailFromRequest(fakeVerifyReq(signed, { id: '1', hash }), async () => user)
    assert.strictEqual(ok, true)
    assert.strictEqual(user._verified, true, 'a valid request must mark the user verified')
  })

  it('refuses an UNSIGNED request even when the email hash is correct (the core fix)', async () => {
    // Without enforcing the signature, the unkeyed sha256(email) hash is public,
    // so this would forge a verification for any known email.
    const user = verifyUser(email)
    const ok = await verifyEmailFromRequest(fakeVerifyReq(path, { id: '1', hash }), async () => user)
    assert.strictEqual(ok, false, 'a missing signature must fail closed')
    assert.strictEqual(user._verified, false)
  })

  it('refuses a tampered signature', async () => {
    const signed = Url.sign(path).replace(/signature=([0-9a-f]+)/, (_m, s) => `signature=${s.split('').reverse().join('')}`)
    const user = verifyUser(email)
    const ok = await verifyEmailFromRequest(fakeVerifyReq(signed, { id: '1', hash }), async () => user)
    assert.strictEqual(ok, false)
  })

  it('refuses an expired signature', async () => {
    const expired = Url.sign(path, new Date(Date.now() - 10_000))
    const user = verifyUser(email)
    const ok = await verifyEmailFromRequest(fakeVerifyReq(expired, { id: '1', hash }), async () => user)
    assert.strictEqual(ok, false)
  })

  it('still enforces the email-hash binding under a valid signature (wrong-email hash denied)', async () => {
    // A correctly-signed link whose hash belongs to a DIFFERENT email must not
    // verify the resolved user (hash binding survives the signature gate).
    const attackerHash = sha256('attacker@x.com')
    const signedForWrongHash = Url.sign(`/email/verify/1/${attackerHash}`)
    const user = verifyUser(email) // resolves to victim@x.com
    const ok = await verifyEmailFromRequest(fakeVerifyReq(signedForWrongHash, { id: '1', hash: attackerHash }), async () => user)
    assert.strictEqual(ok, false)
    assert.strictEqual(user._verified, false)
  })
})
