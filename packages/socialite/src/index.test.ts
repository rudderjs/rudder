import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Socialite,
  SocialUser,
  SocialiteDriver,
  GitHubProvider,
  GoogleProvider,
  FacebookProvider,
  AppleProvider,
  SocialiteProvider,
  InvalidStateException,
  type SocialiteDriverConfig,
} from './index.js'
import { SessionInstance, _runWithSession } from '@rudderjs/session'

const baseConfig: SocialiteDriverConfig = {
  clientId:     'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUrl:  'http://localhost:3000/auth/callback',
}

// ─── SocialUser ───────────────────────────────────────────

describe('SocialUser', () => {
  const user = new SocialUser({
    id: '123', name: 'John', email: 'john@example.com',
    avatar: 'https://img.example.com/john.jpg', nickname: 'johnd',
    token: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600,
    raw: { id: '123', login: 'johnd' },
  })

  it('getId()', () => assert.strictEqual(user.getId(), '123'))
  it('getName()', () => assert.strictEqual(user.getName(), 'John'))
  it('getEmail()', () => assert.strictEqual(user.getEmail(), 'john@example.com'))
  it('getAvatar()', () => assert.strictEqual(user.getAvatar(), 'https://img.example.com/john.jpg'))
  it('getNickname()', () => assert.strictEqual(user.getNickname(), 'johnd'))
  it('token', () => assert.strictEqual(user.token, 'access-token'))
  it('refreshToken', () => assert.strictEqual(user.refreshToken, 'refresh-token'))
  it('expiresIn', () => assert.strictEqual(user.expiresIn, 3600))
  it('getRaw()', () => assert.deepStrictEqual(user.getRaw(), { id: '123', login: 'johnd' }))

  it('handles null fields', () => {
    const minimal = new SocialUser({
      id: '1', name: null, email: null, avatar: null, nickname: null,
      token: 't', raw: {},
    })
    assert.strictEqual(minimal.getName(), null)
    assert.strictEqual(minimal.refreshToken, null)
    assert.strictEqual(minimal.expiresIn, null)
  })
})

// ─── GitHubProvider ───────────────────────────────────────

describe('GitHubProvider', () => {
  // .stateless() throughout this block — these tests target URL-generation
  // shape, not the new stateful default (covered separately below).
  const provider = new GitHubProvider(baseConfig).stateless()

  it('generates a redirect URL with correct params', () => {
    const url = provider.getRedirectUrl('test-state')
    assert.ok(url.startsWith('https://github.com/login/oauth/authorize'))
    assert.ok(url.includes('client_id=test-client-id'))
    assert.ok(url.includes('redirect_uri='))
    assert.ok(url.includes('state=test-state'))
    assert.ok(url.includes('scope=read'))
  })

  it('redirect() returns a 302 Response', () => {
    const res = provider.redirect('state123')
    assert.strictEqual(res.status, 302)
    assert.ok(res.headers.get('location')?.includes('github.com'))
  })

  it('withScopes adds scopes', () => {
    const p = new GitHubProvider(baseConfig).stateless().withScopes(['repo'])
    const url = p.getRedirectUrl()
    assert.ok(url.includes('repo'))
    assert.ok(url.includes('read'))
  })

  it('setScopes replaces scopes', () => {
    const p = new GitHubProvider(baseConfig).stateless().setScopes(['repo'])
    const url = p.getRedirectUrl()
    assert.ok(url.includes('repo'))
    assert.ok(!url.includes('read%3Auser'))
  })
})

// ─── GoogleProvider ───────────────────────────────────────

describe('GoogleProvider', () => {
  const provider = new GoogleProvider(baseConfig).stateless()

  it('generates a redirect URL to Google', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.startsWith('https://accounts.google.com/'))
    assert.ok(url.includes('client_id=test-client-id'))
    assert.ok(url.includes('openid'))
  })

  it('default scopes include openid, profile, email', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.includes('openid'))
    assert.ok(url.includes('profile'))
    assert.ok(url.includes('email'))
  })
})

// ─── FacebookProvider ─────────────────────────────────────

describe('FacebookProvider', () => {
  const provider = new FacebookProvider(baseConfig).stateless()

  it('generates a redirect URL to Facebook', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.startsWith('https://www.facebook.com/'))
    assert.ok(url.includes('client_id=test-client-id'))
  })

  it('default scopes include email', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.includes('email'))
  })
})

// ─── AppleProvider ────────────────────────────────────────

describe('AppleProvider', () => {
  const provider = new AppleProvider(baseConfig).stateless()

  it('generates a redirect URL to Apple with response_mode=form_post', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.startsWith('https://appleid.apple.com/'))
    assert.ok(url.includes('response_mode=form_post'))
    assert.ok(url.includes('client_id=test-client-id'))
  })

  it('generates a redirect URL with a CSPRNG state by default (stateful)', () => {
    // Apple's getRedirectUrl must inherit O5's stateful generation, not skip it.
    const session = makeSession()
    const stateful = new AppleProvider(baseConfig)
    const url = _runWithSession(session, () => stateful.getRedirectUrl())
    const stateMatch = url.match(/state=([a-f0-9]{40})/)
    assert.ok(stateMatch, 'Apple redirect URL must include a generated state param')
    assert.ok(url.includes('response_mode=form_post'), 'response_mode preserved alongside state')
  })
})

// ─── O2/O3: Apple ES256 client_secret + id_token verification ──

import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto'

/** Generate fresh test keys once per test run. EC for client_secret, RSA for id_token. */
const _ecKey  = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const _rsaKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const _APPLE_KID = 'test-apple-kid'
const _APPLE_JWK = (() => {
  const jwk = createPublicKey(_rsaKey.publicKey).export({ format: 'jwk' }) as Record<string, unknown>
  return { ...jwk, kid: _APPLE_KID, alg: 'RS256', use: 'sig' }
})()

const appleConfig = {
  clientId:     'com.test.app',
  clientSecret: '',  // unused; Apple uses ES256 JWT
  redirectUrl:  'http://localhost:3000/auth/callback',
  teamId:       'TEAMTEAMID',
  keyId:        'KEYIDKEYID',
  privateKey:   _ecKey.privateKey,
}

/** Sign an RS256 id_token with the test RSA key, defaulting to valid Apple claims. */
function signTestIdToken(claims: Record<string, unknown> = {}, opts: { kid?: string; alg?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const merged = {
    iss:   'https://appleid.apple.com',
    aud:   appleConfig.clientId,
    sub:   '001234.apple.user.test',
    iat:   now,
    exp:   now + 3600,
    email: 'apple-user@example.com',
    ...claims,
  }
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? _APPLE_KID, typ: 'JWT' }
  const headerB64  = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(merged)).toString('base64url')
  const signingInput = `${headerB64}.${payloadB64}`
  const signer = createSign('SHA256')
  signer.update(signingInput)
  const sig = signer.sign(_rsaKey.privateKey, 'base64url')
  return `${signingInput}.${sig}`
}

/**
 * Mock global.fetch so Apple's token endpoint returns the supplied id_token
 * and Apple's JWKS endpoint returns our test public key. Also lets the test
 * inspect the body posted to the token endpoint (to assert client_secret JWT).
 */
function mockAppleEndpoints(opts: {
  idToken?:        string
  tokenStatus?:    number
  tokenBody?:      Record<string, unknown>
  jwksKeys?:       unknown[]  // override JWKS keys (e.g. wrong kid)
  jwksStatus?:     number
} = {}): { tokenCall: { body: URLSearchParams } | null } {
  const captured: { tokenCall: { body: URLSearchParams } | null } = { tokenCall: null }
  const tokenStatus = opts.tokenStatus ?? 200
  const idToken     = opts.idToken     ?? signTestIdToken()
  const tokenBody   = opts.tokenBody   ?? { access_token: 'apple-access-tok', refresh_token: 'apple-refresh-tok', id_token: idToken }
  const jwksStatus  = opts.jwksStatus  ?? 200
  const jwksKeys    = opts.jwksKeys    ?? [_APPLE_JWK]

  global.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/auth/token')) {
      captured.tokenCall = { body: init.body as URLSearchParams }
      return new Response(JSON.stringify(tokenBody), {
        status: tokenStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/auth/keys')) {
      return new Response(JSON.stringify({ keys: jwksKeys }), {
        status: jwksStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`Unmocked fetch: ${url}`)
  }) as typeof fetch

  return captured
}

describe('AppleProvider — ES256 client_secret JWT (O2)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = global.fetch
    AppleProvider._resetJwksCache()
  })
  function restoreFetch(): void { global.fetch = originalFetch }

  it('signs a fresh ES256 JWT and posts it as client_secret', async () => {
    try {
      const captured = mockAppleEndpoints()
      const provider = new AppleProvider(appleConfig).stateless()
      await provider.user('apple-auth-code')

      assert.ok(captured.tokenCall, 'token endpoint must have been called')
      const sentSecret = captured.tokenCall!.body.get('client_secret')
      assert.ok(sentSecret, 'client_secret must be present')
      const parts = sentSecret!.split('.')
      assert.strictEqual(parts.length, 3, 'client_secret must be a JWT (3 segments)')

      const header  = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'))
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))

      assert.strictEqual(header.alg, 'ES256')
      assert.strictEqual(header.kid, appleConfig.keyId)
      assert.strictEqual(header.typ, 'JWT')

      assert.strictEqual(payload.iss, appleConfig.teamId)
      assert.strictEqual(payload.sub, appleConfig.clientId)
      assert.strictEqual(payload.aud, 'https://appleid.apple.com')
      assert.ok(typeof payload.iat === 'number')
      assert.ok(typeof payload.exp === 'number' && payload.exp > payload.iat)
    } finally { restoreFetch() }
  })

  it('produces a JWS signature in IEEE-P1363 format (64 bytes), not DER', async () => {
    try {
      const captured = mockAppleEndpoints()
      const provider = new AppleProvider(appleConfig).stateless()
      await provider.user('apple-auth-code')
      const parts = captured.tokenCall!.body.get('client_secret')!.split('.')
      const sig = Buffer.from(parts[2]!, 'base64url')
      // ES256 JWS: r||s, each 32 bytes → 64 bytes total. DER would be ~70-72.
      assert.strictEqual(sig.length, 64, 'ES256 JWS signatures must be 64 bytes (IEEE P-1363)')
    } finally { restoreFetch() }
  })

  it('throws a clear error when teamId/keyId/privateKey are missing', async () => {
    try {
      mockAppleEndpoints()
      // baseConfig lacks all three Apple JWT params
      const provider = new AppleProvider(baseConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /requires `teamId`, `keyId`, and `privateKey`/,
      )
    } finally { restoreFetch() }
  })

  it('throws a clear error when privateKey is not a valid EC PEM', async () => {
    try {
      mockAppleEndpoints()
      const provider = new AppleProvider({ ...appleConfig, privateKey: 'not-a-pem' }).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /not a valid PEM-encoded EC private key/,
      )
    } finally { restoreFetch() }
  })

  it('throws when privateKey is RSA, not EC', async () => {
    try {
      mockAppleEndpoints()
      const provider = new AppleProvider({ ...appleConfig, privateKey: _rsaKey.privateKey }).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /expects an EC P-256 private key; got rsa/,
      )
    } finally { restoreFetch() }
  })
})

describe('AppleProvider — id_token verification (O3)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = global.fetch
    AppleProvider._resetJwksCache()
  })
  function restoreFetch(): void { global.fetch = originalFetch }

  it('verifies a valid id_token end-to-end and returns SocialUser from claims', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({ sub: 'apple-user-001', email: 'sub@example.com' }) })
      const provider = new AppleProvider(appleConfig).stateless()
      const user = await provider.user('apple-auth-code')
      assert.ok(user instanceof SocialUser)
      assert.strictEqual(user.getId(),    'apple-user-001')
      assert.strictEqual(user.getEmail(), 'sub@example.com')
      assert.strictEqual(user.token,      'apple-access-tok')
    } finally { restoreFetch() }
  })

  it('rejects an id_token whose signature was tampered with', async () => {
    try {
      const tampered = signTestIdToken().split('.')
      // Flip a byte in the payload — signature no longer matches
      const badPayload = Buffer.from('{"iss":"https://appleid.apple.com","aud":"com.test.app","sub":"x","exp":9999999999}').toString('base64url')
      const badIdToken = `${tampered[0]}.${badPayload}.${tampered[2]}`
      mockAppleEndpoints({ idToken: badIdToken })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /signature verification failed/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token signed by a different key (kid not in JWKS)', async () => {
    try {
      const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
      // Build a token whose header advertises `_APPLE_KID` (will resolve our test JWK)
      // but whose signature was made with a different key.
      const header = { alg: 'RS256', kid: _APPLE_KID, typ: 'JWT' }
      const payload = { iss: 'https://appleid.apple.com', aud: appleConfig.clientId, sub: 'x', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 3600 }
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
      const signer = createSign('SHA256')
      signer.update(`${headerB64}.${payloadB64}`)
      const badSig = signer.sign(otherKey.privateKey, 'base64url')
      mockAppleEndpoints({ idToken: `${headerB64}.${payloadB64}.${badSig}` })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /signature verification failed/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token whose kid is not in the JWKS', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({}, { kid: 'unknown-kid' }) })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /no signing key for kid/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token with non-RS256 alg (alg=none confusion attack)', async () => {
    try {
      const header = { alg: 'none', kid: _APPLE_KID, typ: 'JWT' }
      const payload = { iss: 'https://appleid.apple.com', aud: appleConfig.clientId, sub: 'x', exp: 9999999999 }
      const idToken = [
        Buffer.from(JSON.stringify(header)).toString('base64url'),
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        '',
      ].join('.')
      mockAppleEndpoints({ idToken })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /unexpected alg "none"/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token with wrong issuer', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({ iss: 'https://evil.example.com' }) })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /iss .* does not match/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token whose aud does not match clientId', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({ aud: 'com.attacker.app' }) })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /aud does not match clientId/,
      )
    } finally { restoreFetch() }
  })

  it('accepts an id_token whose aud is an array including clientId', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({ aud: ['some.other.client', appleConfig.clientId] }) })
      const provider = new AppleProvider(appleConfig).stateless()
      const user = await provider.user('apple-auth-code')
      assert.ok(user instanceof SocialUser)
    } finally { restoreFetch() }
  })

  it('rejects an expired id_token', async () => {
    try {
      mockAppleEndpoints({ idToken: signTestIdToken({ exp: Math.floor(Date.now() / 1000) - 60 }) })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /token expired/,
      )
    } finally { restoreFetch() }
  })

  it('rejects an id_token with missing sub', async () => {
    try {
      // signTestIdToken merges defaults; explicitly null the sub
      mockAppleEndpoints({ idToken: signTestIdToken({ sub: '' }) })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /missing sub/,
      )
    } finally { restoreFetch() }
  })

  it('throws when token endpoint returns no id_token', async () => {
    try {
      mockAppleEndpoints({ tokenBody: { access_token: 'a' } })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /missing id_token/,
      )
    } finally { restoreFetch() }
  })

  it('throws when JWKS fetch fails', async () => {
    try {
      mockAppleEndpoints({ jwksStatus: 503 })
      const provider = new AppleProvider(appleConfig).stateless()
      await assert.rejects(
        async () => provider.user('apple-auth-code'),
        /JWKS fetch failed/,
      )
    } finally { restoreFetch() }
  })

  it('caches JWKS across calls (only fetches once for two id_tokens with same kid)', async () => {
    try {
      let jwksFetchCount = 0
      const idToken = signTestIdToken()
      global.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/auth/token')) {
          return new Response(JSON.stringify({ access_token: 'a', id_token: idToken }), { status: 200 })
        }
        if (url.includes('/auth/keys')) {
          jwksFetchCount += 1
          return new Response(JSON.stringify({ keys: [_APPLE_JWK] }), { status: 200 })
        }
        throw new Error(`Unmocked: ${url}`)
      }) as typeof fetch

      const provider = new AppleProvider(appleConfig).stateless()
      await provider.user('code-1')
      await provider.user('code-2')
      assert.strictEqual(jwksFetchCount, 1, 'JWKS must be cached for repeated kid hits')
    } finally { restoreFetch() }
  })

  it('refetches JWKS when an already-cached lookup misses (Apple rotation handling)', async () => {
    try {
      AppleProvider._resetJwksCache()
      let jwksFetchCount = 0
      // Two id_tokens signed with the same RSA key but advertising different kids.
      // After the first call populates the cache with kid-A, a second call with
      // kid-B should fall through and refetch (rather than treat the missing kid
      // as a permanent failure).
      const idTokenA = signTestIdToken({ sub: 'user-a' }, { kid: 'kid-A' })
      const idTokenB = signTestIdToken({ sub: 'user-b' }, { kid: 'kid-B' })
      global.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/auth/token')) {
          // Pick which id_token based on the auth code in the body
          const body = init.body as URLSearchParams
          const code = body.get('code')
          const tok  = code === 'code-2' ? idTokenB : idTokenA
          return new Response(JSON.stringify({ access_token: 'a', id_token: tok }), { status: 200 })
        }
        if (url.includes('/auth/keys')) {
          jwksFetchCount += 1
          // First fetch only knows about kid-A. Second fetch (after rotation)
          // returns kid-B too.
          const keys = jwksFetchCount === 1
            ? [{ ..._APPLE_JWK, kid: 'kid-A' }]
            : [{ ..._APPLE_JWK, kid: 'kid-A' }, { ..._APPLE_JWK, kid: 'kid-B' }]
          return new Response(JSON.stringify({ keys }), { status: 200 })
        }
        throw new Error(`Unmocked: ${url}`)
      }) as typeof fetch

      const provider = new AppleProvider(appleConfig).stateless()
      await provider.user('code-1')                              // first call → fetch #1 (kid-A only)
      assert.strictEqual(jwksFetchCount, 1)
      const userB = await provider.user('code-2')                // second call → kid-B miss → fetch #2
      assert.ok(userB instanceof SocialUser)
      assert.strictEqual(jwksFetchCount, 2, 'cache miss on rotated kid must refetch JWKS')
    } finally { restoreFetch() }
  })
})

// helper used by the new redirect-state test above
function makeSession(): SessionInstance {
  const fakeDriver  = { load: async () => ({} as never), persist: async () => '', destroy: async () => undefined }
  const fakeConfig  = { name: 'test', secret: 'test', lifetime: 60, secure: false, sameSite: 'lax' as const, httpOnly: true }
  return new SessionInstance({ id: 'sess-1', data: {}, flash_next: {} } as never, fakeDriver, fakeConfig as never)
}

// ─── Token endpoint encoding (RFC 6749 §4.1.3) ────────────

describe('SocialiteDriver.getAccessToken — token endpoint', () => {
  let captured: { url: string; init: RequestInit } | null = null
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
    captured = null
    global.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      captured = { url: typeof input === 'string' ? input : input.toString(), init }
      return new Response(
        JSON.stringify({ access_token: 'tok', refresh_token: 'rtok', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
  })

  function restoreFetch(): void { global.fetch = originalFetch }

  it('uses application/x-www-form-urlencoded Content-Type', async () => {
    try {
      const provider = new GitHubProvider(baseConfig)
      await provider.getAccessToken('auth-code-xyz')
      assert.ok(captured, 'fetch must have been called')
      const headers = new Headers(captured!.init.headers)
      assert.strictEqual(headers.get('content-type'), 'application/x-www-form-urlencoded')
    } finally { restoreFetch() }
  })

  it('serializes the body as URL-encoded form params', async () => {
    try {
      const provider = new GitHubProvider(baseConfig)
      await provider.getAccessToken('auth-code-xyz')
      const body = captured!.init.body
      assert.ok(body instanceof URLSearchParams, 'body must be URLSearchParams')
      assert.strictEqual(body.get('client_id'),     'test-client-id')
      assert.strictEqual(body.get('client_secret'), 'test-client-secret')
      assert.strictEqual(body.get('code'),          'auth-code-xyz')
      assert.strictEqual(body.get('redirect_uri'),  'http://localhost:3000/auth/callback')
      assert.strictEqual(body.get('grant_type'),    'authorization_code')
    } finally { restoreFetch() }
  })

  it('returns parsed token, refresh, and expiry from the response', async () => {
    try {
      const provider = new GoogleProvider(baseConfig)
      const result = await provider.getAccessToken('code')
      assert.strictEqual(result.accessToken,  'tok')
      assert.strictEqual(result.refreshToken, 'rtok')
      assert.strictEqual(result.expiresIn,    3600)
    } finally { restoreFetch() }
  })

  it('throws when the provider responds with non-2xx', async () => {
    try {
      global.fetch = (async () => new Response('bad', { status: 401 })) as typeof fetch
      const provider = new GitHubProvider(baseConfig)
      await assert.rejects(
        async () => provider.getAccessToken('code'),
        /Token exchange failed: 401/,
      )
    } finally { restoreFetch() }
  })

  it('keeps the response body off the error message and exposes it via cause', async () => {
    try {
      // Provider sometimes echoes the client_id (or hints, or raw stack
      // traces) — we don't want any of that surfacing in top-level logs.
      global.fetch = (async () =>
        new Response('{"error":"invalid_client","client_id":"echoed-secret"}', { status: 401 })
      ) as typeof fetch
      const provider = new GitHubProvider(baseConfig)
      try {
        await provider.getAccessToken('code')
        assert.fail('expected rejection')
      } catch (err) {
        assert.ok(err instanceof Error)
        assert.doesNotMatch(err.message, /echoed-secret/)
        assert.doesNotMatch(err.message, /invalid_client/)
        const cause = err.cause as { status: number; body: string }
        assert.strictEqual(cause.status, 401)
        assert.match(cause.body, /echoed-secret/)
      }
    } finally { restoreFetch() }
  })

  it('rejects non-string access_token in token-exchange response', async () => {
    try {
      global.fetch = (async () =>
        new Response(JSON.stringify({ access_token: 12345 }), { status: 200 })
      ) as typeof fetch
      const provider = new GitHubProvider(baseConfig)
      await assert.rejects(
        async () => provider.getAccessToken('code'),
        /No access_token/,
      )
    } finally { restoreFetch() }
  })

  it('rejects empty-string access_token', async () => {
    try {
      global.fetch = (async () =>
        new Response(JSON.stringify({ access_token: '' }), { status: 200 })
      ) as typeof fetch
      const provider = new GitHubProvider(baseConfig)
      await assert.rejects(
        async () => provider.getAccessToken('code'),
        /No access_token/,
      )
    } finally { restoreFetch() }
  })

  it('coerces non-string refresh_token / non-number expires_in to null', async () => {
    try {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({ access_token: 'tok', refresh_token: 9001, expires_in: 'soon' }),
          { status: 200 },
        )
      ) as typeof fetch
      const provider = new GitHubProvider(baseConfig)
      const result = await provider.getAccessToken('code')
      assert.strictEqual(result.accessToken, 'tok')
      assert.strictEqual(result.refreshToken, null)
      assert.strictEqual(result.expiresIn, null)
    } finally { restoreFetch() }
  })

  it('passes a timeout-bound AbortSignal to fetch', async () => {
    try {
      let receivedSignal: AbortSignal | undefined
      global.fetch = ((_input: unknown, init: RequestInit = {}) => {
        receivedSignal = init.signal as AbortSignal | undefined
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ))
      }) as unknown as typeof fetch

      const provider = new GitHubProvider({ ...baseConfig, timeout: 5_000 })
      await provider.getAccessToken('code')
      assert.ok(receivedSignal instanceof AbortSignal, 'fetch must receive an AbortSignal')
    } finally { restoreFetch() }
  })
})

// ─── Socialite Facade ─────────────────────────────────────

describe('Socialite', () => {
  beforeEach(() => Socialite.reset())

  it('driver() creates a provider from config', () => {
    Socialite.configure({ github: baseConfig })
    const provider = Socialite.driver('github')
    assert.ok(provider instanceof GitHubProvider)
  })

  it('driver() caches instances', () => {
    Socialite.configure({ github: baseConfig })
    assert.strictEqual(Socialite.driver('github'), Socialite.driver('github'))
  })

  it('driver() throws for unconfigured provider', () => {
    Socialite.configure({})
    assert.throws(() => Socialite.driver('github'), /not configured/)
  })

  it('driver() throws for unknown provider', () => {
    Socialite.configure({ unknown: baseConfig })
    assert.throws(() => Socialite.driver('unknown'), /Unknown provider/)
  })

  it('extend() registers a custom driver', () => {
    class CustomDriver extends SocialiteDriver {
      protected defaultScopes() { return [] }
      protected authUrl() { return 'https://custom.example.com/auth' }
      protected tokenUrl() { return 'https://custom.example.com/token' }
      protected userUrl() { return 'https://custom.example.com/user' }
      protected mapToUser(data: Record<string, unknown>, token: string) {
        return new SocialUser({ id: String(data['id']), name: null, email: null, avatar: null, nickname: null, token, raw: data })
      }
    }

    Socialite.extend('custom', (c) => new CustomDriver(c))
    Socialite.configure({ custom: baseConfig })
    const driver = Socialite.driver('custom')
    assert.ok(driver instanceof CustomDriver)
  })

  it('extend() invalidates a previously cached driver instance', () => {
    class FirstDriver extends SocialiteDriver {
      protected defaultScopes() { return [] }
      protected authUrl() { return 'https://first.example.com/auth' }
      protected tokenUrl() { return 'https://first.example.com/token' }
      protected userUrl() { return 'https://first.example.com/user' }
      protected mapToUser(data: Record<string, unknown>, token: string) {
        return new SocialUser({ id: '1', name: null, email: null, avatar: null, nickname: null, token, raw: data })
      }
    }
    class SecondDriver extends SocialiteDriver {
      protected defaultScopes() { return [] }
      protected authUrl() { return 'https://second.example.com/auth' }
      protected tokenUrl() { return 'https://second.example.com/token' }
      protected userUrl() { return 'https://second.example.com/user' }
      protected mapToUser(data: Record<string, unknown>, token: string) {
        return new SocialUser({ id: '2', name: null, email: null, avatar: null, nickname: null, token, raw: data })
      }
    }

    Socialite.extend('twin', (c) => new FirstDriver(c))
    Socialite.configure({ twin: baseConfig })
    const before = Socialite.driver('twin')
    assert.ok(before instanceof FirstDriver)

    Socialite.extend('twin', (c) => new SecondDriver(c))
    const after = Socialite.driver('twin')
    assert.ok(after instanceof SecondDriver, 'replacing the factory must surface a new instance')
    assert.notStrictEqual(before, after)
  })

  it('all built-in drivers work', () => {
    Socialite.configure({
      github:   baseConfig,
      google:   baseConfig,
      facebook: baseConfig,
      apple:    baseConfig,
    })
    assert.ok(Socialite.driver('github') instanceof GitHubProvider)
    assert.ok(Socialite.driver('google') instanceof GoogleProvider)
    assert.ok(Socialite.driver('facebook') instanceof FacebookProvider)
    assert.ok(Socialite.driver('apple') instanceof AppleProvider)
  })

  it('reset() clears everything', () => {
    Socialite.configure({ github: baseConfig })
    Socialite.driver('github')
    Socialite.reset()
    assert.throws(() => Socialite.driver('github'), /not configured/)
  })
})

// ─── SocialiteProvider ────────────────────────────────────

describe('SocialiteProvider', () => {
  it('is a class', () => {
    assert.strictEqual(typeof SocialiteProvider, 'function')
    assert.strictEqual(SocialiteProvider.name, 'SocialiteProvider')
  })
})

// ─── O5: OAuth state — stateful default + .stateless() opt-out ─

describe('SocialiteDriver — OAuth state (CSRF defense)', () => {
  // Minimal stub session — `put`/`get`/`forget` are the only methods the
  // driver touches. Driver/config aren't used since we never call save().
  const fakeDriver  = { load: async () => ({} as never), persist: async () => '', destroy: async () => undefined }
  const fakeConfig  = { name: 'test', secret: 'test', lifetime: 60, secure: false, sameSite: 'lax' as const, httpOnly: true }
  const makeSession = (): SessionInstance =>
    new SessionInstance({ id: 'sess-1', data: {}, flash_next: {} } as never, fakeDriver, fakeConfig as never)

  // Token endpoint always 200 OK with a tok — these tests target state, not
  // token exchange, but user() goes through both.
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: 'tok', refresh_token: null, expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    ) as typeof fetch
  })
  function restoreFetch(): void { global.fetch = originalFetch }

  it('getRedirectUrl() generates + persists a CSPRNG state when no state passed (stateful default)', () => {
    try {
      const session = makeSession()
      const provider = new GitHubProvider(baseConfig)

      const url = _runWithSession(session, () => provider.getRedirectUrl())
      const stateMatch = url.match(/state=([a-f0-9]{40})/)
      assert.ok(stateMatch, 'URL must include a generated state param')
      assert.strictEqual(session.get<string>('socialite_state:github'), stateMatch![1])
    } finally { restoreFetch() }
  })

  it('getRedirectUrl(explicit) honors caller-supplied state and skips generation', () => {
    try {
      const session = makeSession()
      const provider = new GitHubProvider(baseConfig)

      const url = _runWithSession(session, () => provider.getRedirectUrl('caller-state'))
      assert.ok(url.includes('state=caller-state'))
      assert.strictEqual(session.get('socialite_state:github'), undefined,
        'session should not be touched when state is caller-supplied')
    } finally { restoreFetch() }
  })

  it('getRedirectUrl() throws when stateful and no session is in context', () => {
    try {
      const provider = new GitHubProvider(baseConfig)
      assert.throws(() => provider.getRedirectUrl(), /no session in context/i)
    } finally { restoreFetch() }
  })

  it('.stateless() omits state and skips session', () => {
    try {
      const provider = new GitHubProvider(baseConfig).stateless()
      const url = provider.getRedirectUrl()
      assert.ok(!url.includes('state='), 'stateless URL must not embed state')
      assert.strictEqual(provider.isStateless(), true)
    } finally { restoreFetch() }
  })

  it('user() validates query.state against session-stored state on success', async () => {
    try {
      const session = makeSession()
      session.put('socialite_state:github', 'matching-state')
      const provider = new GitHubProvider(baseConfig)

      const user = await _runWithSession(session, () =>
        provider.user({ query: { code: 'auth-code', state: 'matching-state' } }),
      )
      assert.ok(user instanceof SocialUser)
      assert.strictEqual(session.get('socialite_state:github'), undefined,
        'state must be one-time use (forgotten after successful validate)')
    } finally { restoreFetch() }
  })

  it('user() throws InvalidStateException when query.state does not match session', async () => {
    try {
      const session = makeSession()
      session.put('socialite_state:github', 'real-state')
      const provider = new GitHubProvider(baseConfig)

      await assert.rejects(
        async () => _runWithSession(session, () =>
          provider.user({ query: { code: 'auth-code', state: 'attacker-state' } }),
        ),
        InvalidStateException,
      )
      assert.strictEqual(session.get('socialite_state:github'), undefined,
        'failed validation also clears state — prevents replay against the same slot')
    } finally { restoreFetch() }
  })

  it('user() throws InvalidStateException when query.state is missing', async () => {
    try {
      const session = makeSession()
      session.put('socialite_state:github', 'real-state')
      const provider = new GitHubProvider(baseConfig)

      await assert.rejects(
        async () => _runWithSession(session, () =>
          provider.user({ query: { code: 'auth-code' } }),
        ),
        InvalidStateException,
      )
    } finally { restoreFetch() }
  })

  it('user() throws InvalidStateException when no session is in context', async () => {
    try {
      const provider = new GitHubProvider(baseConfig)
      await assert.rejects(
        async () => provider.user({ query: { code: 'auth-code', state: 'whatever' } }),
        InvalidStateException,
      )
    } finally { restoreFetch() }
  })

  it('.stateless() user() skips state validation entirely', async () => {
    try {
      const provider = new GitHubProvider(baseConfig).stateless()
      // No session, no state — would fail in stateful mode
      const user = await provider.user({ query: { code: 'auth-code' } })
      assert.ok(user instanceof SocialUser)
    } finally { restoreFetch() }
  })

  it('Apple validates state from form_post body when query is empty', async () => {
    try {
      // Apple's user() now requires a verified id_token; mock both endpoints
      // and use the proper appleConfig (teamId/keyId/privateKey).
      AppleProvider._resetJwksCache()
      const idToken = signTestIdToken({ sub: 'apple-state-test' })
      global.fetch = (async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/auth/token')) {
          return new Response(JSON.stringify({ access_token: 'tok', id_token: idToken }), { status: 200 })
        }
        if (url.includes('/auth/keys')) {
          return new Response(JSON.stringify({ keys: [_APPLE_JWK] }), { status: 200 })
        }
        throw new Error(`Unmocked: ${url}`)
      }) as typeof fetch

      const session = makeSession()
      session.put('socialite_state:apple', 'apple-state')
      const provider = new AppleProvider(appleConfig)

      // Apple posts back to the redirect_uri as form_post — state lives in
      // the body, not the query.
      const user = await _runWithSession(session, () =>
        provider.user({
          query: {},
          body:  { code: 'auth-code', state: 'apple-state' },
        }),
      )
      assert.ok(user instanceof SocialUser)
      assert.strictEqual(session.get('socialite_state:apple'), undefined)
    } finally { restoreFetch() }
  })

  it('Apple rejects mismatched state in form_post body', async () => {
    try {
      // State mismatch throws InvalidStateException before any HTTP call —
      // baseConfig is fine here; no token/JWKS mocking needed.
      const session = makeSession()
      session.put('socialite_state:apple', 'real')
      const provider = new AppleProvider(baseConfig)

      await assert.rejects(
        async () => _runWithSession(session, () =>
          provider.user({ query: {}, body: { code: 'c', state: 'fake' } }),
        ),
        InvalidStateException,
      )
    } finally { restoreFetch() }
  })

  it('different providers use independent state slots', () => {
    try {
      const session = makeSession()
      const github   = new GitHubProvider(baseConfig)
      const google   = new GoogleProvider(baseConfig)

      _runWithSession(session, () => {
        github.getRedirectUrl()
        google.getRedirectUrl()
      })
      const ghState = session.get<string>('socialite_state:github')
      const ggState = session.get<string>('socialite_state:google')
      assert.ok(ghState && ggState)
      assert.notStrictEqual(ghState, ggState,
        'distinct CSPRNG draws — concurrent OAuth flows mustn\'t collide')
    } finally { restoreFetch() }
  })
})
