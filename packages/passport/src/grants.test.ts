// Grant flows: refresh-token reuse-chain revocation, HTTP Basic client
// auth, scope validation/registry, and scopeAny OR-semantics.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  Passport,
  scopeAny,
  validateAuthorizationRequest,
  validateScopes,
  OAuthError,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  registerPassportRoutes,
} from './index.js'

describe('refresh-token reuse-chain revocation (P4)', () => {
  // Regression guard for P4 / M(H4) from the passport-surface review:
  // RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP §4.14 — when a previously
  // rotated refresh token is presented again, revoke the entire family
  // (every access + refresh token issued through the same rotation chain).
  // Legacy rows minted before the familyId column existed are exempt
  // during the migration window — same approach as redirect_uri (P1/E4).
  //
  // Post-M5/P6 (#TBD): refresh tokens are looked up by SHA-256 of the
  // presented plaintext, not by row id. Tests below pass the row's id
  // string as the plaintext for readability and stamp `tokenHash` onto
  // each row to match. The grant's hashing path is exercised end-to-end.

  // Synchronous SHA-256 hex helper for setting up `tokenHash` on test rows.
  // The grant's `hashOpaqueToken` lazy-loads node:crypto for non-Node runtime
  // safety; here we import it statically and mirror the same digest.
  function sync256Hex(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex')
  }

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
      'RT-1': { id: 'RT-1', tokenHash: sync256Hex('RT-1'), accessTokenId: 'AT-1', familyId: 'FAM-1', revoked: false, expiresAt: new Date(Date.now() + 600_000) },
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
      'RT-OLD':  { id: 'RT-OLD',  tokenHash: sync256Hex('RT-OLD'),  accessTokenId: 'AT-OLD',  familyId: 'FAM-X', revoked: true,  expiresAt: new Date(Date.now() + 600_000) },
      'RT-LIVE': { id: 'RT-LIVE', tokenHash: sync256Hex('RT-LIVE'), accessTokenId: 'AT-LIVE', familyId: 'FAM-X', revoked: false, expiresAt: new Date(Date.now() + 600_000) },
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
      'RT-LEGACY':   { id: 'RT-LEGACY',   tokenHash: sync256Hex('RT-LEGACY'),   accessTokenId: 'AT-LEGACY',   familyId: null, revoked: true,  expiresAt: new Date(Date.now() + 600_000) },
      'RT-UNRELATED':{ id: 'RT-UNRELATED',tokenHash: sync256Hex('RT-UNRELATED'),accessTokenId: 'AT-UNRELATED',familyId: null, revoked: false, expiresAt: new Date(Date.now() + 600_000) },
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

  test('concurrent refreshes of the same token — only one wins; the loser revokes the family', async () => {
    // Race regression: previously, refreshTokenGrant read the row, checked
    // `revoked === false`, then unconditionally flipped revoked=true. Two
    // concurrent calls both passed the read-time check and both issued new
    // pairs. The fix is an atomic conditional update — only one of N
    // concurrent calls flips false→true; the rest see count=0 and trip the
    // family-revocation path.
    Passport.reset()
    await ensureTestKeys()
    Passport.useClientModel(fakeClient({
      id: 'C-1', name: 'app', secret: null, confidential: false,
      redirectUris: '[]', grantTypes: '["authorization_code"]', scopes: '[]', revoked: false,
    }))
    const accessRows: Record<string, Record<string, unknown>> = {
      'AT-1': { id: 'AT-1', userId: 'U-1', clientId: 'C-1', scopes: '["read"]', revoked: false, expiresAt: new Date(Date.now() + 60_000) },
    }
    Passport.useTokenModel(fakeAccessTokenForIssue('AT-1', accessRows))
    const refreshRows: Record<string, Record<string, unknown>> = {
      'RT-RACE': { id: 'RT-RACE', tokenHash: sync256Hex('RT-RACE'), accessTokenId: 'AT-1', familyId: 'FAM-R', revoked: false, expiresAt: new Date(Date.now() + 600_000) },
    }
    const FakeRefresh = fakeRefreshToken(refreshRows)
    Passport.useRefreshTokenModel(FakeRefresh)

    // Two concurrent grants — neither pre-await the other.
    const results = await Promise.allSettled([
      refreshTokenGrant({ grantType: 'refresh_token', refreshToken: 'RT-RACE', clientId: 'C-1' }),
      refreshTokenGrant({ grantType: 'refresh_token', refreshToken: 'RT-RACE', clientId: 'C-1' }),
    ])

    const winners = results.filter(r => r.status === 'fulfilled')
    const losers  = results.filter(r => r.status === 'rejected')
    assert.equal(winners.length, 1, 'exactly one concurrent refresh should succeed')
    assert.equal(losers.length,  1, 'the other must reject with invalid_grant')
    const rejected = losers[0] as PromiseRejectedResult
    assert.ok(rejected.reason instanceof OAuthError && rejected.reason.error === 'invalid_grant')

    // The atomic claim flipped revoked=true on the original row; the loser
    // saw count=0 and triggered the family-revocation path. Net effect:
    // only one new pair minted, family marked compromised.
    assert.equal(refreshRows['RT-RACE']!.revoked, true, 'original refresh token must be revoked')
    assert.equal(FakeRefresh.created.length, 1, 'exactly one new refresh token created (no double-mint)')

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

  test('per-client gate — wildcard "*" does NOT bypass a non-empty client allow-list', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read' })
    // A client restricted to ['read'] must not escalate to all-scopes by
    // requesting '*' — it isn't in the allow-list, so it's rejected.
    assert.throws(
      () => validateScopes(clientWith(['read']), ['*']),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_scope' && /not authorized for this client/.test(e.errorDescription),
    )
    Passport.reset()
  })

  test('per-client gate — wildcard "*" is granted only when the client allow-list contains it', () => {
    Passport.reset()
    Passport.tokensCan({ read: 'Read' })
    assert.doesNotThrow(() => validateScopes(clientWith(['*']), ['*']))
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

