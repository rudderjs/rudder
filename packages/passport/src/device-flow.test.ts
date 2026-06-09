// Device-authorization flow: device-code hashing, slow_down interval
// escalation + cap, and the concurrent-polling race.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  hashDeviceSecret,
  DeviceCode,
  issueTokens,
  OAuthError,
  requestDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
  registerPassportRoutes,
} from './index.js'

describe('oauth_device_codes hashing + interval escalation (P9 + M4)', () => {
  // Regression guards for P9 + M4 from the findings doc. Bundled because
  // they share the same Prisma migration on `oauth_device_codes`.
  //   M4 — deviceCode/userCode hashed at rest; lookups hash before query.
  //   P9 — `interval` column escalates by 5s on slow_down (capped at 60).

  /**
   * Build a fake DeviceCode model that:
   *   - records every where()/update()/create() call so tests can assert
   *     the mixin hashed the input before lookup,
   *   - returns a stored row on `.first()` whose state can be tweaked per
   *     test (lastPolledAt / interval / hash columns).
   */
  function makeFake(stored: Record<string, unknown> | null) {
    const calls: Array<{ kind: 'where' | 'update' | 'create'; args: unknown[] }> = []
    class FakeDeviceCode {
      static get __calls() { return calls }
      static where(col: string, val: unknown) {
        calls.push({ kind: 'where', args: [col, val] })
        return { first: async () => stored as any }
      }
      static async create(data: Record<string, unknown>) {
        calls.push({ kind: 'create', args: [data] })
        return { id: 'D-NEW', ...data }
      }
      static async update(id: string, data: Record<string, unknown>) {
        calls.push({ kind: 'update', args: [id, data] })
      }
      static async delete(id: string) {
        calls.push({ kind: 'update', args: [id, { __deleted: true }] })
      }
    }
    return FakeDeviceCode as any
  }

  function fakeClientForDevice(scopes: string[] = []) {
    class FakeClient {
      static where() {
        return {
          first: async () => ({
            id: 'C-DEVICE', name: 'd', secret: null, confidential: false, revoked: false,
            redirectUris: '[]',
            grantTypes:   '["urn:ietf:params:oauth:grant-type:device_code"]',
            scopes:       JSON.stringify(scopes),
          }) as any,
        }
      }
    }
    return FakeClient as any
  }

  // ── M4 ─────────────────────────────────────────────────

  test('M4 — requestDeviceCode persists hashes only; plaintext returned to caller', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientForDevice())
    const Fake = makeFake(null)
    Passport.useDeviceCodeModel(Fake)

    const response = await requestDeviceCode({
      clientId: 'C-DEVICE',
      verificationUri: 'https://app.example.com/oauth/device',
    })

    assert.ok(response.device_code, 'plaintext device_code returned to caller')
    assert.ok(response.user_code, 'plaintext user_code returned to caller')

    const create = Fake.__calls.find((c: any) => c.kind === 'create')
    assert.ok(create, 'create() must be called')
    const data = create.args[0] as Record<string, unknown>

    assert.equal(data['deviceCodeHash'], await hashDeviceSecret(response.device_code),
      'persisted deviceCodeHash must be SHA-256 of plaintext')
    assert.equal(data['userCodeHash'], await hashDeviceSecret(response.user_code),
      'persisted userCodeHash must be SHA-256 of plaintext')
    // Plaintext columns must NOT be present on the persisted row.
    assert.equal(data['deviceCode'], undefined)
    assert.equal(data['userCode'], undefined)
    Passport.reset()
  })

  test('M4 — pollDeviceCode hashes the supplied device_code before lookup', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 5, expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: null,
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })
    assert.equal(result.status, 'authorization_pending', 'lookup must succeed via hash')

    const where = Fake.__calls.find((c: any) => c.kind === 'where')
    assert.equal(where.args[0], 'deviceCodeHash')
    assert.equal(where.args[1], await hashDeviceSecret('plain-device'),
      'lookup value must be the SHA-256 hash, not the raw plaintext')
    Passport.reset()
  })

  test('M4 — approveDeviceCode hashes user_code before lookup', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: 'dchash',
      userCodeHash:   await hashDeviceSecret('ABCD-WXYZ'),
      scopes: '[]', userId: null, approved: null,
      interval: 5, expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: null,
    })
    Passport.useDeviceCodeModel(Fake)

    await approveDeviceCode('ABCD-WXYZ', 'U-1', true)
    const where = Fake.__calls.find((c: any) => c.kind === 'where')
    assert.equal(where.args[0], 'userCodeHash')
    assert.equal(where.args[1], await hashDeviceSecret('ABCD-WXYZ'))
    Passport.reset()
  })

  test('M4 — pollDeviceCode rejects a wrong plaintext (lookup miss)', async () => {
    Passport.reset()
    Passport.useDeviceCodeModel(makeFake(null))  // first() returns null

    await assert.rejects(
      () => pollDeviceCode({
        grantType:  'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode: 'wrong',
        clientId:   'C-1',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_grant',
    )
    Passport.reset()
  })

  // ── P9 ─────────────────────────────────────────────────

  test('P9 — initial interval is 5 in both response and persisted row', async () => {
    Passport.reset()
    Passport.useClientModel(fakeClientForDevice())
    const Fake = makeFake(null)
    Passport.useDeviceCodeModel(Fake)

    const response = await requestDeviceCode({
      clientId: 'C-DEVICE',
      verificationUri: 'https://app.example.com/oauth/device',
    })

    assert.equal(response.interval, 5, 'response carries initial interval=5')
    const create = Fake.__calls.find((c: any) => c.kind === 'create')
    const data = create.args[0] as Record<string, unknown>
    assert.equal(data['interval'], 5, 'persisted row starts at interval=5')
    Passport.reset()
  })

  test('P9 — slow_down escalates interval by 5 and persists the new value', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 5,
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(),  // just now → faster than the 5s window
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })

    assert.equal(result.status, 'slow_down')
    if (result.status === 'slow_down') {
      assert.equal(result.interval, 10, 'escalated by 5s')
    }
    const update = Fake.__calls.find((c: any) => c.kind === 'update')
    assert.ok(update, 'new interval must be persisted')
    assert.deepEqual(update.args[1], { interval: 10 })
    Passport.reset()
  })

  test('P9 — escalation caps at 60s', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 60,  // already at the cap
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(),
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })

    assert.equal(result.status, 'slow_down')
    if (result.status === 'slow_down') {
      assert.equal(result.interval, 60, 'capped at 60s — does not escalate further')
    }
    // Already at the cap → no update should fire.
    const update = Fake.__calls.find((c: any) => c.kind === 'update')
    assert.equal(update, undefined, 'no DB write when already capped')
    Passport.reset()
  })

  test('P9 — poll within current escalated interval slows_down again at the new value', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 10,  // previously escalated
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(Date.now() - 5_000),  // 5s ago — still inside the 10s window
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })
    assert.equal(result.status, 'slow_down')
    if (result.status === 'slow_down') {
      assert.equal(result.interval, 15, 'escalates from 10 → 15')
    }
    Passport.reset()
  })

  test('P9 — poll after interval has elapsed proceeds normally', async () => {
    Passport.reset()
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 5,
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(Date.now() - 6_000),  // 6s ago — outside the 5s window
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })
    assert.equal(result.status, 'authorization_pending')
    Passport.reset()
  })

  test('P9 — token endpoint forwards `interval` on slow_down', async () => {
    // End-to-end: hits the route handler we updated, verifying the
    // response body shape `{ error: 'slow_down', interval: N }`.
    Passport.reset()
    Passport.useDeviceCodeModel(makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 5,
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(),
    }))

    let postHandler: ((req: any, res: any) => any) | undefined
    const fakeRouter = {
      get:    () => {},
      post:   (p: string, h: any) => { if (p.endsWith('/token')) postHandler = h },
      delete: () => {},
    }
    registerPassportRoutes(fakeRouter)

    let status = 0
    let payload: any
    const res = {
      status(s: number) { status = s; return this },
      json(p: any)      { payload = p },
      header() { return this },
    }
    const req = {
      raw: {} as Record<string, unknown>,
      headers: {},
      body: {
        grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'plain-device',
        client_id:   'C-1',
      },
    }
    await postHandler!(req, res)
    assert.equal(status, 400)
    assert.equal(payload.error, 'slow_down')
    assert.equal(payload.interval, 10, 'response body must carry the escalated interval')
    Passport.reset()
  })
})

describe('Passport.deviceMaxInterval — configurable cap on slow_down escalation', () => {
  // The 60s cap on `oauth_device_codes.interval` was hardcoded after #282.
  // Niche flows (machine-only daemons, integration tests) want it tunable.
  // `Passport.deviceMaxInterval(seconds)` + `PassportConfig.deviceMaxInterval`
  // expose the cap; default stays 60 so existing behavior is unchanged.

  function makeFake(row: Record<string, unknown>): any {
    const calls: Array<{ kind: 'update'; data: Record<string, unknown> }> = []
    class Fake {
      static __calls = calls
      static where(_col: string, _val: unknown) {
        return { first: async () => row as any }
      }
      static async update(_id: string, data: Record<string, unknown>) {
        calls.push({ kind: 'update', data })
      }
    }
    return Fake
  }

  test('default cap is 60 seconds (regression guard for #282 default)', () => {
    Passport.reset()
    assert.equal(Passport.deviceMaxIntervalSeconds(), 60)
  })

  test('Passport.deviceMaxInterval(n) overrides the cap', () => {
    Passport.reset()
    Passport.deviceMaxInterval(120)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 120)
    Passport.reset()
  })

  test('values below the 5s floor are clamped — escalation must always be able to take effect', () => {
    Passport.reset()
    Passport.deviceMaxInterval(0)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 5, '0 clamps to the 5s initial-interval floor')
    Passport.deviceMaxInterval(-10)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 5, 'negative values clamp to 5')
    Passport.deviceMaxInterval(3)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 5, '3 is below the floor → clamped to 5')
    Passport.reset()
  })

  test('fractional values are floored', () => {
    Passport.reset()
    Passport.deviceMaxInterval(45.9)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 45)
    Passport.reset()
  })

  test('reset() restores the default 60s cap', () => {
    Passport.reset()
    Passport.deviceMaxInterval(120)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 120)
    Passport.reset()
    assert.equal(Passport.deviceMaxIntervalSeconds(), 60)
  })

  test('pollDeviceCode honors a raised cap — escalation goes past 60s', async () => {
    Passport.reset()
    Passport.deviceMaxInterval(120)
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 60, // the OLD cap
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(),
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })

    assert.equal(result.status, 'slow_down')
    if (result.status === 'slow_down') {
      assert.equal(result.interval, 65, 'cap raised → escalation continues past 60s')
    }
    const update = Fake.__calls.find((c: any) => c.kind === 'update')
    assert.deepEqual(update?.data, { interval: 65 })
    Passport.reset()
  })

  test('pollDeviceCode honors a lowered cap — escalation stops at the new ceiling', async () => {
    Passport.reset()
    Passport.deviceMaxInterval(15)
    const Fake = makeFake({
      id: 'D-1', clientId: 'C-1',
      deviceCodeHash: await hashDeviceSecret('plain-device'),
      userCodeHash:   'usrhash',
      scopes: '[]', userId: null, approved: null,
      interval: 15, // already at the lowered cap
      expiresAt: new Date(Date.now() + 60_000),
      lastPolledAt: new Date(),
    })
    Passport.useDeviceCodeModel(Fake)

    const result = await pollDeviceCode({
      grantType:  'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode: 'plain-device',
      clientId:   'C-1',
    })

    assert.equal(result.status, 'slow_down')
    if (result.status === 'slow_down') {
      assert.equal(result.interval, 15, 'lowered cap held — no further escalation')
    }
    const update = Fake.__calls.find((c: any) => c.kind === 'update')
    assert.equal(update, undefined, 'no DB write when already capped')
    Passport.reset()
  })

  test('Passport.deviceMaxInterval setter+getter pair (boot integration via PassportConfig)', () => {
    // The boot path is `if (cfg.deviceMaxInterval !== undefined)
    // Passport.deviceMaxInterval(cfg.deviceMaxInterval)`. We don't run the
    // full provider here (heavyweight — same approach as the P7 issuer
    // test); the wiring is single-line and covered by the typecheck on the
    // provider boot() method, plus the setter/getter regression below.
    Passport.reset()
    assert.equal(Passport.deviceMaxIntervalSeconds(), 60, 'default')
    Passport.deviceMaxInterval(180)
    assert.equal(Passport.deviceMaxIntervalSeconds(), 180)
    Passport.reset()
    assert.equal(Passport.deviceMaxIntervalSeconds(), 60, 'reset() restores default')
  })
})

describe('pollDeviceCode — concurrent polling race', () => {
  // Race regression: previously, pollDeviceCode read the approved row, issued
  // tokens, then deleted the row. Two concurrent polls of the same approved
  // code both passed the in-memory `approved === true` check and both called
  // issueTokens. The fix is an atomic conditional delete — only one of N
  // concurrent polls deletes the row; the rest get count=0 and report
  // invalid_grant.

  function makeRaceableDevice(row: Record<string, unknown>) {
    function makeBuilder(initialPredicate: (r: Record<string, unknown>) => boolean) {
      let predicate = initialPredicate
      const builder = {
        where(col: string, val: unknown) {
          const prev = predicate
          predicate = (r) => prev(r) && r[col] === val
          return builder
        },
        // Return a shallow clone so each concurrent poll gets its own
        // snapshot — matches Model.first()'s real-world behavior (separate
        // object identities per call), so a mutation via update() doesn't
        // bleed into another in-flight call's local `device` variable.
        first: async () => predicate(row) ? { ...row } : null,
        async deleteAll(): Promise<number> {
          // Atomic claim: evaluate predicate + mark deleted in one sync step.
          // The second concurrent caller sees __deleted=true → predicate
          // fails → returns 0.
          if (!predicate(row) || row['__deleted']) return 0
          row['__deleted'] = true
          return 1
        },
      }
      return builder
    }
    class FakeDeviceCode {
      static where(col: string, val: unknown) {
        return makeBuilder((r) => r[col] === val && !r['__deleted'])
      }
      static async update(_id: string, data: Record<string, unknown>) {
        Object.assign(row, data)
      }
      static async delete(_id: string) {
        row['__deleted'] = true
      }
    }
    return FakeDeviceCode as unknown as Parameters<typeof Passport.useDeviceCodeModel>[0]
  }

  function fakeClientForDevice() {
    class FakeClient {
      static where() {
        return {
          first: async () => ({
            id: 'C-1', name: 'd', secret: null, confidential: false, revoked: false,
            redirectUris: '[]',
            grantTypes:   '["urn:ietf:params:oauth:grant-type:device_code"]',
            scopes:       '[]',
          }) as unknown,
        }
      }
    }
    return FakeClient as unknown as Parameters<typeof Passport.useClientModel>[0]
  }

  test('concurrent polls of an approved code — only one issues tokens', async () => {
    Passport.reset()
    await (async () => {
      const { generateKeyPairSync } = await import('node:crypto')
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      })
      Passport.setKeys(privateKey, publicKey)
    })()
    Passport.useClientModel(fakeClientForDevice())

    const deviceCodeHash = await hashDeviceSecret('plain-device')
    const row = {
      id: 'D-RACE', clientId: 'C-1',
      deviceCodeHash,
      userCodeHash: 'usrhash',
      scopes:       '["read"]',
      userId:       'U-1',
      approved:     true,
      interval:     5,
      expiresAt:    new Date(Date.now() + 60_000),
      lastPolledAt: null,
    } as Record<string, unknown>
    Passport.useDeviceCodeModel(makeRaceableDevice(row))

    // Stub access + refresh token issuance so we can count mints without
    // pulling in the full token-model fakes from the refresh-token tests.
    let accessTokensCreated = 0
    let refreshTokensCreated = 0
    class FakeAccessIssue {
      static where() { return { first: async () => null, get: async () => [] } }
      static query() { return { where() { return this }, get: async () => [] } }
      static async create(_data: Record<string, unknown>) {
        accessTokensCreated++
        return { id: `AT-${accessTokensCreated}`, ..._data }
      }
    }
    class FakeRefreshIssue {
      static where() { return { first: async () => null, get: async () => [] } }
      static async create(_data: Record<string, unknown>) {
        refreshTokensCreated++
        return { id: `RT-${refreshTokensCreated}`, ..._data }
      }
    }
    Passport.useTokenModel(FakeAccessIssue as unknown as Parameters<typeof Passport.useTokenModel>[0])
    Passport.useRefreshTokenModel(FakeRefreshIssue as unknown as Parameters<typeof Passport.useRefreshTokenModel>[0])

    const results = await Promise.allSettled([
      pollDeviceCode({ grantType: 'urn:ietf:params:oauth:grant-type:device_code', deviceCode: 'plain-device', clientId: 'C-1' }),
      pollDeviceCode({ grantType: 'urn:ietf:params:oauth:grant-type:device_code', deviceCode: 'plain-device', clientId: 'C-1' }),
    ])

    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ status: string }>[]
    const rejected  = results.filter(r => r.status === 'rejected')  as PromiseRejectedResult[]

    // One call wins the atomic claim → returns 'authorized'. The other
    // sees count=0 → throws invalid_grant. The wire status the device flow
    // surfaces ('already used') is more informative than re-shaping into a
    // poll-status enum and matches the auth-code grant's behavior.
    assert.equal(fulfilled.length, 1, 'exactly one poll should return authorized')
    assert.equal(rejected.length,  1, 'the other must throw invalid_grant')
    assert.equal(fulfilled[0]!.value.status, 'authorized')
    assert.ok(rejected[0]!.reason instanceof OAuthError && rejected[0]!.reason.error === 'invalid_grant')

    // Exactly one token pair minted — no double-issue.
    assert.equal(accessTokensCreated,  1, 'exactly one access token minted')
    assert.equal(refreshTokensCreated, 1, 'exactly one refresh token minted')
    assert.equal(row['__deleted'], true, 'device code row is consumed')

    Passport.reset()
  })
})
