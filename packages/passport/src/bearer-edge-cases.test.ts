// BearerMiddleware token-lookup + revocation + issuer edge cases (#1227).
//
// authenticateBearer() verifies the JWT, then looks the row up by `jti` and
// checks revocation; it also passes `expectedIssuer` to verifyToken when an
// issuer is configured. None of these branches were covered:
//   1. a valid JWT whose DB row is gone (model:prune racing an in-flight
//      request) — the lookup returns null AFTER a good verify.
//   2. a revoked row — same branch as (1), the other half.
//   3. a legacy token minted before useIssuer() (no `iss`) must still pass
//      once an issuer is configured (migration window).
//   4. a token from a different issuer must be rejected — the multi-tenant
//      security boundary; a verifyToken regression here would silently let
//      other tenants' tokens authenticate.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { Passport, RequireBearer, createToken } from './index.js'

function fakeReq(authHeader?: string) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    raw: {} as Record<string, unknown>,
  }
}

function fakeRes() {
  let status = 200
  let body: unknown = null
  return {
    status(s: number) { status = s; return this },
    json(b: unknown) { body = b; return this },
    get statusValue() { return status },
    get bodyValue() { return body },
  }
}

// A token model whose lookup chain (`query().where(...).first()`) resolves to
// `row` — pass `null` to simulate a deleted/pruned row.
function fakeTokenModel(row: unknown) {
  return class FakeAccessToken {
    static query() {
      return {
        where() { return this },
        first: async () => row as never,
      }
    }
  }
}

async function setupKeys(): Promise<void> {
  Passport.reset()
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  Passport.setKeys(privateKey, publicKey)
}

function mintToken() {
  return createToken({
    tokenId: 'AT-1', userId: 'U-1', clientId: 'C-1',
    scopes: ['read'],
    expiresAt: new Date(Date.now() + 60_000),
  })
}

const validRow = { id: 'AT-1', revoked: false, scopes: '["read"]', userId: 'U-1' }

describe('BearerMiddleware — token lookup, revocation, and issuer edge cases (#1227)', () => {
  test('valid JWT whose DB row was deleted (prune race) → 401 revoked', async () => {
    await setupKeys()
    const jwt = await mintToken()
    Passport.useTokenModel(fakeTokenModel(null) as never) // row gone after verify

    const req = fakeReq(`Bearer ${jwt}`)
    const res = fakeRes()
    let next = 0
    await RequireBearer()(req as never, res as never, async () => { next++ })

    assert.equal(res.statusValue, 401)
    assert.deepEqual(res.bodyValue, { error: 'unauthenticated', message: 'Token has been revoked.' })
    assert.equal(next, 0, 'a missing row must not authenticate')
    Passport.reset()
  })

  test('valid JWT whose row is marked revoked → 401 revoked', async () => {
    await setupKeys()
    const jwt = await mintToken()
    Passport.useTokenModel(fakeTokenModel({ ...validRow, revoked: true }) as never)

    const req = fakeReq(`Bearer ${jwt}`)
    const res = fakeRes()
    let next = 0
    await RequireBearer()(req as never, res as never, async () => { next++ })

    assert.equal(res.statusValue, 401)
    assert.deepEqual(res.bodyValue, { error: 'unauthenticated', message: 'Token has been revoked.' })
    assert.equal(next, 0)
    Passport.reset()
  })

  test('legacy token with no `iss` still passes once an issuer is configured', async () => {
    await setupKeys()
    const jwt = await mintToken()                       // minted with no issuer → no `iss` claim
    Passport.useIssuer('https://app.example.com')       // operator configures it afterwards
    Passport.useTokenModel(fakeTokenModel(validRow) as never)

    const req = fakeReq(`Bearer ${jwt}`)
    const res = fakeRes()
    let next = 0
    await RequireBearer()(req as never, res as never, async () => { next++ })

    assert.equal(next, 1, 'a pre-issuer token must remain valid during the migration window')
    assert.equal(res.statusValue, 200)
    Passport.reset()
  })

  test('token from a different issuer is rejected → 401 invalid', async () => {
    await setupKeys()
    Passport.useIssuer('https://other.example.com')     // minted by another issuer
    const jwt = await mintToken()
    Passport.useIssuer('https://app.example.com')        // this resource server expects a different one
    // A perfectly valid, unrevoked row — proves the 401 is purely the issuer check.
    Passport.useTokenModel(fakeTokenModel(validRow) as never)

    const req = fakeReq(`Bearer ${jwt}`)
    const res = fakeRes()
    let next = 0
    await RequireBearer()(req as never, res as never, async () => { next++ })

    assert.equal(res.statusValue, 401)
    assert.deepEqual(res.bodyValue, { error: 'unauthenticated', message: 'Invalid or expired token.' })
    assert.equal(next, 0, 'a cross-issuer token must never authenticate')
    Passport.reset()
  })
})
