// Authorization-code flow: redirect_uri binding + re-validation, atomic
// auth-code consumption, and the authorize/group-split routes.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  issueAuthCode,
  exchangeAuthCode,
  OAuthError,
  registerPassportRoutes,
  registerPassportWebRoutes,
  registerPassportApiRoutes,
} from './index.js'

describe('redirect_uri binding (P1) + re-validation (E3)', () => {
  // Regression guards for P1/E3/E4 from the passport-surface review.
  // - issueAuthCode persists redirect_uri on the AuthCode record.
  // - exchangeAuthCode rejects mismatching redirect_uri at token-exchange time.
  // - POST/DELETE /oauth/authorize re-validate redirect_uri against the
  //   client's whitelist (not just the GET handler).

  function fakeAuthCodeModel(stored: Record<string, unknown>) {
    const created: Record<string, unknown>[] = []
    const updates: Array<{ id: string; data: Record<string, unknown> }> = []
    class FakeAuthCode {
      static created = created
      static updates = updates
      static async create(data: Record<string, unknown>) {
        created.push(data)
        return { ...data, id: 'AC-NEW' }
      }
      static where(_col: string, _val: unknown) {
        return { first: async () => stored as any }
      }
      static async update(id: string, data: Record<string, unknown>) {
        updates.push({ id, data })
      }
    }
    return FakeAuthCode as any
  }

  function fakeClientModel(record: Record<string, unknown> | null) {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => record as any }
      }
    }
    return FakeClient as any
  }

  test('issueAuthCode persists redirect_uri on the AuthCode record', async () => {
    Passport.reset()
    const Fake = fakeAuthCodeModel({})
    Passport.useAuthCodeModel(Fake)

    await issueAuthCode({
      userId:      'U-1',
      clientId:    'C-1',
      scopes:      ['read'],
      redirectUri: 'https://app.example.com/callback',
    })

    assert.equal(Fake.created.length, 1)
    assert.equal(Fake.created[0].redirectUri, 'https://app.example.com/callback')
    Passport.reset()
  })

  test('exchangeAuthCode rejects mismatched redirect_uri with invalid_grant', async () => {
    Passport.reset()
    const stored = {
      id: 'AC-1', userId: 'U-1', clientId: 'C-PUBLIC',
      scopes: '["read"]', revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: 'https://app.example.com/callback',
      codeChallenge: null, codeChallengeMethod: null,
    }
    Passport.useAuthCodeModel(fakeAuthCodeModel(stored))
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback","https://attacker.example.com/cb"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    await assert.rejects(
      () => exchangeAuthCode({
        grantType: 'authorization_code',
        code:      'AC-1',
        clientId:  'C-PUBLIC',
        redirectUri: 'https://attacker.example.com/cb', // whitelisted on the client, but NOT what was bound at issuance
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /redirect_uri does not match/.test(e.errorDescription),
    )

    Passport.reset()
  })

  test('exchangeAuthCode rejects missing redirect_uri when stored value is non-null', async () => {
    Passport.reset()
    Passport.useAuthCodeModel(fakeAuthCodeModel({
      id: 'AC-1', userId: 'U-1', clientId: 'C-PUBLIC',
      scopes: '["read"]', revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: 'https://app.example.com/callback',
      codeChallenge: null, codeChallengeMethod: null,
    }))
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    await assert.rejects(
      () => exchangeAuthCode({
        grantType: 'authorization_code',
        code:      'AC-1',
        clientId:  'C-PUBLIC',
        redirectUri: '',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /redirect_uri is required/.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('exchangeAuthCode allows null stored redirect_uri (legacy compat window)', async () => {
    // Auth codes minted before this column existed must still be exchangeable
    // until they expire (≤10 minutes). When the stored value is null, the
    // redirect_uri branch is skipped; we prove the bypass by advancing to the
    // next check (PKCE — missing code_verifier on a code with codeChallenge set).
    Passport.reset()
    Passport.useAuthCodeModel(fakeAuthCodeModel({
      id: 'AC-LEGACY', userId: 'U-1', clientId: 'C-PUBLIC',
      scopes: '["read"]', revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: null,
      codeChallenge: 'irrelevant-challenge',
      codeChallengeMethod: 'S256',
    }))
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    await assert.rejects(
      () => exchangeAuthCode({
        grantType: 'authorization_code',
        code:      'AC-LEGACY',
        clientId:  'C-PUBLIC',
        redirectUri: 'https://app.example.com/callback',
        // no codeVerifier — next check after redirect_uri will throw
      }),
      (e: any) => e instanceof OAuthError && /code_verifier required/.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('POST /oauth/authorize rejects redirect_uri not on client whitelist', async () => {
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
    assert.ok(postHandler, 'POST /oauth/authorize must be registered')

    let status = 0
    let payload: any
    const res = {
      status(s: number) { status = s; return this },
      json(p: any)      { payload = p },
    }
    const req = {
      raw: { __rjs_user: { id: 'U-1' } },
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://attacker.example.com/cb',
        scopes:       ['read'],
      },
    }
    await postHandler!(req, res)
    assert.equal(status, 400)
    assert.equal(payload.error, 'invalid_request')
    assert.match(payload.error_description, /Invalid redirect_uri/)
    Passport.reset()
  })

  test('POST /oauth/authorize rejects scopes not authorized for the client', async () => {
    // The POST body is attacker-controlled; the GET handler's scope check is
    // only echoed to the consent UI, never enforced. Without re-validating
    // here a client restricted to ['read'] could mint a code for ['write'].
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '["read"]', revoked: false,
    }))

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/authorize')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)
    assert.ok(postHandler, 'POST /oauth/authorize must be registered')

    let status = 0
    let payload: any
    const res = {
      status(s: number) { status = s; return this },
      json(p: any)      { payload = p },
    }
    const req = {
      raw: { __rjs_user: { id: 'U-1' } },
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://app.example.com/callback',
        scopes:       ['read', 'write'],
      },
    }
    await postHandler!(req, res)
    assert.equal(status, 400)
    assert.equal(payload.error, 'invalid_scope')
    assert.match(payload.error_description, /not authorized for this client/)
    Passport.reset()
  })

  test('POST /oauth/authorize issues a code for scopes the client IS authorized for', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientModel({
      id: 'C-PUBLIC', name: 'pub', secret: null, confidential: false,
      redirectUris: '["https://app.example.com/callback"]',
      grantTypes: '["authorization_code"]', scopes: '["read","write"]', revoked: false,
    }))
    Passport.useAuthCodeModel(fakeAuthCodeModel({}))

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/authorize')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)

    let status = 0
    let payload: any
    const res = {
      status(s: number) { status = s; return this },
      json(p: any)      { payload = p },
    }
    const req = {
      raw: { __rjs_user: { id: 'U-1' } },
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://app.example.com/callback',
        scopes:       ['read'],
      },
    }
    await postHandler!(req, res)
    assert.equal(status, 0, 'no error status set')
    assert.match(payload.redirect_uri, /[?&]code=/)
    Passport.reset()
  })

  test('DELETE /oauth/authorize rejects redirect_uri not on client whitelist', async () => {
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
    assert.ok(deleteHandler, 'DELETE /oauth/authorize must be registered')

    let status = 0
    let payload: any
    const res = {
      status(s: number) { status = s; return this },
      json(p: any)      { payload = p },
    }
    const req = {
      body: {
        client_id:    'C-PUBLIC',
        redirect_uri: 'https://attacker.example.com/cb',
      },
    }
    await deleteHandler!(req, res)
    assert.equal(status, 400)
    assert.equal(payload.error, 'invalid_request')
    Passport.reset()
  })

  test('DELETE /oauth/authorize rejects missing redirect_uri (no localhost default)', async () => {
    // Previous behavior defaulted to 'http://localhost' when no redirect_uri
    // was supplied — a footgun. The handler must now require the field.
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

    let status = 0
    const res = { status(s: number) { status = s; return this }, json() {} }
    await deleteHandler!({ body: {} }, res)
    assert.equal(status, 400)
    Passport.reset()
  })
})

describe('atomic auth-code consumption (M3)', () => {
  // Regression guard for M3 — RFC 6749 §4.1.2 requires single-use auth
  // codes. Pre-fix, exchangeAuthCode read the row, ran every check, then
  // unconditionally `update(id, { revoked: true })`. Two concurrent
  // exchanges with the same code each saw `revoked=false`, both passed
  // PKCE / redirect_uri / client checks, and both minted tokens.
  // Post-fix uses `where('id', X).where('revoked', false).updateAll(...)`
  // — the underlying SQL is atomic, so exactly one caller sees `count===1`
  // and the loser sees `count===0` → `invalid_grant`.

  type Call = { method: 'where' | 'updateAll' | 'update'; args: unknown[] }

  function fakeAuthCodeAtomic(stored: Record<string, unknown>, consumeReturns: number) {
    const calls: Call[] = []
    function chain(currentWheres: Array<[string, unknown]>) {
      return {
        where(col: string, val: unknown) {
          calls.push({ method: 'where', args: [col, val] })
          return chain([...currentWheres, [col, val]])
        },
        first: async () => stored as any,
        updateAll: async (data: Record<string, unknown>) => {
          calls.push({ method: 'updateAll', args: [data, currentWheres] })
          return consumeReturns
        },
      }
    }
    class FakeAuthCode {
      static calls = calls
      static where(col: string, val: unknown) {
        calls.push({ method: 'where', args: [col, val] })
        return chain([[col, val]])
      }
      static async update(id: string, data: Record<string, unknown>) {
        // Legacy unconditional path. Post-fix this should never be hit —
        // we assert below that updateAll is the only consume path used.
        calls.push({ method: 'update', args: [id, data] })
      }
    }
    return FakeAuthCode as any
  }

  function fakePublicClient() {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id: 'C-1', name: 'app', secret: null, confidential: false, revoked: false,
            redirectUris: '["https://app.example.com/cb"]',
            grantTypes: '["authorization_code"]', scopes: '[]',
          }) as any,
        }
      }
    }
    return FakeClient as any
  }

  test('race loser — updateAll returns 0 → invalid_grant', async () => {
    Passport.reset()
    const stored = {
      id: 'AC-1', userId: 'U-1', clientId: 'C-1',
      scopes: '["read"]', revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: 'https://app.example.com/cb',
      codeChallenge: null, codeChallengeMethod: null,
    }
    const Fake = fakeAuthCodeAtomic(stored, 0) // race loser
    Passport.useAuthCodeModel(Fake)
    Passport.useClientModel(fakePublicClient())

    await assert.rejects(
      () => exchangeAuthCode({
        grantType:   'authorization_code',
        code:        'AC-1',
        clientId:    'C-1',
        redirectUri: 'https://app.example.com/cb',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /already been used/.test(e.errorDescription),
    )

    Passport.reset()
  })

  test('consume gate uses conditional `where(id).where(revoked, false).updateAll`, not the legacy unconditional update', async () => {
    Passport.reset()
    const stored = {
      id: 'AC-2', userId: 'U-1', clientId: 'C-1',
      scopes: '["read"]', revoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      redirectUri: 'https://app.example.com/cb',
      codeChallenge: null, codeChallengeMethod: null,
    }
    const Fake = fakeAuthCodeAtomic(stored, 0) // count=0 throws before issueTokens
    Passport.useAuthCodeModel(Fake)
    Passport.useClientModel(fakePublicClient())

    await assert.rejects(() => exchangeAuthCode({
      grantType:   'authorization_code',
      code:        'AC-2',
      clientId:    'C-1',
      redirectUri: 'https://app.example.com/cb',
    }))

    const updateAll = Fake.calls.find((c: Call) => c.method === 'updateAll')
    assert.ok(updateAll, 'updateAll was called')
    assert.deepEqual(updateAll!.args[0], { revoked: true }, 'updateAll set revoked=true')

    const wheres = updateAll!.args[1] as Array<[string, unknown]>
    assert.deepEqual(
      wheres.find(([col]) => col === 'id'),
      ['id', 'AC-2'],
      'where(id, AC-2) was applied',
    )
    assert.deepEqual(
      wheres.find(([col]) => col === 'revoked'),
      ['revoked', false],
      'where(revoked, false) was applied — this is the atomicity gate',
    )

    // Legacy unconditional `Model.update(id, data)` must not be the consume path.
    const legacyUpdates = Fake.calls.filter((c: Call) => c.method === 'update')
    assert.equal(legacyUpdates.length, 0, 'legacy unconditional update path bypassed')

    Passport.reset()
  })
})

describe('authorize/group-split routes (E7)', () => {
  // Regression guards for E7 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // Two changes:
  //   1. New `authorizeMiddleware` option mounts on GET/POST/DELETE
  //      /oauth/authorize and DELETE /oauth/tokens/:id. Primary use is
  //      CsrfMiddleware on the consent flow.
  //   2. New `registerPassportWebRoutes` / `registerPassportApiRoutes`
  //      thin wrappers route the consent half + the stateless half onto
  //      separate routers. Each is internally a `registerPassportRoutes`
  //      call with the matching `except`.

  /** Capture every (method, path, middleware) tuple the wrapper emits. */
  function capturingRouter() {
    const captured: Array<{ method: string; path: string; mw: any[] }> = []
    return {
      captured,
      router: {
        get:    (path: string, _h: any, mw?: any) => captured.push({ method: 'GET',    path, mw: mw ?? [] }),
        post:   (path: string, _h: any, mw?: any) => captured.push({ method: 'POST',   path, mw: mw ?? [] }),
        delete: (path: string, _h: any, mw?: any) => captured.push({ method: 'DELETE', path, mw: mw ?? [] }),
      },
    }
  }

  // ── authorizeMiddleware wiring ──────────────────────────

  test('authorizeMiddleware mounts on GET/POST/DELETE /oauth/authorize', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const { captured, router } = capturingRouter()
    registerPassportRoutes(router, { authorizeMiddleware: sentinel })
    const authorizeRoutes = captured.filter(r => r.path === '/oauth/authorize')
    assert.equal(authorizeRoutes.length, 3, 'GET + POST + DELETE on /oauth/authorize')
    for (const route of authorizeRoutes) {
      assert.ok(route.mw.includes(sentinel), `${route.method} /oauth/authorize must carry authorizeMiddleware`)
    }
  })

  test('authorizeMiddleware also mounts on DELETE /oauth/tokens/:id (alongside RequireBearer)', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const { captured, router } = capturingRouter()
    registerPassportRoutes(router, { authorizeMiddleware: [sentinel] })
    const revoke = captured.find(r => r.method === 'DELETE' && r.path === '/oauth/tokens/:id')
    assert.ok(revoke, 'DELETE /oauth/tokens/:id must be registered')
    assert.ok(revoke!.mw.includes(sentinel),
      'authorizeMiddleware must mount on the revoke endpoint too — it shares the consent surface')
    // Existing RequireBearer must still be present and ahead of the
    // sentinel; otherwise an unauthenticated CSRF token would be enough.
    assert.equal(revoke!.mw.length, 2)
  })

  test('omitted authorizeMiddleware → no extra middleware on authorize endpoints', () => {
    Passport.reset()
    const { captured, router } = capturingRouter()
    registerPassportRoutes(router)
    for (const route of captured.filter(r => r.path === '/oauth/authorize')) {
      assert.deepEqual(route.mw, [])
    }
  })

  test('authorizeMiddleware does NOT bleed onto token / device / scopes endpoints', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const { captured, router } = capturingRouter()
    registerPassportRoutes(router, { authorizeMiddleware: [sentinel] })
    const stateless = captured.filter(r =>
      r.path === '/oauth/token' ||
      r.path === '/oauth/device/code' ||
      r.path === '/oauth/device/approve' ||
      r.path === '/oauth/scopes',
    )
    for (const route of stateless) {
      assert.equal(route.mw.includes(sentinel), false,
        `${route.method} ${route.path} must NOT carry authorizeMiddleware`)
    }
  })

  // ── registerPassportWebRoutes / registerPassportApiRoutes ──

  test('registerPassportWebRoutes mounts ONLY consent + revoke endpoints', () => {
    Passport.reset()
    const { captured, router } = capturingRouter()
    registerPassportWebRoutes(router)
    const paths = new Set(captured.map(r => `${r.method} ${r.path}`))
    assert.ok(paths.has('GET /oauth/authorize'))
    assert.ok(paths.has('POST /oauth/authorize'))
    assert.ok(paths.has('DELETE /oauth/authorize'))
    assert.ok(paths.has('DELETE /oauth/tokens/:id'))
    assert.equal(paths.has('POST /oauth/token'), false, 'token endpoint belongs on the api half')
    assert.equal(paths.has('POST /oauth/device/code'), false, 'device endpoints belong on the api half')
    assert.equal(paths.has('POST /oauth/device/approve'), false, 'device endpoints belong on the api half')
    assert.equal(paths.has('GET /oauth/scopes'), false, 'scopes belongs on the api half')
  })

  test('registerPassportApiRoutes mounts ONLY token + device + scopes endpoints', () => {
    Passport.reset()
    const { captured, router } = capturingRouter()
    registerPassportApiRoutes(router)
    const paths = new Set(captured.map(r => `${r.method} ${r.path}`))
    assert.ok(paths.has('POST /oauth/token'))
    assert.ok(paths.has('POST /oauth/device/code'))
    assert.ok(paths.has('POST /oauth/device/approve'))
    assert.ok(paths.has('GET /oauth/scopes'))
    assert.equal(paths.has('GET /oauth/authorize'), false, 'consent flow belongs on the web half')
    assert.equal(paths.has('POST /oauth/authorize'), false, 'consent flow belongs on the web half')
    assert.equal(paths.has('DELETE /oauth/authorize'), false, 'consent flow belongs on the web half')
    assert.equal(paths.has('DELETE /oauth/tokens/:id'), false, 'revoke belongs on the web half')
  })

  test('registerPassportWebRoutes preserves caller `except` and merges with the wrapper exclusion', () => {
    // If a caller wants to skip an endpoint within the web half (say,
    // they implement their own consent UI but still want the revoke
    // endpoint), `except: ['authorize']` should still take effect.
    Passport.reset()
    const { captured, router } = capturingRouter()
    registerPassportWebRoutes(router, { except: ['authorize'] })
    const paths = new Set(captured.map(r => `${r.method} ${r.path}`))
    assert.equal(paths.has('GET /oauth/authorize'), false)
    assert.equal(paths.has('POST /oauth/authorize'), false)
    assert.equal(paths.has('DELETE /oauth/authorize'), false)
    assert.ok(paths.has('DELETE /oauth/tokens/:id'), 'revoke must still be mounted')
    // And the api half stays out regardless.
    assert.equal(paths.has('POST /oauth/token'), false)
  })

  test('registerPassportWebRoutes forwards authorizeMiddleware to the underlying mount', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const { captured, router } = capturingRouter()
    registerPassportWebRoutes(router, { authorizeMiddleware: [sentinel] })
    const post = captured.find(r => r.method === 'POST' && r.path === '/oauth/authorize')
    assert.ok(post)
    assert.ok(post!.mw.includes(sentinel))
  })

  test('registerPassportApiRoutes forwards tokenMiddleware to the underlying mount', () => {
    Passport.reset()
    const sentinel = async (_req: any, _res: any, next: () => Promise<void>) => next()
    const { captured, router } = capturingRouter()
    registerPassportApiRoutes(router, { tokenMiddleware: [sentinel] })
    const post = captured.find(r => r.method === 'POST' && r.path === '/oauth/token')
    assert.ok(post)
    assert.ok(post!.mw.includes(sentinel))
  })
})

