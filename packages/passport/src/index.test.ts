import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  PassportProvider,
  hashClientSecret,
  verifyClientSecret,
  createToken,
  verifyToken,
  unsafeDecodeToken,
  decodeToken,
  OAuthClient,
  AccessToken,
  RefreshToken,
  AuthCode,
  DeviceCode,
  BearerMiddleware,
  RequireBearer,
  scope,
  scopeAny,
  generateKeys,
  createClient,
  purgeTokens,
  issueTokens,
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
  validateScopes,
  OAuthError,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
  HasApiTokens,
  resetPersonalAccessClient,
  registerPassportRoutes,
} from './index.js'
import { safeCompare } from './grants/safe-compare.js'

describe('@rudderjs/passport exports', () => {
  test('Passport singleton is exported', () => {
    assert.ok(Passport)
    assert.equal(typeof Passport.tokensCan, 'function')
    assert.equal(typeof Passport.setKeys, 'function')
  })

  test('PassportProvider is a class', () => {
    assert.equal(typeof PassportProvider, 'function')
  })

  test('token helpers are functions', () => {
    assert.equal(typeof createToken, 'function')
    assert.equal(typeof verifyToken, 'function')
    assert.equal(typeof unsafeDecodeToken, 'function')
    // `decodeToken` is kept as a deprecated alias for back-compat — both
    // names must reach the same function.
    assert.equal(decodeToken, unsafeDecodeToken,
      '`decodeToken` must remain an alias for `unsafeDecodeToken`')
  })

  test('models are exported', () => {
    assert.ok(OAuthClient)
    assert.ok(AccessToken)
    assert.ok(RefreshToken)
    assert.ok(AuthCode)
    assert.ok(DeviceCode)
  })

  test('middleware helpers are functions', () => {
    assert.equal(typeof BearerMiddleware, 'function')
    assert.equal(typeof RequireBearer, 'function')
    assert.equal(typeof scope, 'function')
    assert.equal(typeof scopeAny, 'function')
  })

  test('command helpers are functions', () => {
    assert.equal(typeof generateKeys, 'function')
    assert.equal(typeof createClient, 'function')
    assert.equal(typeof purgeTokens, 'function')
  })

  test('grant functions are exported', () => {
    assert.equal(typeof issueTokens, 'function')
    assert.equal(typeof validateAuthorizationRequest, 'function')
    assert.equal(typeof issueAuthCode, 'function')
    assert.equal(typeof exchangeAuthCode, 'function')
    assert.equal(typeof clientCredentialsGrant, 'function')
    assert.equal(typeof refreshTokenGrant, 'function')
    assert.equal(typeof requestDeviceCode, 'function')
    assert.equal(typeof approveDeviceCode, 'function')
    assert.equal(typeof pollDeviceCode, 'function')
  })

  test('OAuthError is a constructable Error subclass', () => {
    const err = new OAuthError('invalid_request', 'bad', 400)
    assert.ok(err instanceof Error)
    assert.equal(err.error, 'invalid_request')
    assert.equal(err.errorDescription, 'bad')
    assert.equal(err.statusCode, 400)
  })

  test('personal access token helpers are exported', () => {
    assert.equal(typeof HasApiTokens, 'function')
    assert.equal(typeof resetPersonalAccessClient, 'function')
  })

  test('registerPassportRoutes is a function', () => {
    assert.equal(typeof registerPassportRoutes, 'function')
  })
})

describe('Passport Phase 6 customization hooks', () => {
  test('useClientModel / clientModel — override wins, defaults to OAuthClient', async () => {
    Passport.reset()
    assert.equal(await Passport.clientModel(), OAuthClient)

    class CustomClient extends OAuthClient {}
    Passport.useClientModel(CustomClient)
    assert.equal(await Passport.clientModel(), CustomClient)

    Passport.reset()
    assert.equal(await Passport.clientModel(), OAuthClient)
  })

  test('useTokenModel / tokenModel — override wins, defaults to AccessToken', async () => {
    Passport.reset()
    assert.equal(await Passport.tokenModel(), AccessToken)

    class CustomToken extends AccessToken {}
    Passport.useTokenModel(CustomToken)
    assert.equal(await Passport.tokenModel(), CustomToken)

    Passport.reset()
  })

  test('useRefreshTokenModel / useAuthCodeModel / useDeviceCodeModel defaults', async () => {
    Passport.reset()
    assert.equal(await Passport.refreshTokenModel(), RefreshToken)
    assert.equal(await Passport.authCodeModel(),     AuthCode)
    assert.equal(await Passport.deviceCodeModel(),   DeviceCode)
  })

  test('authorizationView stores a custom consent renderer', () => {
    Passport.reset()
    assert.equal(Passport.authorizationViewFn(), null)

    const fn = (_ctx: unknown) => ({ kind: 'view', name: 'consent' })
    Passport.authorizationView(fn)
    assert.equal(Passport.authorizationViewFn(), fn)

    Passport.reset()
    assert.equal(Passport.authorizationViewFn(), null)
  })

  test('ignoreRoutes toggles routesIgnored and short-circuits registerPassportRoutes', () => {
    Passport.reset()
    assert.equal(Passport.routesIgnored(), false)

    Passport.ignoreRoutes()
    assert.equal(Passport.routesIgnored(), true)

    let called = 0
    const fakeRouter = {
      get:    () => { called++ },
      post:   () => { called++ },
      delete: () => { called++ },
    }
    registerPassportRoutes(fakeRouter)
    assert.equal(called, 0, 'no routes registered when ignoreRoutes is set')

    Passport.reset()
  })

  test('registerPassportRoutes honors opts.except to skip route groups', () => {
    Passport.reset()
    const registered: Array<[string, string]> = []
    const fakeRouter = {
      get:    (p: string) => { registered.push(['GET',    p]) },
      post:   (p: string) => { registered.push(['POST',   p]) },
      delete: (p: string) => { registered.push(['DELETE', p]) },
    }

    registerPassportRoutes(fakeRouter, { except: ['device', 'scopes'] })

    const paths = registered.map(r => r[1])
    assert.ok(!paths.some(p => p.includes('/device')),  'device routes skipped')
    assert.ok(!paths.some(p => p.endsWith('/scopes')),   'scopes route skipped')
    assert.ok(paths.some(p => p.endsWith('/authorize')), 'authorize route still registered')
    assert.ok(paths.some(p => p.endsWith('/token')),     'token route still registered')

    Passport.reset()
  })

  test('registerPassportRoutes with empty opts registers all route groups', () => {
    Passport.reset()
    const registered: string[] = []
    const fakeRouter = {
      get:    (p: string) => { registered.push(`GET ${p}`) },
      post:   (p: string) => { registered.push(`POST ${p}`) },
      delete: (p: string) => { registered.push(`DELETE ${p}`) },
    }
    registerPassportRoutes(fakeRouter)
    // authorize (GET/POST/DELETE) + token + tokens/:id + scopes + device/code + device/approve
    assert.equal(registered.length, 8)
  })

  test('DELETE /oauth/tokens/:id is registered with RequireBearer middleware', () => {
    // Token ids are semi-public (they appear in JWT `jti` claims). Without
    // bearer auth + ownership enforcement, anyone with one captured JWT can
    // DoS arbitrary users by revoking their tokens by id. Regression guard
    // for E2 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
    Passport.reset()
    let revokeMiddleware: unknown[] | undefined
    const fakeRouter = {
      get:    () => {},
      post:   () => {},
      delete: (p: string, _h: unknown, mw?: unknown[]) => {
        if (p.endsWith('/tokens/:id')) revokeMiddleware = mw
      },
    }
    registerPassportRoutes(fakeRouter)
    assert.ok(Array.isArray(revokeMiddleware), 'revoke route must be registered with a middleware array')
    assert.equal(revokeMiddleware!.length, 1, 'revoke route should have exactly one middleware (RequireBearer)')
    const mw = revokeMiddleware![0] as { name?: string }
    assert.equal(typeof mw, 'function', 'middleware entry should be a function (RequireBearer)')
    assert.equal(mw.name, 'RequireBearer')
  })
})

describe('safeCompare — constant-time string comparison', () => {
  test('returns true for two equal hex strings', async () => {
    const a = 'a3b4c5d6e7f80123456789abcdef0123'
    assert.equal(await safeCompare(a, a), true)
  })

  test('returns true for two equal base64url strings', async () => {
    const a = 'q3RBZw7iOWB6XlxK6vFy_g'
    assert.equal(await safeCompare(a, a), true)
  })

  test('returns false on mismatch (same length)', async () => {
    assert.equal(await safeCompare('aaaaaa', 'bbbbbb'), false)
  })

  test('returns false on length mismatch', async () => {
    assert.equal(await safeCompare('abc', 'abcd'), false)
  })

  test('returns false when first arg is null', async () => {
    assert.equal(await safeCompare(null, 'abc'), false)
  })

  test('returns false when second arg is null', async () => {
    assert.equal(await safeCompare('abc', null), false)
  })

  test('returns false when both args are null', async () => {
    assert.equal(await safeCompare(null, null), false)
  })

  test('returns false when either arg is undefined', async () => {
    assert.equal(await safeCompare(undefined, 'abc'), false)
    assert.equal(await safeCompare('abc', undefined), false)
  })

  test('returns true for two empty strings (callers must guard against empty credentials)', async () => {
    assert.equal(await safeCompare('', ''), true)
  })
})

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

describe('HasApiTokens.tokenCan — wired to __passport_token', () => {
  // Regression guard for P2 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // Previously the mixin read `__currentToken`, which BearerMiddleware never wrote.
  // The middleware writes `__passport_token` on req.raw and stamps the same key
  // onto the resolved user model — the mixin must read the matching field.

  class FakeBaseModel {}
  const Mixed = HasApiTokens(FakeBaseModel as any) as any

  test('returns false when no token has been bound', () => {
    const u = new Mixed()
    assert.equal(u.tokenCan('write'), false)
  })

  test('returns true when __passport_token has the requested scope', () => {
    const u = new Mixed()
    u.__passport_token = { scopes: JSON.stringify(['read', 'write']), revoked: false }
    assert.equal(u.tokenCan('write'), true)
    assert.equal(u.tokenCan('read'), true)
  })

  test('returns false when __passport_token lacks the requested scope', () => {
    const u = new Mixed()
    u.__passport_token = { scopes: JSON.stringify(['read']), revoked: false }
    assert.equal(u.tokenCan('write'), false)
  })

  test('returns true for any scope when token has wildcard "*"', () => {
    const u = new Mixed()
    u.__passport_token = { scopes: JSON.stringify(['*']), revoked: false }
    assert.equal(u.tokenCan('anything'), true)
  })

  test('legacy __currentToken is no longer consulted', () => {
    // If a future regression renames the field back, this test catches it.
    const u = new Mixed()
    u.__currentToken = { scopes: JSON.stringify(['*']), revoked: false }
    assert.equal(u.tokenCan('write'), false)
  })
})

describe('HasApiTokens.tokens / revokeAllTokens — personal-access scoping (P10)', () => {
  // Regression guard for P10 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // Previously `tokens()` returned every access-token row owned by the user
  // (including OAuth-app session tokens), and `revokeAllTokens()` revoked
  // them all. Both must now filter by `clientId === personalAccessClient.id`
  // so a UI listing personal tokens / "log out of all my dev tokens" stays
  // out of unrelated third-party authorizations.

  /**
   * Build a fake AccessToken model that records every chained `where()`
   * predicate, returns a fixed array on `.get()`, and a fixed count on
   * `.updateAll()`. The recorded chain is what the assertions check —
   * proves both `userId` AND `clientId` are filtered, regardless of the
   * order the mixin applies them.
   */
  function fakeAccessTokenModel(matching: any[], updateCount: number) {
    const chains: Array<Array<[string, unknown]>> = []
    let current: Array<[string, unknown]> = []
    class FakeAccessToken {
      static __chains = chains
      static where(col: string, val: unknown) {
        if (current.length === 0) chains.push(current)
        current.push([col, val])
        return this as any
      }
      static async get() {
        const captured = current
        current = []
        return captured.find(([c]) => c === 'clientId') ? matching : []
      }
      static async updateAll() {
        current = []
        return updateCount
      }
    }
    return FakeAccessToken as any
  }

  /** Fake OAuthClient model that returns a known personal-access client. */
  function fakePersonalClientModel(personalId: string) {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({ id: personalId, name: '__personal_access__', confidential: false } as any),
        }
      }
      static async create() {
        return { id: personalId, name: '__personal_access__' } as any
      }
    }
    return FakeClient as any
  }

  test('tokens() filters by both userId and personal-access clientId', async () => {
    Passport.reset()
    resetPersonalAccessClient()
    const personalRows = [
      { id: 'AT-1', userId: 'U-1', clientId: 'PAC-1', name: 'cli', revoked: false },
      { id: 'AT-2', userId: 'U-1', clientId: 'PAC-1', name: 'editor', revoked: false },
    ]
    const FakeAT = fakeAccessTokenModel(personalRows, 0)
    Passport.useTokenModel(FakeAT)
    Passport.useClientModel(fakePersonalClientModel('PAC-1'))

    class FakeUser {
      id = 'U-1'
    }
    const Mixed = HasApiTokens(FakeUser as any) as any
    const user = new Mixed()
    const result = await user.tokens()

    // The returned rows are the personal-access ones — proves clientId
    // was applied (the fake's get() returns [] when clientId is missing).
    assert.equal(result.length, 2)
    // The chain must include both userId and personal-access clientId.
    const lastChain = FakeAT.__chains[FakeAT.__chains.length - 1] as Array<[string, unknown]>
    assert.deepEqual(
      lastChain.find(([c]) => c === 'userId'),
      ['userId', 'U-1'],
    )
    assert.deepEqual(
      lastChain.find(([c]) => c === 'clientId'),
      ['clientId', 'PAC-1'],
    )
    Passport.reset()
    resetPersonalAccessClient()
  })

  test('revokeAllTokens() filters by both userId and personal-access clientId', async () => {
    Passport.reset()
    resetPersonalAccessClient()
    const FakeAT = fakeAccessTokenModel([], 3)
    Passport.useTokenModel(FakeAT)
    Passport.useClientModel(fakePersonalClientModel('PAC-2'))

    class FakeUser {
      id = 'U-9'
    }
    const Mixed = HasApiTokens(FakeUser as any) as any
    const user = new Mixed()
    const count = await user.revokeAllTokens()
    assert.equal(count, 3)

    const lastChain = FakeAT.__chains[FakeAT.__chains.length - 1] as Array<[string, unknown]>
    assert.deepEqual(
      lastChain.find(([c]) => c === 'userId'),
      ['userId', 'U-9'],
    )
    assert.deepEqual(
      lastChain.find(([c]) => c === 'clientId'),
      ['clientId', 'PAC-2'],
    )
    // The pre-existing `revoked = false` predicate (skips already-revoked
    // rows) must still be present.
    assert.deepEqual(
      lastChain.find(([c]) => c === 'revoked'),
      ['revoked', false],
    )
    Passport.reset()
    resetPersonalAccessClient()
  })
})

describe('generateKeys — backup on --force', () => {
  // Regression guard for L1 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // `--force` previously overwrote the private key with no recovery path.

  test('returns null backup when no existing keys', async () => {
    const { mkdtemp, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, basename } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      const { generateKeys } = await import('./commands/keys.js')
      const result = await generateKeys()
      assert.equal(result.backup, null)
      assert.equal(basename(result.privatePath), 'oauth-private.key')
      assert.equal(basename(result.publicPath),  'oauth-public.key')
      const files = await readdir(dir)
      assert.ok(files.includes('oauth-private.key'))
      assert.ok(files.includes('oauth-public.key'))
      assert.equal(files.filter(f => f.includes('.bak.')).length, 0)
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('without --force, refuses to overwrite existing keys', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      await writeFile(join(dir, 'oauth-private.key'), 'OLD-PRIVATE')
      const { generateKeys } = await import('./commands/keys.js')
      await assert.rejects(() => generateKeys(), /already exist/)
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('with --force, renames existing keys to .bak.<timestamp> before writing new ones', async () => {
    const { mkdtemp, writeFile, readFile, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      await writeFile(join(dir, 'oauth-private.key'), 'OLD-PRIVATE')
      await writeFile(join(dir, 'oauth-public.key'),  'OLD-PUBLIC')

      const { generateKeys } = await import('./commands/keys.js')
      const result = await generateKeys({ force: true })

      assert.ok(result.backup, 'backup paths must be returned')
      assert.match(result.backup!.privatePath, /oauth-private\.key\.bak\./)
      assert.match(result.backup!.publicPath,  /oauth-public\.key\.bak\./)

      const oldPrivate = await readFile(result.backup!.privatePath, 'utf8')
      const oldPublic  = await readFile(result.backup!.publicPath,  'utf8')
      assert.equal(oldPrivate, 'OLD-PRIVATE')
      assert.equal(oldPublic,  'OLD-PUBLIC')

      const newPrivate = await readFile(join(dir, 'oauth-private.key'), 'utf8')
      assert.notEqual(newPrivate, 'OLD-PRIVATE')
      assert.match(newPrivate, /BEGIN PRIVATE KEY/)

      const files = await readdir(dir)
      const backups = files.filter(f => f.includes('.bak.'))
      assert.equal(backups.length, 2, 'exactly two backup files (private + public)')
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('refresh-token reuse-chain revocation (P4)', () => {
  // Regression guard for P4 / M(H4) from the passport-surface review:
  // RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP §4.14 — when a previously
  // rotated refresh token is presented again, revoke the entire family
  // (every access + refresh token issued through the same rotation chain).
  // Legacy rows minted before the familyId column existed are exempt
  // during the migration window — same approach as redirect_uri (P1/E4).

  // Lazily-initialised RSA test keys — issueTokens signs a JWT, so any
  // test that gets past the early rejection branches needs real keys.
  let TEST_PRIVATE_KEY: string | null = null
  let TEST_PUBLIC_KEY:  string | null = null
  async function ensureTestKeys(): Promise<void> {
    if (TEST_PRIVATE_KEY && TEST_PUBLIC_KEY) {
      Passport.setKeys(TEST_PRIVATE_KEY, TEST_PUBLIC_KEY)
      return
    }
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    })
    TEST_PRIVATE_KEY = privateKey
    TEST_PUBLIC_KEY  = publicKey
    Passport.setKeys(privateKey, publicKey)
  }

  type Updates = Array<{ id: string; data: Record<string, unknown> }>

  function fakeClient(record: Record<string, unknown>) {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => record as any }
      }
    }
    return FakeClient as any
  }

  function fakeAccessToken(rows: Record<string, Record<string, unknown>>) {
    const updates: Updates = []
    function makeBuilder(initialPredicate: (row: Record<string, unknown>) => boolean): any {
      let predicate = initialPredicate
      const builder: any = {
        where(col: string, opOrVal: unknown, maybeVal?: unknown) {
          const hasOp = arguments.length === 3
          const op  = hasOp ? (opOrVal as string) : '='
          const val = hasOp ? maybeVal : opOrVal
          const prev = predicate
          predicate = (row) => {
            if (!prev(row)) return false
            const cell = row[col]
            if (op === 'IN' || op === 'NOT IN') {
              const set = new Set(val as unknown[])
              return op === 'IN' ? set.has(cell) : !set.has(cell)
            }
            return cell === val
          }
          return builder
        },
        first: async () => Object.values(rows).find(predicate) ?? null,
        get:   async () => Object.values(rows).filter(predicate),
        async updateAll(data: Record<string, unknown>) {
          let count = 0
          for (const id of Object.keys(rows)) {
            const row = rows[id]
            if (!row || !predicate(row)) continue
            updates.push({ id, data: { ...data } })
            Object.assign(row, data)
            count++
          }
          return count
        },
      }
      return builder
    }
    class FakeAccessToken {
      static updates = updates
      static where(col: string, val: unknown) {
        return makeBuilder((row) => row[col] === val)
      }
      static query() {
        return makeBuilder(() => true)
      }
      static async update(id: string, data: Record<string, unknown>) {
        updates.push({ id, data })
        const row = rows[id]
        if (row) Object.assign(row, data)
      }
    }
    return FakeAccessToken as any
  }

  function fakeRefreshToken(rows: Record<string, Record<string, unknown>>) {
    const updates: Updates = []
    const created: Record<string, unknown>[] = []
    let nextId = 0
    function makeBuilder(initialPredicate: (row: Record<string, unknown>) => boolean): any {
      let predicate = initialPredicate
      const builder: any = {
        where(col: string, opOrVal: unknown, maybeVal?: unknown) {
          const hasOp = arguments.length === 3
          const op  = hasOp ? (opOrVal as string) : '='
          const val = hasOp ? maybeVal : opOrVal
          const prev = predicate
          predicate = (row) => {
            if (!prev(row)) return false
            const cell = row[col]
            if (op === 'IN' || op === 'NOT IN') {
              const set = new Set(val as unknown[])
              return op === 'IN' ? set.has(cell) : !set.has(cell)
            }
            return cell === val
          }
          return builder
        },
        first: async () => Object.values(rows).find(predicate) ?? null,
        get:   async () => Object.values(rows).filter(predicate),
        async updateAll(data: Record<string, unknown>) {
          let count = 0
          for (const id of Object.keys(rows)) {
            const row = rows[id]
            if (!row || !predicate(row)) continue
            updates.push({ id, data: { ...data } })
            Object.assign(row, data)
            count++
          }
          return count
        },
      }
      return builder
    }
    class FakeRefreshToken {
      static updates = updates
      static created = created
      static where(col: string, val: unknown) {
        return makeBuilder((row) => row[col] === val)
      }
      static query() {
        return makeBuilder(() => true)
      }
      static async update(id: string, data: Record<string, unknown>) {
        updates.push({ id, data })
        const row = rows[id]
        if (row) Object.assign(row, data)
      }
      static async create(data: Record<string, unknown>) {
        nextId++
        const id = `RT-NEW-${nextId}`
        const row = { ...data, id }
        rows[id] = row
        created.push(row)
        return row as any
      }
    }
    return FakeRefreshToken as any
  }

  // Bypass the access-token write path inside issueTokens — we only care
  // about the refresh-token bookkeeping for these tests.
  function fakeAccessTokenForIssue(linkedAccessId: string, accessRows: Record<string, Record<string, unknown>>) {
    let counter = 0
    function makeBuilder(initialPredicate: (row: Record<string, unknown>) => boolean): any {
      let predicate = initialPredicate
      const builder: any = {
        where(col: string, opOrVal: unknown, maybeVal?: unknown) {
          const hasOp = arguments.length === 3
          const op  = hasOp ? (opOrVal as string) : '='
          const val = hasOp ? maybeVal : opOrVal
          const prev = predicate
          predicate = (row) => {
            if (!prev(row)) return false
            const cell = row[col]
            if (op === 'IN' || op === 'NOT IN') {
              const set = new Set(val as unknown[])
              return op === 'IN' ? set.has(cell) : !set.has(cell)
            }
            return cell === val
          }
          return builder
        },
        first: async () => Object.values(accessRows).find(predicate) ?? null,
        get:   async () => Object.values(accessRows).filter(predicate),
        async updateAll(data: Record<string, unknown>) {
          let count = 0
          for (const id of Object.keys(accessRows)) {
            const row = accessRows[id]
            if (!row || !predicate(row)) continue
            Object.assign(row, data)
            count++
          }
          return count
        },
      }
      return builder
    }
    class FakeAccessToken {
      static where(col: string, val: unknown) {
        return makeBuilder((row) => row[col] === val)
      }
      static query() {
        return makeBuilder(() => true)
      }
      static async create(data: Record<string, unknown>) {
        counter++
        const id = `AT-NEW-${counter}-${linkedAccessId}`
        accessRows[id] = { ...data, id }
        return { ...data, id } as any
      }
      static async update(id: string, data: Record<string, unknown>) {
        const row = accessRows[id]
        if (row) Object.assign(row, data)
      }
    }
    return FakeAccessToken as any
  }

  test('legitimate rotation copies familyId from the old refresh token to the new one', async () => {
    Passport.reset()
    await ensureTestKeys()
    Passport.useClientModel(fakeClient({
      id: 'C-1', name: 'app', secret: null, confidential: false,
      redirectUris: '[]', grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))
    const accessRows = {
      'AT-1': { id: 'AT-1', userId: 'U-1', clientId: 'C-1', scopes: '["read"]', revoked: false, expiresAt: new Date(Date.now() + 60_000) },
    }
    Passport.useTokenModel(fakeAccessTokenForIssue('AT-1', accessRows))
    const refreshRows = {
      'RT-1': { id: 'RT-1', accessTokenId: 'AT-1', familyId: 'FAM-1', revoked: false, expiresAt: new Date(Date.now() + 600_000) },
    }
    const FakeRefresh = fakeRefreshToken(refreshRows)
    Passport.useRefreshTokenModel(FakeRefresh)

    const result = await refreshTokenGrant({
      grantType:    'refresh_token',
      refreshToken: 'RT-1',
      clientId:     'C-1',
    })

    assert.ok(result.refresh_token, 'a new refresh token must be issued')
    assert.equal(FakeRefresh.created.length, 1)
    assert.equal(FakeRefresh.created[0].familyId, 'FAM-1', 'rotation must preserve the family id')
    assert.equal(refreshRows['RT-1'].revoked, true, 'old refresh token must be marked revoked')

    Passport.reset()
  })

  test('reuse of a revoked refresh token cascades to the entire family', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClient({
      id: 'C-1', name: 'app', secret: null, confidential: false,
      redirectUris: '[]', grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))

    const accessRows: Record<string, Record<string, unknown>> = {
      'AT-OLD':  { id: 'AT-OLD',  clientId: 'C-1', revoked: true,  scopes: '["read"]', expiresAt: new Date(Date.now() + 60_000) },
      'AT-LIVE': { id: 'AT-LIVE', clientId: 'C-1', revoked: false, scopes: '["read"]', expiresAt: new Date(Date.now() + 60_000) },
    }
    const FakeAccess = fakeAccessToken(accessRows)
    Passport.useTokenModel(FakeAccess)

    // RT-OLD has already been rotated (revoked=true). RT-LIVE is the
    // current member of the same family. Presenting RT-OLD again is the
    // attacker scenario — both tokens (and their access tokens) must die.
    const refreshRows: Record<string, Record<string, unknown>> = {
      'RT-OLD':  { id: 'RT-OLD',  accessTokenId: 'AT-OLD',  familyId: 'FAM-X', revoked: true,  expiresAt: new Date(Date.now() + 600_000) },
      'RT-LIVE': { id: 'RT-LIVE', accessTokenId: 'AT-LIVE', familyId: 'FAM-X', revoked: false, expiresAt: new Date(Date.now() + 600_000) },
    }
    const FakeRefresh = fakeRefreshToken(refreshRows)
    Passport.useRefreshTokenModel(FakeRefresh)

    await assert.rejects(
      () => refreshTokenGrant({
        grantType:    'refresh_token',
        refreshToken: 'RT-OLD',
        clientId:     'C-1',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /revoked/.test(e.errorDescription),
    )

    assert.equal(refreshRows['RT-LIVE']!.revoked, true, 'sibling refresh token in family must be revoked')
    assert.equal(accessRows['AT-LIVE']!.revoked,  true, 'sibling access token in family must be revoked')
    // Already-revoked rows aren't double-written (skip the redundant update).
    assert.ok(
      !FakeRefresh.updates.some((u: { id: string }) => u.id === 'RT-OLD'),
      'already-revoked refresh token should not be redundantly updated',
    )

    Passport.reset()
  })

  test('legacy null familyId — reuse still throws but no cascade is attempted', async () => {
    // Auth codes / refresh tokens minted before the familyId column was
    // added must remain usable until they expire. The reuse path still
    // throws invalid_grant, but the family lookup is skipped (no rows
    // share `familyId = null` semantically — every legacy row is its own
    // unrelated session).
    Passport.reset()
    Passport.useClientModel(fakeClient({
      id: 'C-1', name: 'app', secret: null, confidential: false,
      redirectUris: '[]', grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))
    Passport.useTokenModel(fakeAccessToken({}))

    const refreshRows: Record<string, Record<string, unknown>> = {
      'RT-LEGACY':   { id: 'RT-LEGACY',   accessTokenId: 'AT-LEGACY',   familyId: null, revoked: true,  expiresAt: new Date(Date.now() + 600_000) },
      'RT-UNRELATED':{ id: 'RT-UNRELATED',accessTokenId: 'AT-UNRELATED',familyId: null, revoked: false, expiresAt: new Date(Date.now() + 600_000) },
    }
    const FakeRefresh = fakeRefreshToken(refreshRows)
    Passport.useRefreshTokenModel(FakeRefresh)

    await assert.rejects(
      () => refreshTokenGrant({
        grantType:    'refresh_token',
        refreshToken: 'RT-LEGACY',
        clientId:     'C-1',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /revoked/.test(e.errorDescription),
    )

    assert.equal(refreshRows['RT-UNRELATED']!.revoked, false, 'unrelated legacy refresh tokens must NOT be revoked')
    assert.equal(FakeRefresh.updates.length, 0, 'no family-walk writes should occur when familyId is null')

    Passport.reset()
  })

  test('first issuance generates a fresh familyId on the new refresh token', async () => {
    // Direct issueTokens() call — proves the contract that any caller
    // that doesn't pass an existing familyId gets a freshly minted one.
    // We need real RSA keys here because issueTokens signs a JWT.
    Passport.reset()
    await ensureTestKeys()

    const accessRows = {}
    Passport.useTokenModel(fakeAccessTokenForIssue('AT', accessRows))
    const refreshRows: Record<string, Record<string, unknown>> = {}
    const FakeRefresh = fakeRefreshToken(refreshRows)
    Passport.useRefreshTokenModel(FakeRefresh)

    const { issueTokens } = await import('./grants/issue-tokens.js')
    await issueTokens({
      userId:         'U-1',
      clientId:       'C-1',
      scopes:         ['read'],
      includeRefresh: true,
    })

    assert.equal(FakeRefresh.created.length, 1)
    const familyId = FakeRefresh.created[0].familyId
    assert.equal(typeof familyId, 'string', 'familyId must be set on first issuance')
    assert.ok((familyId as string).length > 0, 'familyId must be a non-empty string')

    Passport.reset()
  })
})

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
    class FakeDeviceCode {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id:           'DC-1',
            clientId:     'C-1',
            userCode:     'ABCD-WXYZ',
            deviceCode:   'DC-1',
            scopes:       '[]',
            userId:       null,
            approved:     null,
            expiresAt:    new Date(Date.now() + 60_000),
            lastPolledAt: new Date(), // now → forces slow_down
            createdAt:    new Date(),
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

describe('HTTP Basic client authentication (E9)', () => {
  // Regression guard for E9 — RFC 6749 §2.3.1 requires servers to support
  // HTTP Basic for confidential client authentication; §2.3 forbids using
  // both Basic and body params at once. The /oauth/token route now parses
  // Basic, falls back to body params, and rejects mixed credentials.

  function tokenHandler(): (req: any, res: any) => Promise<unknown> {
    let captured: ((req: any, res: any) => Promise<unknown>) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (path: string, handler: (req: any, res: any) => Promise<unknown>) => {
        if (path.endsWith('/token')) captured = handler
      },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter as any)
    return captured!
  }

  function fakeRes() {
    let status = 0
    let body: any = null
    const headers: Record<string, string> = {}
    return {
      status(s: number) { status = s; return this },
      json(b: unknown) { body = b; return this },
      header(k: string, v: string) { headers[k] = v; return this },
      get statusValue() { return status },
      get bodyValue() { return body },
      get headersValue() { return headers },
    }
  }

  test('E9 — Basic header credentials are accepted (no body params required)', async () => {
    Passport.reset()
    // Stub out the client lookup so we get past credential extraction.
    // The grant will fail with "Invalid client secret" because we don't
    // pre-hash matching secrets in the fake — that's fine, we just want
    // to prove the route accepted the Basic header and didn't reject as
    // "client_id is required."
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id: 'C-1', name: 'app',
            secret: 'irrelevant', confidential: true, revoked: false,
            redirectUris: '[]', grantTypes: '["client_credentials"]', scopes: '[]',
          }) as any,
        }
      }
    }
    Passport.useClientModel(FakeClient as any)

    const handler = tokenHandler()
    const basic = Buffer.from('C-1:secret-123', 'utf8').toString('base64')
    const req = {
      headers: { authorization: `Basic ${basic}` },
      raw: {} as Record<string, unknown>,
      body: { grant_type: 'client_credentials' },
    }
    const res = fakeRes()

    await handler(req, res)

    // Surfaces invalid_client (secret mismatch) which means credential
    // extraction succeeded — the alternative pre-fix would have been
    // "client_id is required." (no body, no header parsing yet).
    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_client')
    assert.match(res.bodyValue.error_description, /Invalid client secret/)

    Passport.reset()
  })

  test('E9 — Basic prefix is case-insensitive (basic / BASIC accepted)', async () => {
    Passport.reset()
    Passport.useClientModel(class {
      static where() { return { first: async () => null } }
    } as any)

    const handler = tokenHandler()
    for (const prefix of ['basic', 'BASIC', 'Basic']) {
      const basic = Buffer.from('C-X:s', 'utf8').toString('base64')
      const req = {
        headers: { authorization: `${prefix} ${basic}` },
        raw: {},
        body: { grant_type: 'authorization_code', code: 'AC' },
      }
      const res = fakeRes()
      await handler(req, res)
      // No client found → invalid_client with the resolved id 'C-X'.
      // Pre-fix, only `Basic` would parse; `basic`/`BASIC` would skip
      // header parsing and fall back to body, throwing "client_id is
      // required." We assert we did NOT get that fallback message.
      assert.equal(res.bodyValue.error, 'invalid_client', `${prefix}: must parse as Basic`)
    }

    Passport.reset()
  })

  test('E9 — sending client_secret in BOTH Basic header and body is rejected', async () => {
    // RFC 6749 §2.3 — clients MUST NOT use both at once. Reject with
    // invalid_request rather than silently picking one.
    Passport.reset()
    const handler = tokenHandler()
    const basic = Buffer.from('C-1:header-secret', 'utf8').toString('base64')
    const req = {
      headers: { authorization: `Basic ${basic}` },
      raw: {},
      body: {
        grant_type:    'client_credentials',
        client_secret: 'body-secret',
      },
    }
    const res = fakeRes()

    await handler(req, res)

    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_request')
    assert.match(res.bodyValue.error_description, /must not be sent in both/)

    Passport.reset()
  })

  test('E9 — Basic header client_id mismatching body client_id is rejected', async () => {
    Passport.reset()
    const handler = tokenHandler()
    const basic = Buffer.from('C-HEADER:s', 'utf8').toString('base64')
    const req = {
      headers: { authorization: `Basic ${basic}` },
      raw: {},
      body: {
        grant_type: 'client_credentials',
        client_id:  'C-BODY',
      },
    }
    const res = fakeRes()

    await handler(req, res)

    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_request')
    assert.match(res.bodyValue.error_description, /does not match request body/)

    Passport.reset()
  })

  test('E9 — malformed Basic credentials (no colon) → invalid_request', async () => {
    Passport.reset()
    const handler = tokenHandler()
    // base64 of "noColonHere" — no separator means no client_id/secret split.
    const malformed = Buffer.from('noColonHere', 'utf8').toString('base64')
    const req = {
      headers: { authorization: `Basic ${malformed}` },
      raw: {},
      body: { grant_type: 'client_credentials' },
    }
    const res = fakeRes()

    await handler(req, res)

    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_request')
    assert.match(res.bodyValue.error_description, /Malformed HTTP Basic/)

    Passport.reset()
  })

  test('E9 — body-only credentials still work (unchanged path)', async () => {
    // Backward compat: clients that don't use Basic should keep working.
    Passport.reset()
    Passport.useClientModel(class {
      static where() { return { first: async () => null } }
    } as any)

    const handler = tokenHandler()
    const req = {
      headers: {},
      raw: {},
      body: {
        grant_type:    'authorization_code',
        code:          'AC-1',
        client_id:     'C-BODY',
        client_secret: 'body-secret',
        redirect_uri:  'https://app.example.com/cb',
      },
    }
    const res = fakeRes()

    await handler(req, res)

    // No client found → invalid_client (downstream lookup) — proves the
    // body credentials made it to the grant.
    assert.equal(res.bodyValue.error, 'invalid_client')

    Passport.reset()
  })

  test('E9 — missing client_id (no header, no body) → invalid_request', async () => {
    Passport.reset()
    const handler = tokenHandler()
    const req = {
      headers: {},
      raw: {},
      body: { grant_type: 'authorization_code', code: 'AC-1' },
    }
    const res = fakeRes()

    await handler(req, res)

    assert.equal(res.bodyValue.error, 'invalid_request')
    assert.match(res.bodyValue.error_description, /client_id is required/)

    Passport.reset()
  })

  test('E9 — client_credentials without secret → invalid_request 401', async () => {
    // The grant requires a secret (it's confidential-only). Surfacing it
    // here yields a clearer error than letting the grant lookup the
    // empty hash and throw "Invalid client secret."
    Passport.reset()
    const handler = tokenHandler()
    const req = {
      headers: {},
      raw: {},
      body: { grant_type: 'client_credentials', client_id: 'C-1' },
    }
    const res = fakeRes()

    await handler(req, res)

    assert.equal(res.statusValue, 401)
    assert.equal(res.bodyValue.error, 'invalid_request')
    assert.match(res.bodyValue.error_description, /client_secret is required/)
    assert.equal(res.headersValue['WWW-Authenticate'], 'Basic realm="oauth"', 'WWW-Authenticate header on 401')

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

describe('scope validation (E6) — registry + per-client allow-list', () => {
  // Regression guards for E6 — RFC 6749 §3.3 requires that requested scopes
  // outside the server's known set raise `invalid_scope`. We enforce two
  // gates: (1) the global registry declared via `Passport.tokensCan()`, and
  // (2) the per-client `client.scopes` allow-list. Each gate is only enforced
  // when populated — empty registry / empty client allow-list means
  // "no constraint configured".

  function clientWith(scopes: string[]): any {
    // Confidential by default so the auth-code path doesn't trip the
    // public-client PKCE requirement before scope validation runs. Tests
    // that need a hashed secret override `secret` + `confidential` after.
    return {
      id: 'C-1', name: 'app', secret: 'unused', confidential: true, revoked: false,
      redirectUris: '["https://app.example.com/cb"]',
      grantTypes: '["authorization_code","client_credentials","urn:ietf:params:oauth:grant-type:device_code"]',
      scopes: JSON.stringify(scopes),
    }
  }

  // ── validateScopes (direct) ──────────────────────────────

  test('no-op when no scopes requested — caller passed empty array', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read access' })
    assert.doesNotThrow(() => validateScopes(clientWith([]), []))
    Passport.reset()
  })

  test('global gate — unknown scope is rejected when registry has entries', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read access', write: 'Write access' })
    assert.throws(
      () => validateScopes(clientWith([]), ['read', 'admin']),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /admin/.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('global gate — passes for fully-registered scope set', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read access', write: 'Write access' })
    assert.doesNotThrow(() => validateScopes(clientWith([]), ['read', 'write']))
    Passport.reset()
  })

  test('global gate — wildcard "*" is always allowed (mirrors Passport.validScopes)', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read access' })
    assert.doesNotThrow(() => validateScopes(clientWith([]), ['*']))
    Passport.reset()
  })

  test('global gate — empty registry skips the gate (back-compat with apps that never call tokensCan)', () => {
    Passport.reset()
    // Registry left empty on purpose. Pre-fix scaffolding never called
    // `tokensCan`, so any non-empty scope request must pass through —
    // otherwise we break every existing playground/scaffolder install.
    assert.doesNotThrow(() => validateScopes(clientWith([]), ['anything']))
    Passport.reset()
  })

  test('per-client gate — scope outside client allow-list is rejected', () => {
    Passport.reset()
    // Register globally so the global gate passes; client narrows further.
    Passport.tokensCan({ read: 'Read', write: 'Write' })
    assert.throws(
      () => validateScopes(clientWith(['read']), ['read', 'write']),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /not authorized for this client/.test(e.errorDescription) && /write/.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('per-client gate — empty client.scopes means "no client-level restriction"', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read', write: 'Write' })
    // client.scopes = [] → gate skipped; only the global gate runs.
    assert.doesNotThrow(() => validateScopes(clientWith([]), ['read', 'write']))
    Passport.reset()
  })

  test('per-client gate — wildcard "*" survives the client allow-list', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read' })
    assert.doesNotThrow(() => validateScopes(clientWith(['read']), ['*']))
    Passport.reset()
  })

  // ── validateAuthorizationRequest integration ─────────────

  function fakeClientModel(record: Record<string, unknown> | null) {
    class FakeClient {
      static where(_col: string, _val: unknown) {
        return { first: async () => record as any }
      }
    }
    return FakeClient as any
  }

  test('GET /oauth/authorize — invalid_scope raised when request asks for an unknown scope', async () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read access' })
    Passport.useClientModel(fakeClientModel(clientWith([])))

    await assert.rejects(
      () => validateAuthorizationRequest({
        clientId:     'C-1',
        redirectUri:  'https://app.example.com/cb',
        responseType: 'code',
        scope:        'read admin',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /admin/.test(e.errorDescription),
    )

    Passport.reset()
  })

  test('GET /oauth/authorize — invalid_scope raised when request exceeds client allow-list', async () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read', write: 'Write' })
    // Client only permits "read" — requesting "write" must be rejected even
    // though "write" is in the global registry.
    Passport.useClientModel(fakeClientModel(clientWith(['read'])))

    await assert.rejects(
      () => validateAuthorizationRequest({
        clientId:     'C-1',
        redirectUri:  'https://app.example.com/cb',
        responseType: 'code',
        scope:        'read write',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /not authorized for this client/.test(e.errorDescription),
    )

    Passport.reset()
  })

  test('GET /oauth/authorize — passes when scopes are valid + within client allow-list', async () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read', write: 'Write' })
    Passport.useClientModel(fakeClientModel(clientWith(['read', 'write'])))

    const result = await validateAuthorizationRequest({
      clientId:     'C-1',
      redirectUri:  'https://app.example.com/cb',
      responseType: 'code',
      scope:        'read',
    })
    assert.deepEqual(result.scopes, ['read'])

    Passport.reset()
  })

  // ── clientCredentialsGrant integration ───────────────────

  test('client_credentials — invalid_scope raised on unknown scope', async () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read' })

    // Hash matches sha256('s') so the secret check passes first; we want
    // scope validation to be the failure point, not the credential check.
    const { createHash } = await import('node:crypto')
    const hashedSecret = createHash('sha256').update('s').digest('hex')

    Passport.useClientModel(fakeClientModel({
      ...clientWith([]),
      secret: hashedSecret, confidential: true,
    }))

    await assert.rejects(
      () => clientCredentialsGrant({
        grantType:    'client_credentials',
        clientId:     'C-1',
        clientSecret: 's',
        scope:        'read admin',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /admin/.test(e.errorDescription),
    )

    Passport.reset()
  })

  // ── requestDeviceCode integration ────────────────────────

  test('device_code — invalid_scope raised when request exceeds client allow-list', async () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read', write: 'Write' })

    Passport.useClientModel(fakeClientModel(clientWith(['read'])))

    // We don't expect to reach DeviceCode.create — scope validation should
    // throw first. If the test ever fails because create() is hit, the
    // helper is being skipped on this code path.
    class FailIfReached {
      static async create() { throw new Error('device-code create() should not have been called') }
    }
    Passport.useDeviceCodeModel(FailIfReached as any)

    await assert.rejects(
      () => requestDeviceCode({
        clientId: 'C-1',
        scope:    'read write',
        verificationUri: 'https://example.com/oauth/device',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /not authorized for this client/.test(e.errorDescription),
    )

    Passport.reset()
  })
})

describe('purgeTokens — bulk delete via QueryBuilder', () => {
  /**
   * Records every where/orWhere chain emitted on the model and returns a
   * fixed delete count from `deleteAll()`. Lets us assert on:
   *   - that exactly ONE deleteAll() call lands per model (no N+1 loop)
   *   - that the chained predicates match what the purge contract promises
   *     (`expiresAt < now` OR `revoked = true` for tokens; expiry only for codes)
   */
  function makeFakeModel(name: string, deleteCount: number) {
    const calls: { wheres: Array<[string, string, unknown]>, deleted: boolean }[] = []
    class Fake {
      static get __purgeCalls() { return calls }
      static get __name() { return name }
      static query() {
        const chain: { wheres: Array<[string, string, unknown]>, deleted: boolean } = { wheres: [], deleted: false }
        calls.push(chain)
        const builder: any = {
          where(col: string, op: string, val?: unknown) {
            if (arguments.length === 2) { chain.wheres.push([col, '=', op]) }
            else                        { chain.wheres.push([col, op, val]) }
            return builder
          },
          orWhere(col: string, op: string, val?: unknown) {
            if (arguments.length === 2) { chain.wheres.push(['OR:'+col, '=', op]) }
            else                        { chain.wheres.push(['OR:'+col, op, val]) }
            return builder
          },
          async deleteAll() { chain.deleted = true; return deleteCount },
        }
        return builder
      }
    }
    return Fake as any
  }

  test('issues one deleteAll() per model and returns its count', async () => {
    Passport.reset()
    const Access  = makeFakeModel('access', 7)
    const Refresh = makeFakeModel('refresh', 3)
    const Auth    = makeFakeModel('auth', 2)
    const Device  = makeFakeModel('device', 1)
    Passport.useTokenModel(Access)
    Passport.useRefreshTokenModel(Refresh)
    Passport.useAuthCodeModel(Auth)
    Passport.useDeviceCodeModel(Device)

    const counts = await purgeTokens()

    assert.deepEqual(counts, { accessTokens: 7, refreshTokens: 3, authCodes: 2, deviceCodes: 1 })
    for (const Cls of [Access, Refresh, Auth, Device]) {
      assert.equal(Cls.__purgeCalls.length, 1, `${Cls.__name} should issue exactly one query() chain`)
      assert.equal(Cls.__purgeCalls[0].deleted, true, `${Cls.__name} should call deleteAll()`)
    }
    Passport.reset()
  })

  test('access + refresh tokens scope by expiresAt < now OR revoked = true', async () => {
    Passport.reset()
    const Access  = makeFakeModel('access', 0)
    const Refresh = makeFakeModel('refresh', 0)
    const Auth    = makeFakeModel('auth', 0)
    const Device  = makeFakeModel('device', 0)
    Passport.useTokenModel(Access)
    Passport.useRefreshTokenModel(Refresh)
    Passport.useAuthCodeModel(Auth)
    Passport.useDeviceCodeModel(Device)

    await purgeTokens()

    for (const Cls of [Access, Refresh]) {
      const wheres = Cls.__purgeCalls[0].wheres
      assert.equal(wheres.length, 2, `${Cls.__name} expected 2 predicates`)
      assert.equal(wheres[0][0], 'expiresAt')
      assert.equal(wheres[0][1], '<')
      assert.ok(wheres[0][2] instanceof Date)
      assert.deepEqual(wheres[1], ['OR:revoked', '=', true])
    }
    Passport.reset()
  })

  test('auth + device codes scope by expiresAt < now only (no revoked column)', async () => {
    Passport.reset()
    const Access  = makeFakeModel('access', 0)
    const Refresh = makeFakeModel('refresh', 0)
    const Auth    = makeFakeModel('auth', 0)
    const Device  = makeFakeModel('device', 0)
    Passport.useTokenModel(Access)
    Passport.useRefreshTokenModel(Refresh)
    Passport.useAuthCodeModel(Auth)
    Passport.useDeviceCodeModel(Device)

    await purgeTokens()

    for (const Cls of [Auth, Device]) {
      const wheres = Cls.__purgeCalls[0].wheres
      assert.equal(wheres.length, 1, `${Cls.__name} expected 1 predicate`)
      assert.deepEqual([wheres[0][0], wheres[0][1]], ['expiresAt', '<'])
      assert.ok(wheres[0][2] instanceof Date)
    }
    Passport.reset()
  })
})

describe('Passport.keysAvailable() — L4 boot warning probe', () => {
  test('returns true when keys are explicitly set via setKeys()', async () => {
    Passport.reset()
    Passport.setKeys('PRIV', 'PUB')
    assert.equal(await Passport.keysAvailable(), true)
    Passport.reset()
  })

  test('returns false when no explicit keys + key files do not exist on disk', async () => {
    Passport.reset()
    // Point at a path under cwd that we know contains no oauth keys
    Passport.loadKeysFrom('does-not-exist-' + Date.now())
    assert.equal(await Passport.keysAvailable(), false)
    Passport.reset()
  })

  test('returns true when no explicit keys but both key files exist on disk', async () => {
    Passport.reset()
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, relative } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    try {
      await writeFile(join(dir, 'oauth-private.key'), 'PRIV')
      await writeFile(join(dir, 'oauth-public.key'),  'PUB')
      // keysAvailable() joins on process.cwd(), so feed it a relative path
      const rel = relative(process.cwd(), dir)
      Passport.loadKeysFrom(rel)
      assert.equal(await Passport.keysAvailable(), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      Passport.reset()
    }
  })

  test('returns false when only one of the two key files exists', async () => {
    Passport.reset()
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, relative } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    try {
      await writeFile(join(dir, 'oauth-private.key'), 'PRIV')
      // public file intentionally missing
      const rel = relative(process.cwd(), dir)
      Passport.loadKeysFrom(rel)
      assert.equal(await Passport.keysAvailable(), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
      Passport.reset()
    }
  })
})

describe('scopeAny() — E13 OR-semantic scope guard', () => {
  /**
   * Mirrors how BearerMiddleware stamps scopes on the request: the guard
   * only reads `req.raw.__passport_scopes`, calls `res.status().json()`, and
   * either invokes `next()` or short-circuits. A hand-rolled stub is enough
   * to exercise every branch.
   */
  function makeReq(tokenScopes: string[] | undefined) {
    const raw: Record<string, unknown> = {}
    if (tokenScopes) raw['__passport_scopes'] = tokenScopes
    return { raw } as any
  }

  function makeRes() {
    let statusCode: number | undefined
    let body: unknown
    const res: any = {
      status(code: number) { statusCode = code; return res },
      json(payload: unknown) { body = payload; return res },
    }
    return {
      res,
      get statusCode() { return statusCode },
      get body() { return body },
    }
  }

  test('passes through when token has at least one of the listed scopes', async () => {
    const mw = scopeAny('orders:read', 'orders:write')
    const { res, statusCode } = makeRes()
    let nextCalled = false
    await mw(makeReq(['orders:read']), res, async () => { nextCalled = true })
    assert.equal(nextCalled, true)
    assert.equal(statusCode, undefined, 'should not respond — should fall through to next()')
  })

  test('passes through when wildcard "*" is granted regardless of listed scopes', async () => {
    const mw = scopeAny('admin', 'super')
    const { res } = makeRes()
    let nextCalled = false
    await mw(makeReq(['*']), res, async () => { nextCalled = true })
    assert.equal(nextCalled, true)
  })

  test('responds 403 insufficient_scope when token has none of the listed scopes', async () => {
    const mw = scopeAny('orders:read', 'orders:write')
    const captured = makeRes()
    let nextCalled = false
    await mw(makeReq(['profile:read']), captured.res, async () => { nextCalled = true })
    assert.equal(nextCalled, false)
    assert.equal(captured.statusCode, 403)
    assert.equal((captured.body as any).error, 'insufficient_scope')
    assert.deepEqual((captured.body as any).required, ['orders:read', 'orders:write'])
    assert.match((captured.body as any).message, /at least one of/)
  })

  test('responds 403 when no token scopes are present on the request', async () => {
    const mw = scopeAny('orders:read')
    const captured = makeRes()
    let nextCalled = false
    await mw(makeReq(undefined), captured.res, async () => { nextCalled = true })
    assert.equal(nextCalled, false)
    assert.equal(captured.statusCode, 403)
    assert.equal((captured.body as any).error, 'insufficient_scope')
  })

  test('zero-arg call is a no-op safety net (does not 403 on empty list)', async () => {
    // Mirrors Laravel's tolerant behavior — scopeAny() with no scopes
    // shouldn't permanently lock the route. AND-style scope() has the same
    // property because its `missing` filter is empty.
    const mw = scopeAny()
    const { res } = makeRes()
    let nextCalled = false
    await mw(makeReq(['anything']), res, async () => { nextCalled = true })
    assert.equal(nextCalled, true)
  })
})

describe('client-secret hashing (L6) — APP_KEY pepper + back-compat', () => {
  // The hash format is selected at write time based on `process.env.APP_KEY`.
  // Save/restore it around each test so tests don't bleed state and so we
  // can assert both code paths (peppered + plain SHA-256) deterministically.
  const ORIGINAL_APP_KEY = process.env['APP_KEY']

  function setAppKey(value: string | undefined): void {
    if (value === undefined) delete process.env['APP_KEY']
    else process.env['APP_KEY'] = value
  }

  test('hashClientSecret — uses HMAC-SHA256 pepper when APP_KEY is set', async () => {
    setAppKey('test-pepper-1')
    const hashed = await hashClientSecret('s3cret')
    assert.ok(hashed.startsWith('peppered:'), `expected peppered: prefix, got ${hashed}`)
    // hex-encoded HMAC-SHA256 is 64 chars after the prefix
    assert.equal(hashed.slice('peppered:'.length).length, 64)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('hashClientSecret — falls back to plain SHA-256 when APP_KEY is unset', async () => {
    setAppKey(undefined)
    const hashed = await hashClientSecret('s3cret')
    // Plain hex SHA-256 — no prefix, exactly 64 chars
    assert.equal(hashed.length, 64)
    assert.ok(!hashed.startsWith('peppered:'))
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update('s3cret').digest('hex')
    assert.equal(hashed, expected)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('hashClientSecret — different APP_KEYs produce different ciphertexts', async () => {
    setAppKey('pepper-A')
    const a = await hashClientSecret('same-input')
    setAppKey('pepper-B')
    const b = await hashClientSecret('same-input')
    assert.notEqual(a, b)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash verifies under matching APP_KEY', async () => {
    setAppKey('pepper-X')
    const hashed = await hashClientSecret('s3cret')
    assert.equal(await verifyClientSecret('s3cret', hashed), true)
    assert.equal(await verifyClientSecret('wrong', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash rejects under different APP_KEY (rotation invalidates)', async () => {
    setAppKey('pepper-old')
    const hashed = await hashClientSecret('s3cret')
    setAppKey('pepper-new')
    assert.equal(await verifyClientSecret('s3cret', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash rejects when APP_KEY becomes unset', async () => {
    setAppKey('pepper-Y')
    const hashed = await hashClientSecret('s3cret')
    setAppKey(undefined)
    // Without the pepper we can't reproduce the HMAC, so verification must
    // fail closed (an attacker who sees a peppered row can't bypass the
    // check by clearing APP_KEY in the environment).
    assert.equal(await verifyClientSecret('s3cret', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — legacy plain SHA-256 row keeps verifying after APP_KEY is set', async () => {
    // Existing rows minted before the pepper rolled out are bare hex digests.
    // They MUST keep verifying once APP_KEY is configured — otherwise every
    // existing OAuth client breaks the moment the operator sets APP_KEY.
    const { createHash } = await import('node:crypto')
    const legacyHash = createHash('sha256').update('s3cret').digest('hex')
    setAppKey('newly-configured-pepper')
    assert.equal(await verifyClientSecret('s3cret', legacyHash), true)
    assert.equal(await verifyClientSecret('wrong', legacyHash), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — null/empty stored value rejects', async () => {
    assert.equal(await verifyClientSecret('any', null), false)
    assert.equal(await verifyClientSecret('any', undefined), false)
    assert.equal(await verifyClientSecret('any', ''), false)
  })

  test('client_credentials grant — accepts peppered secret end-to-end', async () => {
    // End-to-end: createClient writes a peppered hash; clientCredentialsGrant
    // reads the row and must verify successfully under the same APP_KEY.
    setAppKey('e2e-pepper')
    Passport.reset()

    // Generate ephemeral RSA keypair so issueTokens succeeds (cached at
    // describe scope would be cleaner; this grant runs once so inline is fine)
    const { generateKeyPairSync } = await import('node:crypto')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    Passport.setKeys(privateKey, publicKey)

    const peppered = await hashClientSecret('plain-secret-value')

    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id: 'C-1', name: 'app',
            secret: peppered, confidential: true, revoked: false,
            redirectUris: '[]',
            grantTypes: '["client_credentials"]',
            scopes: '[]',
          }),
        }
      }
    }
    class FakeAccessToken {
      static async create(record: any) { return { id: record.id ?? 'A-1', ...record } }
    }
    Passport.useClientModel(FakeClient as any)
    Passport.useTokenModel(FakeAccessToken as any)

    const tokens = await clientCredentialsGrant({
      grantType:    'client_credentials',
      clientId:     'C-1',
      clientSecret: 'plain-secret-value',
    })
    assert.ok(tokens.access_token)

    // Wrong secret still rejects
    await assert.rejects(
      () => clientCredentialsGrant({
        grantType:    'client_credentials',
        clientId:     'C-1',
        clientSecret: 'wrong-secret',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client',
    )

    Passport.reset()
    setAppKey(ORIGINAL_APP_KEY)
  })
})

describe('M-L3 — token models implement Prunable for `model:prune`', () => {
  // `pruneModels` (in @rudderjs/orm) walks `ModelRegistry`, picks classes
  // that expose `static prunable()`, and calls
  // `ModelClass.prunable().limit(chunk).deleteAll()` (mass mode) or per-row
  // delete (instance mode). These tests verify each passport token model
  // exposes the expected predicate + mode without depending on a real DB.

  /**
   * Subclass each model and override `static query()` to capture the chained
   * `where`/`orWhere` calls. `prunable()` calls `this.query()`, so a static
   * override is enough — we don't need to monkey-patch the base class.
   */
  function captureChain<T extends { prunable(): any }>(Cls: T): {
    wheres: Array<[string, string, unknown]>
  } {
    const wheres: Array<[string, string, unknown]> = []
    const builder: any = {
      where(col: string, op: string, val?: unknown) {
        if (arguments.length === 2) wheres.push([col, '=', op])
        else                        wheres.push([col, op, val])
        return builder
      },
      orWhere(col: string, op: string, val?: unknown) {
        if (arguments.length === 2) wheres.push(['OR:'+col, '=', op])
        else                        wheres.push(['OR:'+col, op, val])
        return builder
      },
    }
    ;(Cls as any).query = () => builder
    Cls.prunable()
    return { wheres }
  }

  test('AccessToken — pruneMode mass + expiresAt < now OR revoked = true', () => {
    class FakeAccess extends AccessToken {}
    assert.equal((FakeAccess as any).pruneMode, 'mass')
    assert.equal(typeof (FakeAccess as any).prunable, 'function')

    const { wheres } = captureChain(FakeAccess)
    assert.equal(wheres.length, 2)
    assert.equal(wheres[0]?.[0], 'expiresAt')
    assert.equal(wheres[0]?.[1], '<')
    assert.ok(wheres[0]?.[2] instanceof Date)
    assert.deepEqual(wheres[1], ['OR:revoked', '=', true])
  })

  test('RefreshToken — pruneMode mass + expiresAt < now OR revoked = true', () => {
    class FakeRefresh extends RefreshToken {}
    assert.equal((FakeRefresh as any).pruneMode, 'mass')
    assert.equal(typeof (FakeRefresh as any).prunable, 'function')

    const { wheres } = captureChain(FakeRefresh)
    assert.equal(wheres.length, 2)
    assert.equal(wheres[0]?.[0], 'expiresAt')
    assert.equal(wheres[0]?.[1], '<')
    assert.ok(wheres[0]?.[2] instanceof Date)
    assert.deepEqual(wheres[1], ['OR:revoked', '=', true])
  })

  test('AuthCode — pruneMode mass + expiresAt < now only', () => {
    // Auth codes are single-use and revoked on exchange, but we keep
    // revoked-but-unexpired rows for the natural 10-minute TTL window so
    // replay-detection traces survive long enough to be useful. Mirrors
    // `passport:purge`.
    class FakeAuth extends AuthCode {}
    assert.equal((FakeAuth as any).pruneMode, 'mass')

    const { wheres } = captureChain(FakeAuth)
    assert.equal(wheres.length, 1)
    assert.equal(wheres[0]?.[0], 'expiresAt')
    assert.equal(wheres[0]?.[1], '<')
    assert.ok(wheres[0]?.[2] instanceof Date)
  })

  test('DeviceCode — pruneMode mass + expiresAt < now only', () => {
    class FakeDevice extends DeviceCode {}
    assert.equal((FakeDevice as any).pruneMode, 'mass')

    const { wheres } = captureChain(FakeDevice)
    assert.equal(wheres.length, 1)
    assert.equal(wheres[0]?.[0], 'expiresAt')
    assert.equal(wheres[0]?.[1], '<')
    assert.ok(wheres[0]?.[2] instanceof Date)
  })

  test('predicates match `passport:purge` exactly — no double-counting risk', async () => {
    // If the operator runs `passport:purge` and `model:prune` back-to-back
    // (e.g. cron + scheduled task), both must target the same rows so the
    // second call is a cheap no-op. Exercise both paths against the same
    // fake model and verify the where chains line up byte-for-byte.
    Passport.reset()
    const purgeChain: Array<[string, string, unknown]> = []
    const pruneChain: Array<[string, string, unknown]> = []

    function recorder(target: Array<[string, string, unknown]>) {
      const builder: any = {
        where(col: string, op: string, val?: unknown) {
          if (arguments.length === 2) target.push([col, '=', op])
          else                        target.push([col, op, val])
          return builder
        },
        orWhere(col: string, op: string, val?: unknown) {
          if (arguments.length === 2) target.push(['OR:'+col, '=', op])
          else                        target.push(['OR:'+col, op, val])
          return builder
        },
        async deleteAll() { return 0 },
      }
      return builder
    }

    class CapturePurge {
      static query() { return recorder(purgeChain) }
    }
    Passport.useTokenModel(CapturePurge as any)
    Passport.useRefreshTokenModel(class { static query() { return recorder([]) } } as any)
    Passport.useAuthCodeModel(class    { static query() { return recorder([]) } } as any)
    Passport.useDeviceCodeModel(class  { static query() { return recorder([]) } } as any)
    await purgeTokens()

    class CapturePrune extends AccessToken {
      static override query() { return recorder(pruneChain) as any }
    }
    CapturePrune.prunable()

    // Strip the Date payloads (timestamps differ by ms between the two calls);
    // shape and constants are what matter for the contract.
    const shape = (chain: Array<[string, string, unknown]>) =>
      chain.map(([col, op, val]) => [col, op, val instanceof Date ? '<DATE>' : val])
    assert.deepEqual(shape(pruneChain), shape(purgeChain))

    Passport.reset()
  })
})

describe('storage hygiene — fillable / hidden / casts / null guards', () => {
  // ── M-L6: `revoked` is NOT in fillable ────────────────────────

  test('M-L6 — `revoked` is not in fillable on AccessToken/RefreshToken/AuthCode', () => {
    // Mass-assignment must NOT let a caller-controlled payload pre-mark a
    // token as revoked. Lifecycle flips happen through `revoke()`,
    // `forceFill`, or QueryBuilder.updateAll.
    assert.ok(!(AccessToken.fillable as readonly string[]).includes('revoked'),
      'AccessToken.fillable still contains "revoked"')
    assert.ok(!(RefreshToken.fillable as readonly string[]).includes('revoked'),
      'RefreshToken.fillable still contains "revoked"')
    assert.ok(!(AuthCode.fillable as readonly string[]).includes('revoked'),
      'AuthCode.fillable still contains "revoked"')
  })

  // ── M-L1: revoke() uses save() ─────────────────────────────────

  test('M-L1 — AccessToken.revoke() goes through save() and bypasses mass-assignment', async () => {
    // Direct property assignment + save() bypasses the fillable filter,
    // and the in-memory instance reflects the new state without a re-read.
    // We capture the save() call to verify the call shape.
    let saveCalled = false
    let revokedAtSave: unknown = null
    class FakeAdapter {
      static async save(this: any) {
        saveCalled = true
        revokedAtSave = this.revoked
        return this
      }
    }

    // Instantiate via Model.hydrate so the prototype method `save` resolves
    // through the adapter; we override it on the instance for capture.
    const token = AccessToken.hydrate({
      id: 'A-1', userId: 'U-1', clientId: 'C-1', name: null,
      scopes: '[]', revoked: false, expiresAt: new Date(),
    } as Record<string, unknown>) as AccessToken
    ;(token as any).save = FakeAdapter.save.bind(token)

    await token.revoke()

    assert.equal(saveCalled, true, 'expected revoke() to call save()')
    assert.equal(revokedAtSave, true, 'expected revoked=true on save()')
    assert.equal(token.revoked, true, 'expected in-memory instance.revoked === true')
  })

  test('M-L1 — RefreshToken.revoke() goes through save()', async () => {
    let saveCalled = false
    const token = RefreshToken.hydrate({
      id: 'R-1', accessTokenId: 'A-1', familyId: null,
      revoked: false, expiresAt: new Date(),
    } as Record<string, unknown>) as RefreshToken
    ;(token as any).save = async function(this: any) { saveCalled = true; return this }

    await token.revoke()
    assert.equal(saveCalled, true)
    assert.equal(token.revoked, true)
  })

  // ── M-L5: @Cast('json') on OAuthClient JSON columns ───────────

  test('M-L5 — OAuthClient declares JSON casts on redirectUris/grantTypes/scopes', () => {
    // The decorator stamps the cast onto the class's static `casts` map.
    const casts = (OAuthClient as any).casts as Record<string, string> | undefined
    assert.ok(casts, 'OAuthClient.casts not defined — @Cast decorator did not run')
    assert.equal(casts['redirectUris'], 'json')
    assert.equal(casts['grantTypes'],   'json')
    assert.equal(casts['scopes'],       'json')
  })

  test('M-L5 — write callsites passing JSON.stringify still round-trip (no double-encoding)', () => {
    // `castSet('json', ..., stringValue)` returns the string verbatim — only
    // arrays/objects get re-stringified. This protects every existing
    // `JSON.stringify([...])` callsite from double-encoding after the cast
    // is added.
    const client = OAuthClient.hydrate({
      id: 'C-1', name: 'app',
      redirectUris: '["https://app.example.com/cb"]',
      grantTypes:   '["authorization_code"]',
      scopes:       '[]',
      confidential: true, revoked: false, secret: null,
    } as Record<string, unknown>) as OAuthClient

    // After hydration, the cast on read should produce arrays.
    assert.deepEqual(client.getRedirectUris(), ['https://app.example.com/cb'])
    assert.deepEqual(client.getGrantTypes(),   ['authorization_code'])
    assert.deepEqual(client.getScopes(),       [])
  })

  // ── M1: @Hidden on AccessToken.userId/clientId ────────────────

  test('M1 — AccessToken.toJSON() hides userId and clientId by default', () => {
    const token = AccessToken.hydrate({
      id: 'A-1', userId: 'U-1', clientId: 'C-1', name: 'cli',
      scopes: '[]', revoked: false, expiresAt: new Date(),
    } as Record<string, unknown>) as AccessToken
    const json = token.toJSON() as Record<string, unknown>
    assert.equal(json['userId'],   undefined, 'userId leaked into toJSON()')
    assert.equal(json['clientId'], undefined, 'clientId leaked into toJSON()')
    assert.equal(json['id'],       'A-1')
    assert.equal(json['name'],     'cli')
  })

  test('M1 — makeVisible() opts userId/clientId back into serialization for admin contexts', () => {
    const token = AccessToken.hydrate({
      id: 'A-1', userId: 'U-1', clientId: 'C-1', name: null,
      scopes: '[]', revoked: false, expiresAt: new Date(),
    } as Record<string, unknown>) as AccessToken
    const json = (token as any).makeVisible(['userId', 'clientId']).toJSON() as Record<string, unknown>
    assert.equal(json['userId'],   'U-1')
    assert.equal(json['clientId'], 'C-1')
  })

  // ── M6: explicit null-secret guard ────────────────────────────

  test('M6 — client_credentials grant rejects null `client.secret` on a confidential client', async () => {
    Passport.reset()
    class FakeClientNullSecret {
      static where() {
        return {
          first: async () => ({
            id: 'C-1', name: 'app',
            secret: null, // explicit null — schema permits it for non-confidential rows
            confidential: true, revoked: false,
            redirectUris: '[]',
            grantTypes:   '["client_credentials"]',
            scopes:       '[]',
          }),
        }
      }
    }
    Passport.useClientModel(FakeClientNullSecret as any)

    await assert.rejects(
      () => clientCredentialsGrant({
        grantType:    'client_credentials',
        clientId:     'C-1',
        clientSecret: 'anything',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client'
        && /no secret on file/i.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('M6 — refresh_token grant rejects null `client.secret` on a confidential client', async () => {
    Passport.reset()
    class FakeClientNullSecret {
      static where() {
        return {
          first: async () => ({
            id: 'C-1', name: 'app',
            secret: null,
            confidential: true, revoked: false,
            redirectUris: '[]',
            grantTypes:   '["refresh_token"]',
            scopes:       '[]',
          }),
        }
      }
    }
    Passport.useClientModel(FakeClientNullSecret as any)

    await assert.rejects(
      () => refreshTokenGrant({
        grantType:    'refresh_token',
        refreshToken: 'rt-1',
        clientId:     'C-1',
        clientSecret: 'anything',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client'
        && /no secret on file/i.test(e.errorDescription),
    )
    Passport.reset()
  })

  // ── M-L4: parseJsonArray logs on corrupt input ────────────────

  test('M-L4 — clientHelpers.getScopes warns and returns [] on corrupt JSON', async () => {
    // Direct exercise of the helper that DOES go through parseJsonArray.
    const { clientHelpers } = await import('./models/helpers.js')
    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (msg: string) => { warnings.push(String(msg)) }
    try {
      const result = clientHelpers.getScopes({
        id: 'C-1', name: 'x', secret: null,
        redirectUris: '[]', grantTypes: '[]', scopes: 'not-json-{',
        confidential: false, revoked: false,
      } as any)
      assert.deepEqual(result, [])
    } finally {
      console.warn = originalWarn
    }
    assert.ok(warnings.length >= 1, 'expected at least one console.warn call')
    assert.ok(/Failed to parse JSON-array/.test(warnings[0] ?? ''),
      `expected helpful warning, got: ${warnings[0]}`)
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
    const d = DeviceCode.hydrate({ id: 'D-1', clientId: 'C-1', userCode: 'X', deviceCode: 'Y', userId: null, approved: null, expiresAt: new Date(), lastPolledAt: null } as any) as DeviceCode
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

