import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Socialite,
  SocialUser,
  SocialiteProvider,
  GitHubProvider,
  GoogleProvider,
  FacebookProvider,
  AppleProvider,
  socialite,
  type SocialiteProviderConfig,
} from './index.js'

const baseConfig: SocialiteProviderConfig = {
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

  it('extend() registers a custom provider', () => {
    class CustomProvider extends SocialiteProvider {
      protected defaultScopes() { return [] }
      protected authUrl() { return 'https://custom.example.com/auth' }
      protected tokenUrl() { return 'https://custom.example.com/token' }
      protected userUrl() { return 'https://custom.example.com/user' }
      protected mapToUser(data: Record<string, unknown>, token: string) {
        return new SocialUser({ id: String(data['id']), name: null, email: null, avatar: null, nickname: null, token, raw: data })
      }
    }

    Socialite.extend('custom', (c) => new CustomProvider(c))
    Socialite.configure({ custom: baseConfig })
    const provider = Socialite.driver('custom')
    assert.ok(provider instanceof CustomProvider)
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

// ─── socialite() provider ─────────────────────────────────

describe('socialite() provider', () => {
  it('is a function that returns a constructor', () => {
    assert.strictEqual(typeof socialite({}), 'function')
  })

  it('each call returns a different class', () => {
    assert.notStrictEqual(socialite({}), socialite({}))
  })
})
