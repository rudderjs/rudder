import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { dispatcher } from '@rudderjs/core'
import {
  SessionGuard,
  EloquentUserProvider,
  PasswordBroker,
  MemoryTokenRepository,
  BaseAuthController,
  AuthManager,
  runWithAuth,
  Attempting,
  Validated,
  Login,
  Failed,
  Logout,
  Registered,
  PasswordReset,
  type Authenticatable,
  type AuthConfig,
  type UserProvider,
} from './index.js'

// ─── Fixtures ─────────────────────────────────────────────

const PASS_HASH = '$2b$04$hashed'

function fakeUser(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: PASS_HASH, rememberToken: null, ...overrides }
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

function fakeSession() {
  const store: Record<string, unknown> = {}
  return {
    store,
    instance: {
      get<T>(key: string, fallback?: T): T | undefined {
        return (key in store ? store[key] : fallback) as T | undefined
      },
      put(key: string, value: unknown) { store[key] = value },
      forget(key: string) { delete store[key] },
      async regenerate() { /* no-op for tests */ },
    },
  }
}

function authenticatable(id: string): Authenticatable {
  return {
    getAuthIdentifier: () => id,
    getAuthPassword: () => PASS_HASH,
    getRememberToken: () => null,
    setRememberToken: () => {},
  }
}

interface FakeRes {
  statusCode: number
  body:       unknown
  status:     (code: number) => FakeRes
  json:       (b: unknown) => void
}

function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 200,
    body:       undefined,
    status(code: number) { r.statusCode = code; return r },
    json(b: unknown)     { r.body = b },
  }
  return r
}

// ─── Event capture ────────────────────────────────────────
//
// A single wildcard listener records every dispatched event. The global
// dispatcher is reset before each test so listeners never accumulate across
// runs (or across other test files sharing the process).

const captured: object[] = []
const names = () => captured.map(e => e.constructor.name)

beforeEach(() => {
  dispatcher.reset()
  captured.length = 0
  dispatcher.register('*', { handle: (e) => { captured.push(e as object) } })
})

// ─── Guard events ─────────────────────────────────────────

describe('SessionGuard lifecycle events', () => {
  it('attempt() success fires Attempting → Validated → Login', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => true), fakeSession().instance)

    const ok = await guard.attempt({ email: 'john@example.com', password: 'secret' }, true)

    assert.equal(ok, true)
    assert.deepEqual(names(), ['Attempting', 'Validated', 'Login'])

    const attempting = captured[0] as Attempting
    assert.equal(attempting.remember, true)
    assert.equal((attempting.credentials as { email: string }).email, 'john@example.com')

    const validated = captured[1] as Validated
    assert.equal(validated.user.getAuthIdentifier(), '1')

    const login = captured[2] as Login
    assert.equal(login.remember, true)
    assert.equal(login.user.getAuthIdentifier(), '1')
  })

  it('attempt() with no remember flag sets Login.remember = false', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => true), fakeSession().instance)
    await guard.attempt({ email: 'john@example.com', password: 'secret' })
    assert.equal((captured.find(e => e instanceof Login) as Login).remember, false)
  })

  it('attempt() with unknown user fires Attempting → Failed(null), no Validated/Login', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([]), async () => true), fakeSession().instance)

    const ok = await guard.attempt({ email: 'ghost@x.com', password: 'any' })

    assert.equal(ok, false)
    assert.deepEqual(names(), ['Attempting', 'Failed'])
    assert.equal((captured[1] as Failed).user, null)
  })

  it('attempt() with wrong password fires Failed carrying the matched user', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => false), fakeSession().instance)

    const ok = await guard.attempt({ email: 'john@example.com', password: 'wrong' })

    assert.equal(ok, false)
    assert.deepEqual(names(), ['Attempting', 'Failed'])
    const failed = captured[1] as Failed
    assert.ok(failed.user)
    assert.equal(failed.user!.getAuthIdentifier(), '1')
  })

  it('login() fires Login', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => true), fakeSession().instance)
    await guard.login(authenticatable('7'))
    assert.deepEqual(names(), ['Login'])
    assert.equal((captured[0] as Login).user.getAuthIdentifier(), '7')
  })

  it('logout() fires Logout carrying the previously-authenticated user', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => true), fakeSession().instance)
    await guard.login(authenticatable('1'))
    captured.length = 0

    await guard.logout()

    assert.deepEqual(names(), ['Logout'])
    assert.equal((captured[0] as Logout).user!.getAuthIdentifier(), '1')
  })

  it('once() fires Attempting → Validated but NOT Login (no session write)', async () => {
    const guard = new SessionGuard(new EloquentUserProvider(fakeModel([fakeUser()]), async () => true), fakeSession().instance)

    const ok = await guard.once({ email: 'john@example.com', password: 'secret' })

    assert.equal(ok, true)
    assert.deepEqual(names(), ['Attempting', 'Validated'])
  })

  it('loginViaRememberCookie() fires Login(remember = true)', async () => {
    const provider = {
      retrieveByToken: async () => authenticatable('1'),
    } as unknown as UserProvider
    const guard = new SessionGuard(provider, fakeSession().instance)

    const ok = await guard.loginViaRememberCookie('1', 'token')

    assert.equal(ok, true)
    assert.deepEqual(names(), ['Login'])
    assert.equal((captured[0] as Login).remember, true)
  })
})

// ─── Password reset event ─────────────────────────────────

describe('PasswordBroker fires PasswordReset', () => {
  it('dispatches PasswordReset with the resolved user on a successful reset', async () => {
    const user = authenticatable('42')
    const users = {
      retrieveByCredentials: async () => user,
      updateRememberToken: async () => {},
    } as unknown as UserProvider
    const broker = new PasswordBroker(new MemoryTokenRepository(), users, { secret: 'x'.repeat(32) })

    let plainToken = ''
    await broker.sendResetLink({ email: 'john@example.com' }, async (_u, t) => { plainToken = t })
    captured.length = 0

    const status = await broker.reset(
      { email: 'john@example.com', token: plainToken, password: 'newpassword' },
      async () => {},
    )

    assert.equal(status, 'PASSWORD_RESET')
    assert.deepEqual(names(), ['PasswordReset'])
    assert.equal((captured[0] as PasswordReset).user.getAuthIdentifier(), '42')
  })

  it('does NOT fire PasswordReset on an invalid token', async () => {
    const user = authenticatable('42')
    const users = { retrieveByCredentials: async () => user } as unknown as UserProvider
    const broker = new PasswordBroker(new MemoryTokenRepository(), users, { secret: 'x'.repeat(32) })

    const status = await broker.reset(
      { email: 'john@example.com', token: 'bogus', password: 'newpassword' },
      async () => {},
    )

    assert.equal(status, 'INVALID_TOKEN')
    assert.equal(captured.some(e => e instanceof PasswordReset), false)
  })
})

// ─── Registered event ─────────────────────────────────────

describe('BaseAuthController fires Registered on sign-up', () => {
  class TestAuthController extends BaseAuthController {
    protected userModel = {
      query:  () => ({ where: () => ({ first: async () => null }) }),
      create: async (attrs: Record<string, unknown>) => ({ id: '99', ...attrs }),
      update: async () => ({}),
    }
    protected hash = {
      make:  async (p: string) => `hashed:${p}`,
      check: async () => true,
    }
  }

  const config: AuthConfig = {
    defaults:  { guard: 'web' },
    guards:    { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model: fakeModel([]) } },
  }

  it('dispatches Registered carrying the new user after a successful sign-up', async () => {
    const manager = new AuthManager(config, async () => true, () => fakeSession().instance, async (p) => `hashed:${p}`)
    const ctrl = new TestAuthController()
    const res  = fakeRes()

    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signUp({ body: { name: 'Ann', email: 'ann@x.com', password: 'longenough' } }, res),
    )

    const registered = captured.find(e => e instanceof Registered) as Registered | undefined
    assert.ok(registered, 'Registered event should have been dispatched')
    assert.equal(registered.user.getAuthIdentifier(), '99')
  })
})
