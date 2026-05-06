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
    class FakeAccessToken {
      static updates = updates
      static where(_col: string, val: unknown) {
        return { first: async () => (rows[val as string] ?? null) as any }
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
    class FakeRefreshToken {
      static updates = updates
      static created = created
      static where(col: string, val: unknown) {
        if (col === 'id') {
          return {
            first: async () => (rows[val as string] ?? null) as any,
            get:   async () => [],
          }
        }
        if (col === 'familyId') {
          return {
            get: async () => Object.values(rows).filter(r => r['familyId'] === val) as any,
          }
        }
        return { first: async () => null, get: async () => [] }
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
    class FakeAccessToken {
      static where(col: string, val: unknown) {
        return { first: async () => (col === 'id' ? (accessRows[val as string] ?? null) : null) as any }
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

