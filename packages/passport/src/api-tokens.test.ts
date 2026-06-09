// Personal-access tokens (HasApiTokens), token pruning/purging, storage
// hygiene, and refresh/auth-code at-rest hashing (M5 + P6).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  Passport,
  OAuthClient,
  AccessToken,
  RefreshToken,
  AuthCode,
  DeviceCode,
  purgeTokens,
  issueTokens,
  issueAuthCode,
  exchangeAuthCode,
  OAuthError,
  clientCredentialsGrant,
  refreshTokenGrant,
  HasApiTokens,
  resetPersonalAccessClient,
} from './index.js'

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

describe('oauth_refresh_tokens + oauth_auth_codes hashing (M5 + P6)', () => {
  // Regression guard for M5 / second half of P6 from
  // docs/plans/2026-05-06-passport-surface-review-fixes.md.
  //
  // Refresh tokens and auth codes are now stored as SHA-256(`tokenHash`)
  // of fresh CSPRNG plaintext — the row's `id` is no longer the bearer
  // secret. A DB read leak yields hashes, not usable credentials. Lookups
  // hash before query.

  function sha256Hex(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex')
  }

  // Lazily-initialised RSA test keys — issueTokens signs a JWT, so any
  // round-trip test needs real keys.
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

  // ── Refresh tokens ───────────────────────────────────────

  test('M5 — issueTokens persists tokenHash, returns plaintext distinct from row id', async () => {
    Passport.reset()
    await ensureTestKeys()

    const accessRows: Record<string, Record<string, unknown>> = {}
    class FakeAccess {
      static async create(data: Record<string, unknown>) {
        const id = 'AT-NEW-1'
        accessRows[id] = { ...data, id }
        return { ...data, id } as any
      }
    }

    let persistedRefresh: Record<string, unknown> | null = null
    let nextRefreshId = 0
    class FakeRefresh {
      static async create(data: Record<string, unknown>) {
        nextRefreshId++
        persistedRefresh = { ...data, id: `RT-${nextRefreshId}` }
        return persistedRefresh as any
      }
    }

    Passport.useTokenModel(FakeAccess as any)
    Passport.useRefreshTokenModel(FakeRefresh as any)

    const tokens = await issueTokens({
      userId:         'U-1',
      clientId:       'C-1',
      scopes:         ['read'],
      includeRefresh: true,
    })

    // Plaintext returned to the client — base64url, 64 chars (48 random bytes).
    assert.ok(tokens.refresh_token)
    assert.equal(typeof tokens.refresh_token, 'string')
    assert.match(tokens.refresh_token!, /^[A-Za-z0-9_-]+$/, 'refresh token must be base64url')
    assert.ok(tokens.refresh_token!.length >= 60)

    // Persisted row carries the hash, not the plaintext, and is NOT the row id.
    assert.ok(persistedRefresh)
    assert.equal(persistedRefresh!['tokenHash'], sha256Hex(tokens.refresh_token!))
    assert.notEqual(persistedRefresh!['tokenHash'], tokens.refresh_token)
    assert.notEqual(persistedRefresh!['id'], tokens.refresh_token,
      'plaintext must not equal the row id (was the pre-M5/P6 bug)')

    Passport.reset()
  })

  test('M5 — refreshTokenGrant looks up by SHA-256 of the presented plaintext, not raw value', async () => {
    Passport.reset()
    Passport.useClientModel((() => {
      class FakeClient {
        static where(_col: string, _val: unknown) {
          return { first: async () => ({ id: 'C-1', confidential: false, revoked: false }) as any }
        }
      }
      return FakeClient as any
    })())

    const seenLookups: Array<{ col: string; val: unknown }> = []
    class CapturingRefresh {
      static where(col: string, val: unknown) {
        seenLookups.push({ col, val })
        return { first: async () => null } // not-found short-circuits the rest
      }
    }
    Passport.useRefreshTokenModel(CapturingRefresh as any)

    await assert.rejects(() => refreshTokenGrant({
      grantType:    'refresh_token',
      refreshToken: 'plaintext-rt',
      clientId:     'C-1',
    }))

    assert.equal(seenLookups.length, 1)
    assert.equal(seenLookups[0]!.col, 'tokenHash')
    assert.equal(seenLookups[0]!.val, sha256Hex('plaintext-rt'))
    assert.notEqual(seenLookups[0]!.val, 'plaintext-rt')

    Passport.reset()
  })

  test('M5 — wrong plaintext returns invalid_grant (cannot brute-force via row id)', async () => {
    Passport.reset()
    Passport.useClientModel((() => {
      class FakeClient {
        static where(_col: string, _val: unknown) {
          return { first: async () => ({ id: 'C-1', confidential: false, revoked: false }) as any }
        }
      }
      return FakeClient as any
    })())

    // Row exists with a known tokenHash. Caller presents the row id, not
    // the plaintext — pre-M5/P6 this would have succeeded.
    class FakeRefresh {
      static where(col: string, val: unknown) {
        return {
          first: async () => {
            if (col === 'tokenHash' && val === sha256Hex('SECRET-PLAIN')) {
              return { id: 'RT-X', tokenHash: sha256Hex('SECRET-PLAIN'), accessTokenId: 'AT-X', familyId: null, revoked: false, expiresAt: new Date(Date.now() + 600_000) } as any
            }
            return null
          },
        }
      }
    }
    Passport.useRefreshTokenModel(FakeRefresh as any)

    await assert.rejects(
      () => refreshTokenGrant({ grantType: 'refresh_token', refreshToken: 'RT-X', clientId: 'C-1' }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant',
    )

    Passport.reset()
  })

  // ── Auth codes ────────────────────────────────────────────

  test('P6 — issueAuthCode returns plaintext distinct from row id, persists tokenHash', async () => {
    Passport.reset()

    let persisted: Record<string, unknown> | null = null
    let createdId: string | null = null
    class CapturingAuthCode {
      static async create(data: Record<string, unknown>) {
        createdId = 'AC-NEW-1'
        persisted = { ...data, id: createdId }
        return persisted as any
      }
    }
    Passport.useAuthCodeModel(CapturingAuthCode as any)

    const code = await issueAuthCode({
      userId:    'U-1',
      clientId:  'C-1',
      scopes:    ['read'],
      redirectUri: 'https://app.example.com/cb',
    })

    assert.equal(typeof code, 'string')
    assert.match(code, /^[A-Za-z0-9_-]+$/, 'auth code must be base64url')
    assert.ok(code.length >= 60)

    assert.ok(persisted)
    assert.equal(persisted!['tokenHash'], sha256Hex(code))
    assert.notEqual(persisted!['tokenHash'], code)
    assert.notEqual(persisted!['id'], code,
      'plaintext must not equal the row id (was the pre-M5/P6 bug)')

    Passport.reset()
  })

  test('P6 — exchangeAuthCode looks up by SHA-256 of the presented plaintext', async () => {
    Passport.reset()
    Passport.useClientModel((() => {
      class FakeClient {
        static where(_col: string, _val: unknown) {
          return { first: async () => ({ id: 'C-1', confidential: false, revoked: false }) as any }
        }
      }
      return FakeClient as any
    })())

    const seenLookups: Array<{ col: string; val: unknown }> = []
    class CapturingAuthCode {
      static where(col: string, val: unknown) {
        seenLookups.push({ col, val })
        return { first: async () => null } // miss → invalid_grant
      }
    }
    Passport.useAuthCodeModel(CapturingAuthCode as any)

    await assert.rejects(() => exchangeAuthCode({
      grantType:   'authorization_code',
      code:        'plaintext-code',
      clientId:    'C-1',
      redirectUri: 'https://app.example.com/cb',
    }))

    assert.equal(seenLookups.length, 1)
    assert.equal(seenLookups[0]!.col, 'tokenHash')
    assert.equal(seenLookups[0]!.val, sha256Hex('plaintext-code'))

    Passport.reset()
  })

  test('P6 — atomic single-use consume (M3) still fires on hashed lookup', async () => {
    // Regression guard: the conditional-update path (M3) keys on the row's
    // hydrated `id`, NOT the plaintext. Two concurrent exchanges must still
    // produce one success + one `invalid_grant` even after the lookup column
    // changed.
    Passport.reset()
    await ensureTestKeys()
    Passport.useClientModel((() => {
      class FakeClient {
        static where(_col: string, _val: unknown) {
          return { first: async () => ({ id: 'C-1', confidential: false, revoked: false }) as any }
        }
      }
      return FakeClient as any
    })())

    const codePlaintext = 'plain-ac-1'
    let consumed = false
    class FakeAuthCode {
      static where(col: string, val: unknown) {
        const builder: any = {
          first: async () => {
            if (col === 'tokenHash' && val === sha256Hex(codePlaintext)) {
              return {
                id:                  'AC-1',
                tokenHash:           sha256Hex(codePlaintext),
                userId:              'U-1',
                clientId:            'C-1',
                scopes:              '["read"]',
                revoked:             false,
                expiresAt:           new Date(Date.now() + 60_000),
                redirectUri:         'https://app.example.com/cb',
                codeChallenge:       null,
                codeChallengeMethod: null,
              } as any
            }
            return null
          },
          where(_col: string, _opOrVal: unknown, _maybeVal?: unknown) { return builder },
          async updateAll(_data: Record<string, unknown>) {
            // First caller flips revoked → 1; second sees 0.
            if (consumed) return 0
            consumed = true
            return 1
          },
        }
        return builder
      }
    }
    Passport.useAuthCodeModel(FakeAuthCode as any)

    const accessRows: Record<string, Record<string, unknown>> = {}
    class FakeAccess {
      static async create(data: Record<string, unknown>) {
        const id = 'AT-1'
        accessRows[id] = { ...data, id }
        return { ...data, id } as any
      }
    }
    class FakeRefresh {
      static async create(data: Record<string, unknown>) {
        return { ...data, id: 'RT-1' } as any
      }
    }
    Passport.useTokenModel(FakeAccess as any)
    Passport.useRefreshTokenModel(FakeRefresh as any)

    // First exchange — succeeds.
    const tokens = await exchangeAuthCode({
      grantType:   'authorization_code',
      code:        codePlaintext,
      clientId:    'C-1',
      redirectUri: 'https://app.example.com/cb',
    })
    assert.ok(tokens.access_token)

    // Second exchange — atomic consume returns 0, surfaces invalid_grant.
    await assert.rejects(
      () => exchangeAuthCode({
        grantType:   'authorization_code',
        code:        codePlaintext,
        clientId:    'C-1',
        redirectUri: 'https://app.example.com/cb',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant' && /already been used/.test(e.errorDescription),
    )

    Passport.reset()
  })
})

