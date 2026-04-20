import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  auth,
  AuthProvider,
  Auth,
  AuthManager,
  SessionGuard,
  EloquentUserProvider,
  RequireAuth,
  AuthMiddleware,
  Gate,
  Policy,
  AuthorizationError,
  PasswordBroker,
  MemoryTokenRepository,
  runWithAuth,
  toAuthenticatable,
  BaseAuthController,
  type AuthConfig,
  type Authenticatable,
} from './index.js'
import { Router } from '@rudderjs/router'

// ─── Test Fixtures ────────────────────────────────────────

const TEST_PASSWORD_HASH = '$2b$04$hashed'

function fakeUser(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: TEST_PASSWORD_HASH, rememberToken: null, ...overrides }
}

function fakeModel(users: Record<string, unknown>[]) {
  return {
    find: async (id: string | number) => users.find(u => u['id'] === String(id)) ?? null,
    query: () => {
      const filters: Record<string, unknown> = {}
      const builder = {
        where(col: string, val: unknown) { filters[col] = val; return builder },
        async first() {
          return users.find(u => Object.entries(filters).every(([k, v]) => u[k] === v)) ?? null
        },
      }
      return builder
    },
  }
}

function fakeSession(): { store: Record<string, unknown>; instance: { get<T>(k: string, f?: T): T | undefined; put(k: string, v: unknown): void; forget(k: string): void; regenerate(): Promise<void> } } {
  const store: Record<string, unknown> = {}
  return {
    store,
    instance: {
      get<T>(key: string, fallback?: T): T | undefined {
        return (key in store ? store[key] : fallback) as T | undefined
      },
      put(key: string, value: unknown) { store[key] = value },
      forget(key: string) { delete store[key] },
      async regenerate() { /* no-op in tests */ },
    },
  }
}

const alwaysTrue = async (_p: string, _h: string) => true
const alwaysFalse = async (_p: string, _h: string) => false

function makeConfig(model: unknown): AuthConfig {
  return {
    defaults: { guard: 'web' },
    guards: { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model } },
  }
}

// ─── toAuthenticatable ────────────────────────────────────

describe('toAuthenticatable', () => {
  it('wraps a plain record with Authenticatable methods', () => {
    const record = fakeUser()
    const auth = toAuthenticatable(record)
    assert.strictEqual(auth.getAuthIdentifier(), '1')
    assert.strictEqual(auth.getAuthPassword(), TEST_PASSWORD_HASH)
    assert.strictEqual(auth.getRememberToken(), null)
  })

  it('setRememberToken updates the record', () => {
    const record = fakeUser()
    const auth = toAuthenticatable(record)
    auth.setRememberToken('abc')
    assert.strictEqual(auth.getRememberToken(), 'abc')
  })
})

// ─── EloquentUserProvider ─────────────────────────────────

describe('EloquentUserProvider', () => {
  const users = [fakeUser(), fakeUser({ id: '2', email: 'jane@example.com' })]
  const model = fakeModel(users)
  const provider = new EloquentUserProvider(model, alwaysTrue)

  it('retrieveById returns user when found', async () => {
    const user = await provider.retrieveById('1')
    assert.ok(user)
    assert.strictEqual(user.getAuthIdentifier(), '1')
  })

  it('retrieveById returns null when not found', async () => {
    assert.strictEqual(await provider.retrieveById('999'), null)
  })

  it('retrieveByCredentials finds by email', async () => {
    const user = await provider.retrieveByCredentials({ email: 'jane@example.com', password: 'x' })
    assert.ok(user)
    assert.strictEqual(user.getAuthIdentifier(), '2')
  })

  it('retrieveByCredentials returns null for no match', async () => {
    assert.strictEqual(await provider.retrieveByCredentials({ email: 'nope@x.com' }), null)
  })

  it('retrieveByCredentials returns null when only password given', async () => {
    assert.strictEqual(await provider.retrieveByCredentials({ password: 'x' }), null)
  })

  it('validateCredentials delegates to hashCheck', async () => {
    const auth = toAuthenticatable(fakeUser())
    const providerTrue = new EloquentUserProvider(model, alwaysTrue)
    assert.strictEqual(await providerTrue.validateCredentials(auth, { password: 'any' }), true)

    const providerFalse = new EloquentUserProvider(model, alwaysFalse)
    assert.strictEqual(await providerFalse.validateCredentials(auth, { password: 'any' }), false)
  })

  it('validateCredentials returns false for non-string password', async () => {
    const auth = toAuthenticatable(fakeUser())
    assert.strictEqual(await provider.validateCredentials(auth, { password: 123 as unknown }), false)
  })
})

// ─── SessionGuard ─────────────────────────────────────────

describe('SessionGuard', () => {
  it('user() returns null when no session', async () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)
    assert.strictEqual(await guard.user(), null)
  })

  it('user() returns user when session has auth_user_id', async () => {
    const sess = fakeSession()
    sess.store['auth_user_id'] = '1'
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    const user = await guard.user()
    assert.ok(user)
    assert.strictEqual(user.getAuthIdentifier(), '1')
  })

  it('check() / guest() reflect auth state', async () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    assert.strictEqual(await guard.check(), false)
    assert.strictEqual(await guard.guest(), true)

    sess.store['auth_user_id'] = '1'
    // Need a fresh guard since user is cached
    const guard2 = new SessionGuard(provider, sess.instance)
    assert.strictEqual(await guard2.check(), true)
    assert.strictEqual(await guard2.guest(), false)
  })

  it('attempt() with valid credentials logs in', async () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    const result = await guard.attempt({ email: 'john@example.com', password: 'secret' })
    assert.strictEqual(result, true)
    assert.strictEqual(sess.store['auth_user_id'], '1')
    assert.strictEqual(await guard.check(), true)
  })

  it('attempt() with invalid credentials returns false', async () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysFalse)
    const guard = new SessionGuard(provider, sess.instance)

    const result = await guard.attempt({ email: 'john@example.com', password: 'wrong' })
    assert.strictEqual(result, false)
    assert.strictEqual(sess.store['auth_user_id'], undefined)
  })

  it('attempt() with unknown user returns false', async () => {
    const sess = fakeSession()
    const model = fakeModel([])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    const result = await guard.attempt({ email: 'ghost@x.com', password: 'any' })
    assert.strictEqual(result, false)
  })

  it('login() sets session and caches user', async () => {
    const sess = fakeSession()
    const model = fakeModel([])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    const user = toAuthenticatable(fakeUser())
    await guard.login(user)
    assert.strictEqual(sess.store['auth_user_id'], '1')
    assert.strictEqual(await guard.id(), '1')
  })

  it('logout() clears session and user', async () => {
    const sess = fakeSession()
    sess.store['auth_user_id'] = '1'
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)

    await guard.user() // load
    await guard.logout()
    assert.strictEqual(sess.store['auth_user_id'], undefined)
    assert.strictEqual(await guard.user(), null)
  })

  it('id() returns null when not authenticated', async () => {
    const sess = fakeSession()
    const model = fakeModel([])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const guard = new SessionGuard(provider, sess.instance)
    assert.strictEqual(await guard.id(), null)
  })
})

// ─── AuthManager ──────────────────────────────────────────

describe('AuthManager', () => {
  it('guard() returns the default guard', () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const config = makeConfig(model)
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    const guard = manager.guard()
    assert.ok(guard instanceof SessionGuard)
  })

  it('guard() returns a fresh instance each call (no cross-request _user leak)', () => {
    // AuthManager is a process-wide DI singleton. Caching guards on it would
    // pin SessionGuard._user across requests — once any request signs in,
    // every subsequent request would see that user as "still logged in" even
    // against an empty session. Fresh instances scope _user to the local
    // variable the caller stores, which is request-natural.
    const sess = fakeSession()
    const config = makeConfig(fakeModel([]))
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    assert.notStrictEqual(manager.guard('web'), manager.guard('web'))
  })

  it('guard() does not leak user state across simulated requests', async () => {
    // Regression test for the pre-fix bug: a cached SessionGuard would hold
    // `_user` from a prior request, and the next request would see that user
    // as still logged in even after logout / fresh cookie / different user.
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const config = makeConfig(model)
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    // Request 1: user is signed in (session has auth_user_id).
    sess.store['auth_user_id'] = '1'
    const guard1 = manager.guard()
    const user1 = await guard1.user()
    assert.ok(user1)
    assert.strictEqual(user1.getAuthIdentifier(), '1')

    // Request 2: session is cleared (like a fresh browser with no cookie).
    // A leaked cache would return user 1 here; the fix returns null.
    delete sess.store['auth_user_id']
    const guard2 = manager.guard()
    const user2 = await guard2.user()
    assert.strictEqual(user2, null)
  })

  it('guard() throws for unknown guard', () => {
    const sess = fakeSession()
    const config = makeConfig(fakeModel([]))
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    assert.throws(() => manager.guard('api'), /Guard "api" is not defined/)
  })

  it('throws for unknown provider', () => {
    const sess = fakeSession()
    const config: AuthConfig = {
      defaults: { guard: 'web' },
      guards: { web: { driver: 'session', provider: 'missing' } },
      providers: {},
    }
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)
    assert.throws(() => manager.guard(), /User provider "missing" is not defined/)
  })
})

// ─── Auth Facade (via runWithAuth) ─────────���──────────────

describe('Auth facade', () => {
  it('attempt + user within runWithAuth', async () => {
    const sess = fakeSession()
    const model = fakeModel([fakeUser()])
    const config = makeConfig(model)
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    await runWithAuth(manager, async () => {
      assert.strictEqual(await Auth.check(), false)
      const ok = await Auth.attempt({ email: 'john@example.com', password: 'secret' })
      assert.strictEqual(ok, true)
      assert.strictEqual(await Auth.check(), true)

      const user = await Auth.user()
      assert.ok(user)
      assert.strictEqual(user.getAuthIdentifier(), '1')
      assert.strictEqual(await Auth.id(), '1')
    })
  })

  it('logout within runWithAuth', async () => {
    const sess = fakeSession()
    sess.store['auth_user_id'] = '1'
    const model = fakeModel([fakeUser()])
    const config = makeConfig(model)
    const manager = new AuthManager(config, alwaysTrue, () => sess.instance)

    await runWithAuth(manager, async () => {
      assert.strictEqual(await Auth.check(), true)
      await Auth.logout()
      assert.strictEqual(await Auth.check(), false)
      assert.strictEqual(await Auth.guest(), true)
    })
  })

  it('throws outside runWithAuth', () => {
    assert.throws(() => Auth.check(), /No auth context/)
  })
})

// ─── AuthProvider ─────────────────────────────────────────

describe('AuthProvider', () => {
  it('is a class', () => {
    assert.strictEqual(typeof AuthProvider, 'function')
    assert.strictEqual(AuthProvider.name, 'AuthProvider')
  })
})

// ─── Middleware shape ─────────────────────────────────────

describe('AuthMiddleware()', () => {
  it('returns a function', () => {
    assert.strictEqual(typeof AuthMiddleware(), 'function')
  })
})

describe('RequireAuth()', () => {
  it('returns a function', () => {
    assert.strictEqual(typeof RequireAuth(), 'function')
  })
})

// ─── Gate ─────────────────────────────────────────────────

function authUser(overrides?: Record<string, unknown>): Authenticatable & Record<string, unknown> {
  return toAuthenticatable(fakeUser(overrides))
}

describe('Gate', () => {
  beforeEach(() => Gate.reset())

  it('define + allows with closure', async () => {
    Gate.define('edit-settings', (user) => (user as unknown as Record<string, unknown>)['role'] === 'admin')
    const admin = authUser({ role: 'admin' })
    const regular = authUser({ role: 'user' })

    assert.strictEqual(await Gate.forUser(admin).allows('edit-settings'), true)
    assert.strictEqual(await Gate.forUser(regular).allows('edit-settings'), false)
  })

  it('denies is the inverse of allows', async () => {
    Gate.define('do-thing', () => true)
    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).denies('do-thing'), false)
  })

  it('undefined ability returns false', async () => {
    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).allows('nonexistent'), false)
  })

  it('authorize throws AuthorizationError on denial', async () => {
    Gate.define('restricted', () => false)
    const user = authUser()
    await assert.rejects(
      () => Gate.forUser(user).authorize('restricted'),
      (err: unknown) => {
        assert.ok(err instanceof AuthorizationError)
        assert.strictEqual((err as AuthorizationError).status, 403)
        return true
      },
    )
  })

  it('authorize passes when allowed', async () => {
    Gate.define('open', () => true)
    const user = authUser()
    await assert.doesNotReject(() => Gate.forUser(user).authorize('open'))
  })

  it('before callback can short-circuit to true', async () => {
    Gate.define('anything', () => false)
    Gate.before((user) => {
      if ((user as unknown as Record<string, unknown>)['role'] === 'super-admin') return true
      return undefined
    })

    const superAdmin = authUser({ role: 'super-admin' })
    const regular = authUser({ role: 'user' })

    assert.strictEqual(await Gate.forUser(superAdmin).allows('anything'), true)
    assert.strictEqual(await Gate.forUser(regular).allows('anything'), false)
  })

  it('before callback can short-circuit to false', async () => {
    Gate.define('open', () => true)
    Gate.before(() => false)

    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).allows('open'), false)
  })

  it('before returning null/undefined falls through', async () => {
    Gate.define('check', () => true)
    Gate.before(() => null)

    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).allows('check'), true)
  })

  it('async ability callback', async () => {
    Gate.define('async-check', async () => {
      await Promise.resolve()
      return true
    })
    assert.strictEqual(await Gate.forUser(authUser()).allows('async-check'), true)
  })

  it('ability receives extra arguments', async () => {
    Gate.define('update-post', (_user, post) => (post as Record<string, unknown>)['authorId'] === '1')
    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).allows('update-post', { authorId: '1' }), true)
    assert.strictEqual(await Gate.forUser(user).allows('update-post', { authorId: '2' }), false)
  })

  it('Gate.define accepts a callback with typed args (no cast)', async () => {
    // Regression: an `(user, ...args: unknown[])` callback type rejected
    // every narrowed callable via contravariance. The generic TArgs overload
    // lets callers declare their own shape without `as unknown as …`.
    interface Post { authorId: string; role?: string }
    Gate.define<[Post]>('edit-post', (_user, post) => post.role === 'admin')
    const user = authUser()
    assert.strictEqual(await Gate.forUser(user).allows('edit-post', { authorId: '1', role: 'admin' }), true)
    assert.strictEqual(await Gate.forUser(user).allows('edit-post', { authorId: '2', role: 'user' }),  false)
  })

  it('reset clears all definitions', () => {
    Gate.define('x', () => true)
    Gate.before(() => true)
    Gate.reset()
    // After reset, no abilities exist — should return false (no user in context, but forUser works)
    // We can verify reset worked by checking a fresh define works
    Gate.define('y', () => true)
    assert.doesNotThrow(() => Gate.reset())
  })
})

// ─── Policy ───────────────────────────────────────────────

class Post {
  constructor(public authorId: string, public published: boolean) {}
}

class PostPolicy extends Policy {
  view(user: Authenticatable, post: Post) {
    return post.published || (user as unknown as Record<string, unknown>)['id'] === post.authorId
  }

  update(user: Authenticatable, post: Post) {
    return (user as unknown as Record<string, unknown>)['id'] === post.authorId
  }

  delete(user: Authenticatable) {
    return (user as unknown as Record<string, unknown>)['role'] === 'admin'
  }
}

class PostPolicyWithBefore extends Policy {
  before(user: Authenticatable) {
    if ((user as unknown as Record<string, unknown>)['role'] === 'super-admin') return true
    return undefined
  }

  update(_user: Authenticatable, _post: Post) {
    return false
  }
}

describe('Policy', () => {
  beforeEach(() => Gate.reset())

  it('routes ability to policy method via model instance', async () => {
    Gate.policy(Post, PostPolicy)
    const author = authUser({ id: '1' })
    const post = new Post('1', false)

    assert.strictEqual(await Gate.forUser(author).allows('update', post), true)
  })

  it('policy method receives the model instance', async () => {
    Gate.policy(Post, PostPolicy)
    const viewer = authUser({ id: '2' })
    const post = new Post('1', true)

    assert.strictEqual(await Gate.forUser(viewer).allows('view', post), true)
  })

  it('policy method returns false when not authorized', async () => {
    Gate.policy(Post, PostPolicy)
    const other = authUser({ id: '2' })
    const post = new Post('1', false)

    assert.strictEqual(await Gate.forUser(other).allows('update', post), false)
  })

  it('policy.before can short-circuit', async () => {
    Gate.policy(Post, PostPolicyWithBefore)
    const superAdmin = authUser({ role: 'super-admin' })
    const post = new Post('999', false)

    // update() returns false, but before() returns true for super-admin
    assert.strictEqual(await Gate.forUser(superAdmin).allows('update', post), true)
  })

  it('policy.before returning undefined falls through', async () => {
    Gate.policy(Post, PostPolicyWithBefore)
    const regular = authUser({ id: '1', role: 'user' })
    const post = new Post('1', false)

    // before() returns undefined, update() returns false
    assert.strictEqual(await Gate.forUser(regular).allows('update', post), false)
  })

  it('undefined policy method returns false', async () => {
    Gate.policy(Post, PostPolicy)
    const user = authUser()
    const post = new Post('1', true)

    assert.strictEqual(await Gate.forUser(user).allows('nonexistent', post), false)
  })

  it('delete ability checks role', async () => {
    Gate.policy(Post, PostPolicy)
    const admin = authUser({ role: 'admin' })
    const regular = authUser({ role: 'user' })
    const post = new Post('1', true)

    assert.strictEqual(await Gate.forUser(admin).allows('delete', post), true)
    assert.strictEqual(await Gate.forUser(regular).allows('delete', post), false)
  })

  it('Gate.authorize with policy throws on denial', async () => {
    Gate.policy(Post, PostPolicy)
    const other = authUser({ id: '2', role: 'user' })
    const post = new Post('1', false)

    await assert.rejects(
      () => Gate.forUser(other).authorize('update', post),
      (err: unknown) => err instanceof AuthorizationError,
    )
  })

  it('global before runs before policy', async () => {
    Gate.policy(Post, PostPolicy)
    Gate.before((user) => {
      if ((user as unknown as Record<string, unknown>)['role'] === 'god') return true
      return undefined
    })

    const god = authUser({ role: 'god' })
    const post = new Post('999', false)

    assert.strictEqual(await Gate.forUser(god).allows('update', post), true)
  })
})

// ─── AuthorizationError ───────────────────────────────────

describe('AuthorizationError', () => {
  it('has status 403', () => {
    const err = new AuthorizationError()
    assert.strictEqual(err.status, 403)
    assert.strictEqual(err.name, 'AuthorizationError')
  })

  it('accepts a custom message', () => {
    const err = new AuthorizationError('Nope')
    assert.strictEqual(err.message, 'Nope')
  })
})

// ─── PasswordBroker ───────────────────────────────────────

function makePasswordBroker(users: Record<string, unknown>[], config?: { expire?: number; throttle?: number }) {
  const model = fakeModel(users)
  const provider = new EloquentUserProvider(model, alwaysTrue)
  const tokens = new MemoryTokenRepository()
  return { broker: new PasswordBroker(tokens, provider, config), tokens }
}

describe('PasswordBroker', () => {
  it('sendResetLink returns INVALID_USER for unknown email', async () => {
    const { broker } = makePasswordBroker([])
    const status = await broker.sendResetLink(
      { email: 'ghost@x.com' },
      async () => {},
    )
    assert.strictEqual(status, 'INVALID_USER')
  })

  it('sendResetLink sends token and returns RESET_LINK_SENT', async () => {
    const { broker } = makePasswordBroker([fakeUser()])
    let sentToken = ''
    const status = await broker.sendResetLink(
      { email: 'john@example.com' },
      async (_user, token) => { sentToken = token },
    )
    assert.strictEqual(status, 'RESET_LINK_SENT')
    assert.ok(sentToken.length > 0)
  })

  it('sendResetLink throttles repeated requests', async () => {
    const { broker } = makePasswordBroker([fakeUser()], { throttle: 60 })

    await broker.sendResetLink({ email: 'john@example.com' }, async () => {})
    const status = await broker.sendResetLink({ email: 'john@example.com' }, async () => {})
    assert.strictEqual(status, 'THROTTLED')
  })

  it('reset returns PASSWORD_RESET on valid token', async () => {
    const { broker } = makePasswordBroker([fakeUser()])
    let capturedToken = ''
    await broker.sendResetLink(
      { email: 'john@example.com' },
      async (_user, token) => { capturedToken = token },
    )

    let resetCalled = false
    const status = await broker.reset(
      { email: 'john@example.com', token: capturedToken, password: 'new-password' },
      async (_user, password) => { resetCalled = true; assert.strictEqual(password, 'new-password') },
    )
    assert.strictEqual(status, 'PASSWORD_RESET')
    assert.strictEqual(resetCalled, true)
  })

  it('reset returns INVALID_USER for unknown email', async () => {
    const { broker } = makePasswordBroker([])
    const status = await broker.reset(
      { email: 'ghost@x.com', token: 'abc', password: 'x' },
      async () => {},
    )
    assert.strictEqual(status, 'INVALID_USER')
  })

  it('reset returns INVALID_TOKEN when no token exists', async () => {
    const { broker } = makePasswordBroker([fakeUser()])
    const status = await broker.reset(
      { email: 'john@example.com', token: 'bad', password: 'x' },
      async () => {},
    )
    assert.strictEqual(status, 'INVALID_TOKEN')
  })

  it('reset returns INVALID_TOKEN for wrong token', async () => {
    const { broker } = makePasswordBroker([fakeUser()])
    await broker.sendResetLink({ email: 'john@example.com' }, async () => {})

    const status = await broker.reset(
      { email: 'john@example.com', token: 'wrong-token', password: 'x' },
      async () => {},
    )
    assert.strictEqual(status, 'INVALID_TOKEN')
  })

  it('reset returns TOKEN_EXPIRED for expired token', async () => {
    // Use a custom token repo that backdates createdAt
    const model = fakeModel([fakeUser()])
    const provider = new EloquentUserProvider(model, alwaysTrue)
    const tokens = new MemoryTokenRepository()
    const broker = new PasswordBroker(tokens, provider, { expire: 1 }) // 1 minute

    let capturedToken = ''
    await broker.sendResetLink(
      { email: 'john@example.com' },
      async (_user, token) => { capturedToken = token },
    )

    // Manually backdate: delete and re-create with old createdAt
    const record = await tokens.find('john@example.com')
    assert.ok(record)
    await tokens.delete('john@example.com')
    // Create with a createdAt 2 minutes in the past by manipulating store directly
    ;(tokens as unknown as { store: Map<string, { token: string; createdAt: Date; expiresAt: Date }> }).store.set('john@example.com', {
      token: record.token,
      createdAt: new Date(Date.now() - 2 * 60_000), // 2 min ago
      expiresAt: new Date(Date.now() - 60_000),
    })

    const status = await broker.reset(
      { email: 'john@example.com', token: capturedToken, password: 'x' },
      async () => {},
    )
    assert.strictEqual(status, 'TOKEN_EXPIRED')
  })

  it('reset deletes token after successful reset', async () => {
    const { broker, tokens } = makePasswordBroker([fakeUser()])
    let capturedToken = ''
    await broker.sendResetLink(
      { email: 'john@example.com' },
      async (_user, token) => { capturedToken = token },
    )

    await broker.reset(
      { email: 'john@example.com', token: capturedToken, password: 'new' },
      async () => {},
    )

    // Token should be deleted
    assert.strictEqual(await tokens.find('john@example.com'), null)
  })
})

// ─── MemoryTokenRepository ────────────────────────────────

describe('MemoryTokenRepository', () => {
  it('create + find round-trips', async () => {
    const repo = new MemoryTokenRepository()
    await repo.create('a@b.com', 'hashed', new Date(Date.now() + 60_000))
    const record = await repo.find('a@b.com')
    assert.ok(record)
    assert.strictEqual(record.token, 'hashed')
  })

  it('find returns null for missing email', async () => {
    const repo = new MemoryTokenRepository()
    assert.strictEqual(await repo.find('missing@x.com'), null)
  })

  it('delete removes the token', async () => {
    const repo = new MemoryTokenRepository()
    await repo.create('a@b.com', 'hashed', new Date(Date.now() + 60_000))
    await repo.delete('a@b.com')
    assert.strictEqual(await repo.find('a@b.com'), null)
  })

  it('deleteExpired removes only expired tokens', async () => {
    const repo = new MemoryTokenRepository()
    await repo.create('old@x.com', 'h1', new Date(Date.now() - 1000))
    await repo.create('new@x.com', 'h2', new Date(Date.now() + 60_000))
    await repo.deleteExpired()
    assert.strictEqual(await repo.find('old@x.com'), null)
    assert.ok(await repo.find('new@x.com'))
  })
})

// ─── BaseAuthController ───────────────────────────────────

describe('BaseAuthController', () => {
  it('subclass inherits @Controller prefix and @Post routes from the base', () => {
    class AuthController extends BaseAuthController {
      protected userModel = {
        query: () => ({ where: () => ({ first: async () => null }) }),
        create: async (attrs: Record<string, unknown>) => ({ id: '1', ...attrs }),
        update: async () => ({}),
      }
      protected hash = {
        make:  async (p: string) => `hashed:${p}`,
        check: async () => true,
      }
    }

    const router = new Router()
    router.registerController(AuthController)

    const paths = router.list().map(r => `${r.method} ${r.path}`).sort()
    assert.deepStrictEqual(paths, [
      'POST /api/auth/request-password-reset',
      'POST /api/auth/reset-password',
      'POST /api/auth/sign-in/email',
      'POST /api/auth/sign-out',
      'POST /api/auth/sign-up/email',
    ])
  })

  it('subclass method overrides win over inherited handlers', async () => {
    class AuthController extends BaseAuthController {
      protected userModel = {
        query: () => ({ where: () => ({ first: async () => null }) }),
        create: async (attrs: Record<string, unknown>) => ({ id: '1', ...attrs }),
        update: async () => ({}),
      }
      protected hash = {
        make:  async (p: string) => `hashed:${p}`,
        check: async () => true,
      }

      override async signOut(_req: unknown, res: { json: (b: unknown) => void }): Promise<void> {
        res.json({ custom: true })
      }
    }

    const router = new Router()
    router.registerController(AuthController)
    const signOut = router.list().find(r => r.path === '/api/auth/sign-out')!

    let body: unknown = null
    await signOut.handler(
      {} as never,
      { json: (b: unknown) => { body = b }, status: () => ({ json: () => {} }) } as never,
    )
    assert.deepStrictEqual(body, { custom: true })
  })
})
