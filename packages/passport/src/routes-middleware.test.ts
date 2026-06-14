// Endpoint hardening, route options (device/token middleware), CLI grant
// flag mapping, the L7/L8/P12/E12 cleanup bundle, and globalThis config.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  decodeToken,
  OAuthClient,
  AccessToken,
  RefreshToken,
  AuthCode,
  DeviceCode,
  RequireBearer,
  resolveClientGrantTypes,
  exchangeAuthCode,
  OAuthError,
  registerPassportRoutes,
  registerPassportApiRoutes,
} from './index.js'

describe('endpoint hardening — E5 / E10 / E11', () => {
  // Regression guards for E5, E10, E11 from the passport-surface review:
  // - E5  RFC 6750 §2.1 — Bearer scheme is case-insensitive.
  // - E10 RFC 6749 §5.2 — token-endpoint client-auth failures return 401
  //       and a `WWW-Authenticate` header. The auth-code grant was
  //       defaulting to 400; refresh-token / client-credentials were
  //       already correct.
  // - E11 RFC 8628 §3.5 — device-flow polling errors (incl. slow_down)
  //       are §5.2 errors and MUST return 400, not 429.

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

  test('E5 — Bearer prefix match is case-insensitive', async () => {
    Passport.reset()
    // No keys set — verifyToken will throw, but the prefix check happens
    // first. RequireBearer rejects pre-prefix-check with "Bearer token
    // required" (the JSON message we assert against). All three casings
    // must get past that early reject and into the verify path, which
    // throws and yields the "Invalid or expired token" message.
    const cases = ['Bearer faux.jwt.x', 'bearer faux.jwt.x', 'BEARER faux.jwt.x']
    for (const header of cases) {
      const req = fakeReq(header)
      const res = fakeRes()
      let nextCalled = 0
      await RequireBearer()(req as any, res as any, async () => { nextCalled++ })
      // verifyToken throws → caught → 401 + "Invalid or expired token".
      assert.equal(res.statusValue, 401, `${header}: status`)
      assert.deepEqual(res.bodyValue, { error: 'unauthenticated', message: 'Invalid or expired token.' }, `${header}: body`)
      assert.equal(nextCalled, 0, `${header}: next not called`)
    }

    // Sanity: a missing/wrong scheme still hits the early "required" path.
    const req = fakeReq('Basic abc')
    const res = fakeRes()
    await RequireBearer()(req as any, res as any, async () => {})
    assert.equal(res.statusValue, 401)
    assert.deepEqual(res.bodyValue, { error: 'unauthenticated', message: 'Bearer token required.' })

    Passport.reset()
  })

  test('E10 — exchangeAuthCode raises invalid_client at HTTP 401, not 400', async () => {
    Passport.reset()
    // No client found → invalid_client. Pre-fix this defaulted to 400 in
    // the auth-code grant only; refresh-token / client-credentials grants
    // were already 401. Aligning fixes the inconsistency.
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => null }
      }
    }
    Passport.useClientModel(FakeClient as any)

    await assert.rejects(
      () => exchangeAuthCode({
        grantType:   'authorization_code',
        code:        'AC-1',
        clientId:    'C-MISSING',
        redirectUri: 'https://app.example.com/cb',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client' && e.statusCode === 401,
    )

    Passport.reset()
  })

  test('E10 — confidential client missing/invalid secret raises 401, not 400', async () => {
    Passport.reset()
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id: 'C-1', name: 'app', secret: 'badf00d',
            redirectUris: '["https://app.example.com/cb"]',
            grantTypes: '["authorization_code"]', scopes: '[]',
            confidential: true, revoked: false,
          }) as any,
        }
      }
    }
    Passport.useClientModel(FakeClient as any)

    // Missing secret on a confidential client.
    await assert.rejects(
      () => exchangeAuthCode({
        grantType:   'authorization_code',
        code:        'AC-1',
        clientId:    'C-1',
        redirectUri: 'https://app.example.com/cb',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client' && e.statusCode === 401 && /required/.test(e.errorDescription),
    )

    // Wrong secret.
    await assert.rejects(
      () => exchangeAuthCode({
        grantType:    'authorization_code',
        code:         'AC-1',
        clientId:     'C-1',
        clientSecret: 'wrong',
        redirectUri:  'https://app.example.com/cb',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client' && e.statusCode === 401 && /Invalid client secret/.test(e.errorDescription),
    )

    Passport.reset()
  })

  test('E11 — device-flow slow_down returns HTTP 400 (was 429)', async () => {
    // Mount the routes with a fake router and probe the token handler.
    // We bypass the grant by sending grant_type=device_code and stubbing
    // pollDeviceCode via a faked DeviceCode model that yields a status
    // we control through the device-code helper paths.
    Passport.reset()

    // Capture handlers as they're registered.
    const handlers: Record<string, (req: any, res: any) => Promise<unknown>> = {}
    const fakeRouter = {
      get:    () => {},
      post:   (path: string, handler: (req: any, res: any) => Promise<unknown>) => {
        if (path.endsWith('/token')) handlers['token'] = handler
      },
      delete: () => {},
    }

    registerPassportRoutes(fakeRouter as any)
    assert.ok(handlers['token'], 'token handler must be registered')

    // Stub Passport.deviceCodeModel so pollDeviceCode finds a row that
    // forces a slow_down response (lastPolledAt very recent → throttled).
    // The stored row carries `*Hash` columns + an `interval` (M4 + P9).
    class FakeDeviceCode {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id:             'DC-1',
            clientId:       'C-1',
            userCodeHash:   'ucode-hash',
            deviceCodeHash: 'dcode-hash',
            scopes:         '[]',
            userId:         null,
            approved:       null,
            interval:       5,
            expiresAt:      new Date(Date.now() + 60_000),
            lastPolledAt:   new Date(), // now → forces slow_down
            createdAt:      new Date(),
          }) as any,
        }
      }
      static async update(_id: string, _data: Record<string, unknown>) {}
    }
    Passport.useDeviceCodeModel(FakeDeviceCode as any)

    const req = {
      raw: {} as Record<string, unknown>,
      body: {
        grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'DC-1',
        client_id:   'C-1',
      },
    }
    let status = 0
    let body: any = null
    const res = {
      status(s: number) { status = s; return this },
      json(b: unknown) { body = b; return this },
      header() { return this },
    }

    await handlers['token']!(req, res)

    assert.equal(status, 400, 'slow_down must return HTTP 400, not 429')
    assert.equal(body.error, 'slow_down')

    Passport.reset()
  })

  test('E10 — token endpoint sets WWW-Authenticate when surfacing a 401 OAuthError', async () => {
    // Drive the token handler with an unknown client so exchangeAuthCode
    // throws OAuthError(invalid_client, 401). Confirm the handler appends
    // a WWW-Authenticate: Basic header before sending the response.
    Passport.reset()

    const handlers: Record<string, (req: any, res: any) => Promise<unknown>> = {}
    const fakeRouter = {
      get:    () => {},
      post:   (path: string, handler: (req: any, res: any) => Promise<unknown>) => {
        if (path.endsWith('/token')) handlers['token'] = handler
      },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter as any)

    class NoClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => null }
      }
    }
    Passport.useClientModel(NoClient as any)

    const headers: Record<string, string> = {}
    let status = 0
    let body: any = null
    const res = {
      status(s: number) { status = s; return this },
      json(b: unknown) { body = b; return this },
      header(k: string, v: string) { headers[k] = v; return this },
    }
    const req = {
      raw: {} as Record<string, unknown>,
      body: {
        grant_type:    'authorization_code',
        code:          'AC-1',
        client_id:     'C-MISSING',
        redirect_uri:  'https://app.example.com/cb',
      },
    }

    await handlers['token']!(req, res)

    assert.equal(status, 401, 'invalid_client must propagate to HTTP 401')
    assert.equal(body.error, 'invalid_client')
    assert.equal(headers['WWW-Authenticate'], 'Basic realm="oauth"', 'WWW-Authenticate header must be set on 401')

    Passport.reset()
  })
})

describe('resolveClientGrantTypes — passport:client CLI flag mapping (L2)', () => {
  // Regression guard for L2 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // The previous mapping shipped --device clients with ONLY `device_code` in
  // their grants array — once a device exchanged its user_code for tokens,
  // the bundled refresh token couldn't actually be used at /oauth/token
  // because the token endpoint checks the client's grantTypes for
  // `refresh_token`. The pure helper makes the new mapping
  // unit-testable without booting the full provider.

  test('default (no flags) → authorization_code + refresh_token', () => {
    assert.deepEqual(resolveClientGrantTypes({}), ['authorization_code', 'refresh_token'])
  })

  test('--device → device_code + refresh_token (regression guard for L2)', () => {
    assert.deepEqual(
      resolveClientGrantTypes({ isDevice: true }),
      ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
    )
  })

  test('--client-credentials → client_credentials only', () => {
    assert.deepEqual(resolveClientGrantTypes({ isM2M: true }), ['client_credentials'])
  })

  test('--device wins over --client-credentials when both are passed', () => {
    // Mirrors the if-else order in the CLI handler — device_code is the
    // narrower / more specific intent and takes precedence.
    assert.deepEqual(
      resolveClientGrantTypes({ isDevice: true, isM2M: true }),
      ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
    )
  })
})

describe('PassportRouteOptions.deviceMiddleware (P8)', () => {
  // Regression guard for P8 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // Mirrors E8's tokenMiddleware shape but applies to /oauth/device/code +
  // /oauth/device/approve. The api-group rate limit covers the brute-force
  // surface in most cases; deviceMiddleware is the per-route fallback for
  // tighter device-specific limits.

  test('omitted deviceMiddleware → device endpoints receive no extra middleware', () => {
    Passport.reset()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, _h: any, mw?: any) => { captured[p] = mw ?? [] },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)
    assert.deepEqual(captured['/oauth/device/code'], [])
    assert.deepEqual(captured['/oauth/device/approve'], [])
  })

  test('deviceMiddleware as a single handler is wrapped in an array', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, _h: any, mw?: any) => { captured[p] = mw ?? [] },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter, { deviceMiddleware: sentinel })
    assert.deepEqual(captured['/oauth/device/code'], [sentinel])
    assert.deepEqual(captured['/oauth/device/approve'], [sentinel])
  })

  test('deviceMiddleware as an array preserves order on both device endpoints', () => {
    Passport.reset()
    const a = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const b = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, _h: any, mw?: any) => { captured[p] = mw ?? [] },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter, { deviceMiddleware: [a, b] })
    assert.deepEqual(captured['/oauth/device/code'], [a, b])
    assert.deepEqual(captured['/oauth/device/approve'], [a, b])
  })

  test('deviceMiddleware does NOT leak onto token / authorize / scopes / revoke endpoints', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    (p: string, _h: any, mw?: any) => { captured[`GET ${p}`] = mw ?? [] },
      post:   (p: string, _h: any, mw?: any) => { captured[`POST ${p}`] = mw ?? [] },
      delete: (p: string, _h: any, mw?: any) => { captured[`DELETE ${p}`] = mw ?? [] },
    }
    registerPassportRoutes(fakeRouter, { deviceMiddleware: [sentinel] })
    assert.deepEqual(captured['POST /oauth/device/code'], [sentinel])
    assert.deepEqual(captured['POST /oauth/device/approve'], [sentinel])
    assert.equal(captured['POST /oauth/token']?.includes(sentinel), false,
      'deviceMiddleware must not bleed onto the token endpoint')
    assert.deepEqual(captured['POST /oauth/authorize'], [],
      'deviceMiddleware must not bleed onto authorize')
    assert.deepEqual(captured['GET /oauth/scopes'], [],
      'deviceMiddleware must not bleed onto scopes')
    assert.equal(captured['DELETE /oauth/tokens/:id']?.includes(sentinel), false,
      'deviceMiddleware must not bleed onto revoke')
  })

  test('registerPassportApiRoutes forwards deviceMiddleware to the underlying mount', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    (p: string, _h: any, mw?: any) => { captured[`GET ${p}`] = mw ?? [] },
      post:   (p: string, _h: any, mw?: any) => { captured[`POST ${p}`] = mw ?? [] },
      delete: () => {},
    }
    registerPassportApiRoutes(fakeRouter, { deviceMiddleware: [sentinel] })
    assert.deepEqual(captured['POST /oauth/device/code'], [sentinel])
    assert.deepEqual(captured['POST /oauth/device/approve'], [sentinel])
  })
})

describe('PassportRouteOptions.tokenMiddleware (E8)', () => {
  // Regression guard for E8 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // The token endpoint is the brute-force target for client_secret guessing
  // — apps need to be able to mount a per-route rate limiter on it. The
  // option accepts either a single handler or an array; both shapes route
  // through `asMiddlewareArray` and end up positionally after the handler
  // on `router.post(path, handler, ...middleware)`.

  test('omitted tokenMiddleware → router receives no extra middleware', () => {
    Passport.reset()
    const captured: { middleware: any[] } = { middleware: [] }
    const fakeRouter = {
      get: () => {},
      post: (p: string, _h: any, mw?: any) => {
        if (p.endsWith('/token')) captured.middleware = mw ?? []
      },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)
    assert.deepEqual(captured.middleware, [])
  })

  test('tokenMiddleware as a single handler is wrapped in an array', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: { middleware: any[] } = { middleware: [] }
    const fakeRouter = {
      get: () => {},
      post: (p: string, _h: any, mw?: any) => {
        if (p.endsWith('/token')) captured.middleware = mw ?? []
      },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter, { tokenMiddleware: sentinel })
    assert.equal(captured.middleware.length, 1)
    assert.equal(captured.middleware[0], sentinel)
  })

  test('tokenMiddleware as an array preserves order on the token endpoint', () => {
    Passport.reset()
    const a = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const b = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: { middleware: any[] } = { middleware: [] }
    const fakeRouter = {
      get: () => {},
      post: (p: string, _h: any, mw?: any) => {
        if (p.endsWith('/token')) captured.middleware = mw ?? []
      },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter, { tokenMiddleware: [a, b] })
    assert.deepEqual(captured.middleware, [a, b])
  })

  test('tokenMiddleware does NOT leak onto other endpoints', () => {
    // Belt-and-braces guard against a future refactor that accidentally
    // applies the rate limiter globally — the option is named for the
    // token endpoint specifically, and other endpoints should not inherit.
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const captured: Record<string, any[]> = {}
    const fakeRouter = {
      get:    (p: string, _h: any, mw?: any) => { captured[`GET ${p}`] = mw ?? [] },
      post:   (p: string, _h: any, mw?: any) => { captured[`POST ${p}`] = mw ?? [] },
      delete: (p: string, _h: any, mw?: any) => { captured[`DELETE ${p}`] = mw ?? [] },
    }
    registerPassportRoutes(fakeRouter, { tokenMiddleware: [sentinel] })
    assert.deepEqual(captured['POST /oauth/token'], [sentinel])
    assert.deepEqual(captured['POST /oauth/authorize'], [], 'tokenMiddleware must not bleed onto authorize')
    assert.deepEqual(captured['POST /oauth/device/code'], [], 'tokenMiddleware must not bleed onto device/code')
    assert.deepEqual(captured['POST /oauth/device/approve'], [], 'tokenMiddleware must not bleed onto device/approve')
    // DELETE /oauth/tokens/:id legitimately receives [RequireBearer()] —
    // not the sentinel.
    assert.equal(captured['DELETE /oauth/tokens/:id']?.includes(sentinel), false,
      'tokenMiddleware must not bleed onto tokens/:id')
  })
})

describe('mechanical cleanup bundle — L7 / L8 / P12 / E12', () => {
  // Regression guards for the four findings closed in this PR. Tests are
  // colocated rather than split per finding so the describe block matches
  // the changeset entry — each `test()` notes which finding it covers.

  function fakeClientModel(record: Record<string, unknown> | null) {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => record as any }
      }
    }
    return FakeClient as any
  }

  // ── L7: declare id on token models ────────────────────────

  test('L7 — token models declare `id` so callers don\'t need (x as any).id casts', () => {
    // Concrete-class type assertion: if any model removes its `declare id`
    // the structural assignment fails at typecheck time. Doubles as a smoke
    // test that property access works at runtime against a hydrated row.
    const c = OAuthClient.hydrate({ id: 'C-1', name: 'x', confidential: false, redirectUris: '[]', grantTypes: '[]', scopes: '[]', revoked: false } as any) as OAuthClient
    const a = AccessToken.hydrate({ id: 'A-1', userId: 'U-1', clientId: 'C-1', revoked: false, expiresAt: new Date() } as any) as AccessToken
    const r = RefreshToken.hydrate({ id: 'R-1', accessTokenId: 'A-1', revoked: false, expiresAt: new Date(), familyId: null } as any) as RefreshToken
    const x = AuthCode.hydrate({ id: 'AC-1', userId: 'U-1', clientId: 'C-1', revoked: false, expiresAt: new Date(), redirectUri: null, codeChallenge: null, codeChallengeMethod: null } as any) as AuthCode
    const d = DeviceCode.hydrate({ id: 'D-1', clientId: 'C-1', userCodeHash: 'X', deviceCodeHash: 'Y', userId: null, approved: null, interval: 5, expiresAt: new Date(), lastPolledAt: null } as any) as DeviceCode
    assert.equal(c.id, 'C-1')
    assert.equal(a.id, 'A-1')
    assert.equal(r.id, 'R-1')
    assert.equal(x.id, 'AC-1')
    assert.equal(d.id, 'D-1')
  })

  // ── L8: device-flow verification URI prefers config('app.url') ─

  test('L8 — /oauth/device/code uses config(\'app.url\') when set, not req.hostname', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-DEVICE', name: 'd', secret: null, confidential: false,
      redirectUris: '[]',
      grantTypes: '["urn:ietf:params:oauth:grant-type:device_code"]',
      scopes: '[]', revoked: false,
    }))

    let captured: { user_code?: string; verification_uri?: string; verification_uri_complete?: string } | undefined
    class FakeDeviceCode {
      static async create() {}
    }
    Passport.useDeviceCodeModel(FakeDeviceCode as any)

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/device/code')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)
    assert.ok(postHandler, 'POST /oauth/device/code must be registered')

    // Install a minimal config repo on globalThis with app.url set; the
    // handler should prefer it over the attacker-controlled Host header.
    // We construct a duck-typed `{ get(key, fallback) }` shape directly
    // rather than depending on @rudderjs/support — that's transitive only.
    const previous = (globalThis as Record<string, unknown>)['__rudderjs_config__']
    ;(globalThis as Record<string, unknown>)['__rudderjs_config__'] = {
      get(key: string, fallback?: unknown) {
        return key === 'app.url' ? 'https://canonical.example.com' : fallback
      },
    }
    try {
      const res = { json: (p: any) => { captured = p } }
      const req = {
        protocol: 'http',
        hostname: 'attacker.example.com',  // would-be spoofed Host header
        body: { client_id: 'C-DEVICE' },
      }
      await postHandler!(req, res)
    } finally {
      ;(globalThis as Record<string, unknown>)['__rudderjs_config__'] = previous
    }

    assert.ok(captured, 'handler must respond')
    assert.equal(captured!.verification_uri, 'https://canonical.example.com/oauth/device')
    assert.match(captured!.verification_uri_complete ?? '', /^https:\/\/canonical\.example\.com\/oauth\/device\?user_code=/)
    Passport.reset()
  })

  test('L8 — explicit opts.verificationUri wins over config(\'app.url\')', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-DEVICE', name: 'd', secret: null, confidential: false,
      redirectUris: '[]',
      grantTypes: '["urn:ietf:params:oauth:grant-type:device_code"]',
      scopes: '[]', revoked: false,
    }))
    class FakeDeviceCode { static async create() {} }
    Passport.useDeviceCodeModel(FakeDeviceCode as any)

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/device/code')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter, { verificationUri: 'https://override.example.com/d' })

    const previous = (globalThis as Record<string, unknown>)['__rudderjs_config__']
    ;(globalThis as Record<string, unknown>)['__rudderjs_config__'] = {
      get(key: string, fallback?: unknown) {
        return key === 'app.url' ? 'https://canonical.example.com' : fallback
      },
    }
    try {
      let captured: any
      const res = { json: (p: any) => { captured = p } }
      await postHandler!({ protocol: 'http', hostname: 'attacker.example.com', body: { client_id: 'C-DEVICE' } }, res)
      assert.equal(captured.verification_uri, 'https://override.example.com/d')
    } finally {
      ;(globalThis as Record<string, unknown>)['__rudderjs_config__'] = previous
    }
    Passport.reset()
  })

  // ── P12: single Date.now() snapshot for iat / exp / expires_in ─

  test('P12 — issued JWT satisfies `iat + expires_in === exp` exactly', async () => {
    Passport.reset()

    // Real RSA keys so createToken produces a verifiable JWT.
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    Passport.setKeys(privateKey, publicKey)

    class FakeAccessToken {
      static async create(data: Record<string, unknown>) { return { id: 'AT-1', ...data } }
    }
    class FakeRefreshToken {
      static async create(data: Record<string, unknown>) { return { id: 'RT-1', ...data } }
    }
    Passport.useTokenModel(FakeAccessToken as any)
    Passport.useRefreshTokenModel(FakeRefreshToken as any)

    const { issueTokens } = await import('./grants/issue-tokens.js')
    const result = await issueTokens({
      userId:   'U-1',
      clientId: 'C-1',
      scopes:   ['read'],
      includeRefresh: false,
    })

    const decoded = decodeToken(result.access_token)
    // Single `now` snapshot at the top of issueTokens means iat + expires_in
    // is a closed-form for exp — no off-by-1-second drift across the
    // intervening async DB writes + key load.
    assert.equal(decoded.iat + result.expires_in, decoded.exp,
      `expected iat (${decoded.iat}) + expires_in (${result.expires_in}) === exp (${decoded.exp})`)
    Passport.reset()
  })

  // ── E12: state echo + report() on auth-endpoint errors ─

  test('E12 — POST /oauth/authorize echoes `state` on OAuth error responses', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/authorize')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)

    let payload: any
    const res = { status() { return this }, json(p: any) { payload = p } }
    await postHandler!({
      raw: { __rjs_user: { id: 'U-1' } },
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://attacker.example.com/cb',  // not whitelisted → invalid_request
        scopes:       ['read'],
        state:        'opaque-csrf-123',
      },
    }, res)
    assert.equal(payload.error, 'invalid_request')
    assert.equal(payload.state, 'opaque-csrf-123', 'state MUST be echoed on auth-endpoint errors (RFC 6749 §4.1.2.1)')
    Passport.reset()
  })

  test('E12 — POST /oauth/authorize echoes `state` on the unauthenticated branch', async () => {
    Passport.reset()
    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/authorize')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)

    let payload: any; let status = 0
    const res = { status(s: number) { status = s; return this }, json(p: any) { payload = p } }
    await postHandler!({ body: { state: 'csrf-abc' } }, res)
    assert.equal(status, 401)
    assert.equal(payload.error, 'unauthenticated')
    assert.equal(payload.state, 'csrf-abc')
    Passport.reset()
  })

  test('E12 — DELETE /oauth/authorize echoes `state` on error responses', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    let deleteHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   () => {},
      delete: (p: string, h: any) => { if (p.endsWith('/authorize')) deleteHandler = h },
    }
    registerPassportRoutes(fakeRouter)

    let payload: any
    const res = { status() { return this }, json(p: any) { payload = p } }
    await deleteHandler!({
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://attacker.example.com/cb',
        state:        'csrf-zzz',
      },
    }, res)
    assert.equal(payload.error, 'invalid_request')
    assert.equal(payload.state, 'csrf-zzz')
    Passport.reset()
  })

  test('E12 — server_error path calls report() and still echoes state', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    // Force a non-OAuthError throw out of issueAuthCode by failing the
    // AuthCode.create() call.
    class ExplodingAuthCode {
      static async create() { throw new Error('synthetic boom — DB went away') }
      static where() { return { first: async () => null } }
    }
    Passport.useAuthCodeModel(ExplodingAuthCode as any)

    const { setExceptionReporter } = await import('@rudderjs/core')
    const reported: unknown[] = []
    setExceptionReporter((e) => { reported.push(e) })
    try {
      let postHandler: ((req: any, res: any) => any) | undefined
      const fakeRouter = {
        get:    () => {},
        post:   (p: string, h: any) => { if (p.endsWith('/authorize')) postHandler = h },
        delete: () => {},
      }
      registerPassportRoutes(fakeRouter)

      let status = 0; let payload: any
      const res = { status(s: number) { status = s; return this }, json(p: any) { payload = p } }
      await postHandler!({
        raw: { __rjs_user: { id: 'U-1' } },
        body: {
          client_id:    'C-PUBLIC',
          redirect_uri: 'https://app.example.com/callback',
          scopes:       ['read'],
          state:        'state-on-server-error',
          // Public client → satisfy the issuance-time PKCE gate so the flow
          // reaches issueAuthCode (which throws the synthetic server_error).
          code_challenge:        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
          code_challenge_method: 'S256',
        },
      }, res)
      assert.equal(status, 500)
      assert.equal(payload.error, 'server_error')
      assert.equal(payload.state, 'state-on-server-error')
      assert.equal(reported.length, 1, 'non-OAuthError should be passed to report()')
      assert.match((reported[0] as Error).message, /synthetic boom/)
    } finally {
      // Restore default reporter so trailing tests don't capture stray errors.
      setExceptionReporter((e) => { console.error('[RudderJS]', e) })
    }
    Passport.reset()
  })
})

describe('revoke endpoint — refresh-token cascade (RFC 7009)', () => {
  // Builder-backed fake: where(col,[op,]val) chains, first/get/updateAll/query.
  function fakeModel(rows: Record<string, Record<string, unknown>>) {
    function builder(initial: (r: Record<string, unknown>) => boolean): any {
      let pred = initial
      const b: any = {
        where(col: string, opOrVal: unknown, maybeVal?: unknown) {
          const hasOp = arguments.length === 3
          const op = hasOp ? opOrVal as string : '='
          const val = hasOp ? maybeVal : opOrVal
          const prev = pred
          pred = (r) => {
            if (!prev(r)) return false
            const cell = r[col]
            if (op === 'IN') return new Set(val as unknown[]).has(cell)
            return cell === val
          }
          return b
        },
        first: async () => Object.values(rows).find(pred) ?? null,
        get:   async () => Object.values(rows).filter(pred),
        async updateAll(data: Record<string, unknown>) {
          let n = 0
          for (const r of Object.values(rows)) if (pred(r)) { Object.assign(r, data); n++ }
          return n
        },
      }
      return b
    }
    return class {
      static where(col: string, val: unknown) { return builder((r) => r[col] === val) }
      static query() { return builder(() => true) }
    } as any
  }

  test('DELETE /oauth/tokens/:id revokes the paired refresh token AND its family', async () => {
    Passport.reset()
    const accessRows: Record<string, Record<string, unknown>> = {
      'AT-1':   { id: 'AT-1',   userId: 'U-1', clientId: 'C-1', revoked: false },
      'AT-OLD': { id: 'AT-OLD', userId: 'U-1', clientId: 'C-1', revoked: false }, // earlier rotation in same family
    }
    const refreshRows: Record<string, Record<string, unknown>> = {
      'RT-1':   { id: 'RT-1',   accessTokenId: 'AT-1',   familyId: 'FAM-1', revoked: false },
      'RT-OLD': { id: 'RT-OLD', accessTokenId: 'AT-OLD', familyId: 'FAM-1', revoked: false },
    }
    Passport.useTokenModel(fakeModel(accessRows))
    Passport.useRefreshTokenModel(fakeModel(refreshRows))

    let deleteHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get: () => {}, post: () => {},
      delete: (p: string, h: any) => { if (p.endsWith('/tokens/:id')) deleteHandler = h },
    }
    registerPassportRoutes(fakeRouter as any)
    assert.ok(deleteHandler, 'DELETE /oauth/tokens/:id must be registered')

    let status = 0
    const res = { status(s: number) { status = s; return this }, json() { return this }, send() {} }
    // req.raw.__rjs_user simulates RequireBearer having already authenticated U-1.
    await deleteHandler!({ params: { id: 'AT-1' }, raw: { __rjs_user: { id: 'U-1' } } }, res)

    assert.equal(status, 204)
    assert.equal(accessRows['AT-1']!.revoked,   true, 'target access token revoked')
    assert.equal(refreshRows['RT-1']!.revoked,  true, 'paired refresh token revoked (RFC 7009 §2.1)')
    assert.equal(refreshRows['RT-OLD']!.revoked, true, 'family sibling refresh token revoked')
    assert.equal(accessRows['AT-OLD']!.revoked,  true, 'family sibling access token revoked')
    Passport.reset()
  })
})

describe('Passport config on globalThis', () => {
  test('state lives on globalThis so it survives a second copy of @rudderjs/passport', () => {
    // Vite-bundled server apps inline `@rudderjs/passport` (grant handlers
    // and middleware read `Passport.*` config) into entry.mjs, but
    // `PassportProvider.boot()` and any `Passport.tokensCan()` /
    // `Passport.tokensExpireIn()` calls in app code can run from a
    // node_modules copy resolved via the provider auto-discovery manifest.
    // Without a globalThis-routed store, scopes/lifetimes/RSA keys set from
    // the externalized copy would never be visible to grants reading the
    // bundled copy. This test pins the contract: writes from this module
    // copy are visible on a global key the second copy would also read from.
    Passport.reset()
    Passport.tokensCan({ read: 'Read access', write: 'Write access' })
    Passport.tokensExpireIn(123_456)
    Passport.useIssuer('https://app.example.com')

    const store = (globalThis as Record<string, unknown>)['__rudderjs_passport_config__'] as {
      scopes:         Map<string, string>
      tokenLifetime:  number
      issuer:         string | null
    } | undefined
    assert.ok(store, 'global store should exist after Passport.* setters')
    assert.equal(store.scopes.get('read'), 'Read access')
    assert.equal(store.tokenLifetime, 123_456)
    assert.equal(store.issuer, 'https://app.example.com')
    Passport.reset()
  })
})

