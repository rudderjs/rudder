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
  type SocialiteDriverConfig,
} from './index.js'

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
  const provider = new GitHubProvider(baseConfig)

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
    const p = new GitHubProvider(baseConfig).withScopes(['repo'])
    const url = p.getRedirectUrl()
    assert.ok(url.includes('repo'))
    assert.ok(url.includes('read'))
  })

  it('setScopes replaces scopes', () => {
    const p = new GitHubProvider(baseConfig).setScopes(['repo'])
    const url = p.getRedirectUrl()
    assert.ok(url.includes('repo'))
    assert.ok(!url.includes('read%3Auser'))
  })
})

// ─── GoogleProvider ───────────────────────────────────────

describe('GoogleProvider', () => {
  const provider = new GoogleProvider(baseConfig)

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
  const provider = new FacebookProvider(baseConfig)

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
  const provider = new AppleProvider(baseConfig)

  it('generates a redirect URL to Apple with response_mode=form_post', () => {
    const url = provider.getRedirectUrl()
    assert.ok(url.startsWith('https://appleid.apple.com/'))
    assert.ok(url.includes('response_mode=form_post'))
    assert.ok(url.includes('client_id=test-client-id'))
  })
})

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
