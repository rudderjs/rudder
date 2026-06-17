// RFC 7009 — POST /oauth/revoke (token revocation by value, client-authenticated).
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  hashClientSecret,
  hashOpaqueToken,
  registerPassportRoutes,
  registerPassportApiRoutes,
  registerPassportWebRoutes,
} from './index.js'

// ─── In-memory model fakes ────────────────────────────────
//
// A tiny query-builder over a mutable row array supporting the surface the
// revoke path touches: where().first() / where().get() / where().updateAll().
// Rows mutate in place so a test can assert `revoked` flipped.
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
  return class {
    static rows = rows
    static where(col: string, val: unknown) { return q().where(col, val) }
    static query() { return q() }
  }
}

// A JWT whose payload carries `jti` — `unsafeDecodeToken` only needs three
// segments and a JSON-parseable payload, so no signing key is required for the
// revoke path (it never verifies the signature).
function b64url(obj: unknown) { return Buffer.from(JSON.stringify(obj)).toString('base64url') }
function fakeAccessJwt(jti: string) {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ jti, sub: 'U-1', aud: 'C-1', scopes: [], iat: 1, exp: 9_999_999_999 })}.sig`
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
    get bodyValue() { return body },
    get headerValues() { return headers },
  }
}

// Grab the POST /oauth/revoke handler off a registration call.
function revokeHandler(register: (r: any) => void = registerPassportRoutes) {
  let handler: ((req: any, res: any) => Promise<unknown>) | undefined
  const router = {
    get() {}, delete() {},
    post(path: string, h: (req: any, res: any) => Promise<unknown>) {
      if (path.endsWith('/revoke')) handler = h
    },
  }
  register(router)
  return handler
}

const SECRET = 's3cret-value'

async function seedConfidentialClient(overrides: Record<string, any> = {}) {
  return fakeModel([{
    id: 'C-1', confidential: true, revoked: false,
    secret: await hashClientSecret(SECRET), ...overrides,
  }])
}

function authedBody(extra: Record<string, unknown>) {
  return { client_id: 'C-1', client_secret: SECRET, ...extra }
}

describe('RFC 7009 — POST /oauth/revoke', () => {
  beforeEach(() => Passport.reset())
  afterEach(()  => Passport.reset())

  test('revokes an access token (JWT) owned by the authenticated client, cascading to its refresh token', async () => {
    const at = { id: 'AT-1', clientId: 'C-1', revoked: false }
    const rt = { id: 'RT-1', accessTokenId: 'AT-1', familyId: null, revoked: false }
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([at]) as any)
    Passport.useRefreshTokenModel(fakeModel([rt]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({ token: fakeAccessJwt('AT-1') })), res)

    assert.equal(res.statusValue, 200)
    assert.deepEqual(res.bodyValue, {})
    assert.equal(at.revoked, true, 'access token revoked')
    assert.equal(rt.revoked, true, 'paired refresh token cascaded')
  })

  test('revokes a refresh token presented by its opaque value', async () => {
    const at = { id: 'AT-2', clientId: 'C-1', revoked: false }
    const value = 'opaque-refresh-token-value'
    const rt = { id: 'RT-2', accessTokenId: 'AT-2', tokenHash: await hashOpaqueToken(value), familyId: null, revoked: false }
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([at]) as any)
    Passport.useRefreshTokenModel(fakeModel([rt]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({ token: value, token_type_hint: 'refresh_token' })), res)

    assert.equal(res.statusValue, 200)
    assert.equal(rt.revoked, true, 'refresh token revoked')
    assert.equal(at.revoked, true, 'paired access token revoked')
  })

  test('returns 200 for an unknown token without revoking anything (RFC 7009 §2.2)', async () => {
    const at = { id: 'AT-3', clientId: 'C-1', revoked: false }
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([at]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({ token: 'totally-unknown' })), res)

    assert.equal(res.statusValue, 200)
    assert.equal(at.revoked, false, 'unrelated token untouched')
  })

  test('does NOT revoke a token owned by a different client, but still answers 200', async () => {
    const at = { id: 'AT-4', clientId: 'C-OTHER', revoked: false }
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([at]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({ token: fakeAccessJwt('AT-4') })), res)

    assert.equal(res.statusValue, 200, 'no existence oracle — same 200 as a hit')
    assert.equal(at.revoked, false, 'a client cannot revoke another client’s token')
  })

  test('a wrong token_type_hint still resolves the token via fallback', async () => {
    const at = { id: 'AT-5', clientId: 'C-1', revoked: false }
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([at]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    // Hint says refresh_token, but the value is an access-token JWT.
    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({ token: fakeAccessJwt('AT-5'), token_type_hint: 'refresh_token' })), res)

    assert.equal(res.statusValue, 200)
    assert.equal(at.revoked, true, 'access token revoked despite the misleading hint')
  })

  test('rejects a bad client secret with 401 invalid_client + WWW-Authenticate', async () => {
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq({ client_id: 'C-1', client_secret: 'wrong', token: 'x' }), res)

    assert.equal(res.statusValue, 401)
    assert.equal((res.bodyValue as any).error, 'invalid_client')
    assert.match(res.headerValues['WWW-Authenticate'] ?? '', /Basic/)
  })

  test('rejects a public (non-confidential) client with invalid_client', async () => {
    Passport.useClientModel(await seedConfidentialClient({ confidential: false, secret: null }) as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq({ client_id: 'C-1', token: 'x' }), res)

    // The shared confidential-client authority reports the require-confidential
    // failure as 400 (same as the client_credentials grant); a bad secret on a
    // confidential client is the 401 case (covered above).
    assert.equal(res.statusValue, 400)
    assert.equal((res.bodyValue as any).error, 'invalid_client')
  })

  test('rejects a missing token parameter with invalid_request', async () => {
    Passport.useClientModel(await seedConfidentialClient() as any)
    Passport.useTokenModel(fakeModel([]) as any)
    Passport.useRefreshTokenModel(fakeModel([]) as any)

    const res = fakeRes()
    await revokeHandler()!(fakeReq(authedBody({})), res)

    assert.equal(res.statusValue, 400)
    assert.equal((res.bodyValue as any).error, 'invalid_request')
  })

  test('is registered on the api group and excluded from the web group', () => {
    assert.ok(revokeHandler(registerPassportApiRoutes), 'api group mounts /oauth/revoke')
    assert.equal(revokeHandler(registerPassportWebRoutes), undefined, 'web group does NOT mount /oauth/revoke')
  })
})
