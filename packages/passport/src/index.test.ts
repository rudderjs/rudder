import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  PassportProvider,
  createToken,
  verifyToken,
  decodeToken,
  OAuthClient,
  AccessToken,
  RefreshToken,
  AuthCode,
  DeviceCode,
  BearerMiddleware,
  RequireBearer,
  scope,
  generateKeys,
  createClient,
  purgeTokens,
  issueTokens,
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
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
    assert.equal(typeof decodeToken, 'function')
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

