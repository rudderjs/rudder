// RFC 7662 — POST /oauth/token/introspect (token introspection, client-authenticated).
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  createToken,
  hashClientSecret,
  hashOpaqueToken,
  registerPassportRoutes,
  registerPassportApiRoutes,
  registerPassportWebRoutes,
} from './index.js'

// Reuse the in-memory model fake shape from the revocation suite.
function fakeModel(rows: Array<Record<string, any>>) {
  function q(filters: Array<[string, unknown]> = []) {
    const match = (r: Record<string, any>) => filters.every(([c, v]) => r[c] === v)
    return {
      where(col: string, val: unknown) { return q([...filters, [col, val]]) },
      async first() { return rows.find(match) ?? null },
      async get() { return rows.filter(match) },
      async updateAll(patch: Record<string, unknown>) {
        let n = 0
        for (const r of rows) if (match(r)) { Object.assign(r, patch); n++ }
        return n
      },
    }
  }
  return class { static where(c: string, v: unknown) { return q().where(c, v) }; static query() { return q() } }
}

function fakeReq(body: Record<string, unknown>, authHeader?: string) {
  return { headers: authHeader ? { authorization: authHeader } : {}, body }
}
function fakeRes() {
  let status = 200
  let body: unknown = null
  const headers: Record<string, string> = {}
  return {
    status(s: number) { status = s; return this },
    json(b: unknown) { body = b; return this },
    header(k: string, v: string) { headers[k] = v; return this },
    get statusValue() { return status },
    get bodyValue() { return body as any },
    get headerValues() { return headers },
  }
}

function introspectHandler(register: (r: any) => void = registerPassportRoutes) {
  let handler: ((req: any, res: any) => Promise<unknown>) | undefined
  const router = {
    get() {}, delete() {},
    post(path: string, h: (req: any, res: any) => Promise<unknown>) {
      if (path.endsWith('/token/introspect')) handler = h
    },
  }
  register(router)
  return handler
}

const SECRET = 'rs-secret'
async function seedClient() {
  return fakeModel([{ id: 'RS-1', confidential: true, revoked: false, secret: await hashClientSecret(SECRET) }])
}
function authed(extra: Record<string, unknown>) { return { client_id: 'RS-1', client_secret: SECRET, ...extra } }

async function withKeys() {
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  Passport.setKeys(privateKey, publicKey)
}

describe('RFC 7662 — POST /oauth/token/introspect', () => {
  beforeEach(() => Passport.reset())
  afterEach(()  => Passport.reset())

  test('returns active:true with claims for a valid access token (scope from the live DB row)', async () => {
    await withKeys()
    const jwt = await createToken({
      tokenId: 'AT-1', userId: 'U-1', clientId: 'CONSUMER',
      scopes: ['read', 'write'], expiresAt: new Date(Date.now() + 60_000),
    })
    // Live row has been narrowed to ['read'] — introspection must reflect that.
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([{ id: 'AT-1', clientId: 'CONSUMER', revoked: false, scopes: '["read"]' }]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: jwt })), res)

    assert.equal(res.statusValue, 200)
    const b = res.bodyValue
    assert.equal(b.active, true)
    assert.equal(b.scope, 'read', 'scope reflects the narrowed DB row, not the JWT claim')
    assert.equal(b.client_id, 'CONSUMER')
    assert.equal(b.token_type, 'Bearer')
    assert.equal(b.sub, 'U-1')
    assert.equal(b.jti, 'AT-1')
    assert.equal(typeof b.exp, 'number')
    assert.equal(typeof b.iat, 'number')
  })

  test('returns active:false for a structurally-valid JWT whose DB row is revoked', async () => {
    await withKeys()
    const jwt = await createToken({
      tokenId: 'AT-2', userId: 'U-1', clientId: 'CONSUMER',
      scopes: ['read'], expiresAt: new Date(Date.now() + 60_000),
    })
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([{ id: 'AT-2', clientId: 'CONSUMER', revoked: true, scopes: '["read"]' }]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: jwt })), res)

    assert.equal(res.statusValue, 200)
    assert.deepEqual(res.bodyValue, { active: false }, 'revocation is authoritative')
  })

  test('returns active:false when the JWT is gone from the DB (e.g. pruned)', async () => {
    await withKeys()
    const jwt = await createToken({
      tokenId: 'AT-MISSING', userId: 'U-1', clientId: 'CONSUMER',
      scopes: ['read'], expiresAt: new Date(Date.now() + 60_000),
    })
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: jwt })), res)
    assert.deepEqual(res.bodyValue, { active: false })
  })

  test('returns active:false for an unverifiable / garbage token (HTTP 200, not an error)', async () => {
    await withKeys()
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: 'not.a.jwt' })), res)
    assert.equal(res.statusValue, 200)
    assert.deepEqual(res.bodyValue, { active: false })
  })

  test('introspects an opaque refresh token as active', async () => {
    await withKeys()
    const value = 'opaque-refresh'
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([{ id: 'AT-R', clientId: 'CONSUMER', revoked: false }]) as any)
    Passport.useRefreshTokenModel(fakeModel([{
      id: 'RT-1', accessTokenId: 'AT-R', tokenHash: await hashOpaqueToken(value),
      revoked: false, expiresAt: new Date(Date.now() + 60_000),
    }]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: value, token_type_hint: 'refresh_token' })), res)
    assert.equal(res.bodyValue.active, true)
    assert.equal(res.bodyValue.token_type, 'refresh_token')
    assert.equal(res.bodyValue.client_id, 'CONSUMER')
  })

  test('a confidential client may introspect a token issued to ANOTHER client (not ownership-scoped)', async () => {
    await withKeys()
    const jwt = await createToken({
      tokenId: 'AT-X', userId: 'U-9', clientId: 'SOME-OTHER-CLIENT',
      scopes: ['read'], expiresAt: new Date(Date.now() + 60_000),
    })
    Passport.useClientModel(await seedClient() as any) // authenticates as RS-1
    Passport.useTokenModel(fakeModel([{ id: 'AT-X', clientId: 'SOME-OTHER-CLIENT', revoked: false, scopes: '["read"]' }]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({ token: jwt })), res)
    assert.equal(res.bodyValue.active, true, 'resource server can validate other clients’ tokens')
    assert.equal(res.bodyValue.client_id, 'SOME-OTHER-CLIENT')
  })

  test('rejects a bad client secret with 401 invalid_client + WWW-Authenticate', async () => {
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq({ client_id: 'RS-1', client_secret: 'nope', token: 'x' }), res)
    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_client')
    assert.match(res.headerValues['WWW-Authenticate'] ?? '', /Basic/)
  })

  test('rejects a missing token parameter with invalid_request', async () => {
    Passport.useClientModel(await seedClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await introspectHandler()!(fakeReq(authed({})), res)
    assert.equal(res.statusValue, 400)
    assert.equal(res.bodyValue.error, 'invalid_request')
  })

  test('is registered on the api group and excluded from the web group', () => {
    assert.ok(introspectHandler(registerPassportApiRoutes), 'api group mounts /oauth/token/introspect')
    assert.equal(introspectHandler(registerPassportWebRoutes), undefined, 'web group does NOT mount it')
  })
})
