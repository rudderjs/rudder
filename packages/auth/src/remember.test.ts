import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  newRememberToken,
  parseCookie,
  safeStringEqual,
  encodeRememberCookie,
  decodeRememberCookie,
  buildRememberCookie,
  rememberCookieAttrs,
  runWithRemember,
  setRememberDirective,
  takeRememberDirective,
} from './remember.js'
import { EloquentUserProvider, toAuthenticatable } from './providers.js'
import { SessionGuard } from './session-guard.js'
import { AuthMiddleware, Auth } from './index.js'
import { AuthManager, type AuthConfig } from './auth-manager.js'

const SECRET = 'test-remember-secret-32-chars-xx!'

// ─── Fakes ────────────────────────────────────────────────

function fakeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: 'h', rememberToken: null, ...overrides }
}

function fakeModel(users: Record<string, unknown>[]) {
  const updates: Array<{ id: string | number; data: Record<string, unknown> }> = []
  const model = {
    updates,
    find: async (id: string | number) => users.find(u => u['id'] === String(id)) ?? null,
    query: () => ({ where() { return this }, async first() { return null } }),
    async update(id: string | number, data: Record<string, unknown>) {
      updates.push({ id, data })
      const u = users.find(x => x['id'] === String(id))
      if (u) Object.assign(u, data)
    },
  }
  return model
}

function fakeSession() {
  const store: Record<string, unknown> = {}
  return {
    store,
    instance: {
      get<T>(key: string, fallback?: T): T | undefined { return (key in store ? store[key] : fallback) as T | undefined },
      put(key: string, value: unknown) { store[key] = value },
      forget(key: string) { delete store[key] },
      async regenerate() { /* no-op */ },
    },
  }
}

const noHashCheck = async () => false

// ─── Crypto ───────────────────────────────────────────────

describe('remember cookie crypto', () => {
  it('round-trips userId + token through encode/decode', () => {
    const token = newRememberToken()
    const value = encodeRememberCookie('42', token, SECRET)
    const decoded = decodeRememberCookie(value, SECRET)
    assert.deepStrictEqual(decoded, { userId: '42', token })
  })

  it('newRememberToken is 64 hex chars (256-bit) and unique', () => {
    const a = newRememberToken()
    const b = newRememberToken()
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.notStrictEqual(a, b)
  })

  it('rejects a cookie signed with a different secret', () => {
    const value = encodeRememberCookie('42', newRememberToken(), SECRET)
    assert.strictEqual(decodeRememberCookie(value, 'another-secret-entirely-32-chars'), null)
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = newRememberToken()
    const value = encodeRememberCookie('42', token, SECRET)
    const [body, sig] = value.split('.')
    // Swap the userId to '999' in the body, keep the old signature.
    const forgedBody = Buffer.from(JSON.stringify({ id: '999', token })).toString('base64url')
    assert.strictEqual(decodeRememberCookie(`${forgedBody}.${sig}`, SECRET), null)
    assert.ok(body && sig)
  })

  it('rejects a malformed cookie', () => {
    assert.strictEqual(decodeRememberCookie('not-a-cookie', SECRET), null)
    assert.strictEqual(decodeRememberCookie('', SECRET), null)
    assert.strictEqual(decodeRememberCookie('.sig', SECRET), null)
  })

  it('safeStringEqual is true for equal, false otherwise', () => {
    assert.strictEqual(safeStringEqual('abc', 'abc'), true)
    assert.strictEqual(safeStringEqual('abc', 'abd'), false)
    assert.strictEqual(safeStringEqual('abc', 'abcd'), false)
  })

  it('parseCookie reads a named cookie from a header', () => {
    assert.strictEqual(parseCookie('a=1; rudderjs_remember=xyz; b=2', 'rudderjs_remember'), 'xyz')
    assert.strictEqual(parseCookie('a=1', 'rudderjs_remember'), undefined)
  })

  it('buildRememberCookie sets a positive Max-Age on set and 0 on clear', () => {
    const attrs = rememberCookieAttrs({ sameSite: 'none', secure: false })
    const set = buildRememberCookie('value', attrs)
    assert.match(set, /rudderjs_remember=value/)
    assert.match(set, /Max-Age=\d{5,}/)
    assert.match(set, /HttpOnly/)
    assert.match(set, /; Secure/) // SameSite=None forces Secure
    const clear = buildRememberCookie(null, attrs)
    assert.match(clear, /rudderjs_remember=;/)
    assert.match(clear, /Max-Age=0/)
  })
})

// ─── Directive ALS ────────────────────────────────────────

describe('remember directive channel', () => {
  it('captures + consumes a directive within a scope', () => {
    runWithRemember(() => {
      setRememberDirective({ action: 'set', userId: '1', token: 't' })
      assert.deepStrictEqual(takeRememberDirective(), { action: 'set', userId: '1', token: 't' })
      // consumed — a second take is null
      assert.strictEqual(takeRememberDirective(), null)
    })
  })

  it('is a no-op outside a scope', () => {
    setRememberDirective({ action: 'clear' })
    assert.strictEqual(takeRememberDirective(), null)
  })
})

// ─── Provider ─────────────────────────────────────────────

describe('EloquentUserProvider remember support', () => {
  it('retrieveByToken matches the stored token', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const provider = new EloquentUserProvider(fakeModel(users) as never, noHashCheck)
    const user = await provider.retrieveByToken('1', 'stored-token')
    assert.ok(user)
    assert.strictEqual(user.getAuthIdentifier(), '1')
  })

  it('retrieveByToken returns null on token mismatch', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const provider = new EloquentUserProvider(fakeModel(users) as never, noHashCheck)
    assert.strictEqual(await provider.retrieveByToken('1', 'wrong-token'), null)
  })

  it('retrieveByToken returns null when the user has no stored token', async () => {
    const users = [fakeUser({ rememberToken: null })]
    const provider = new EloquentUserProvider(fakeModel(users) as never, noHashCheck)
    assert.strictEqual(await provider.retrieveByToken('1', 'anything'), null)
  })

  it('retrieveByToken returns null when the user is gone', async () => {
    const provider = new EloquentUserProvider(fakeModel([]) as never, noHashCheck)
    assert.strictEqual(await provider.retrieveByToken('999', 'x'), null)
  })

  it('updateRememberToken writes the column', async () => {
    const users = [fakeUser()]
    const model = fakeModel(users)
    const provider = new EloquentUserProvider(model as never, noHashCheck)
    await provider.updateRememberToken('1', 'new-token')
    assert.deepStrictEqual(model.updates, [{ id: '1', data: { rememberToken: 'new-token' } }])
  })
})

// ─── Guard ────────────────────────────────────────────────

describe('SessionGuard remember integration', () => {
  it('login(user, true) mints a token, persists it, and queues a set directive', async () => {
    const users = [fakeUser()]
    const model = fakeModel(users)
    const provider = new EloquentUserProvider(model as never, noHashCheck)
    const sess = fakeSession()
    const guard = new SessionGuard(provider, sess.instance)

    await runWithRemember(async () => {
      await guard.login(toAuthenticatable(users[0]!), true)
      const directive = takeRememberDirective()
      assert.ok(directive && directive.action === 'set')
      assert.strictEqual(directive.userId, '1')
      // The persisted token matches the one queued for the cookie.
      assert.strictEqual(model.updates.length, 1)
      assert.strictEqual(model.updates[0]!.data['rememberToken'], directive.token)
    })
    assert.strictEqual(sess.store['auth_user_id'], '1')
  })

  it('login(user) without remember does NOT touch the token or queue a directive', async () => {
    const users = [fakeUser()]
    const model = fakeModel(users)
    const provider = new EloquentUserProvider(model as never, noHashCheck)
    const guard = new SessionGuard(provider, fakeSession().instance)

    await runWithRemember(async () => {
      await guard.login(toAuthenticatable(users[0]!))
      assert.strictEqual(model.updates.length, 0)
      assert.strictEqual(takeRememberDirective(), null)
    })
  })

  it('logout() cycles the token and queues a clear directive', async () => {
    const users = [fakeUser({ rememberToken: 'old-token' })]
    const model = fakeModel(users)
    const provider = new EloquentUserProvider(model as never, noHashCheck)
    const sess = fakeSession()
    sess.store['auth_user_id'] = '1'
    const guard = new SessionGuard(provider, sess.instance)

    await runWithRemember(async () => {
      await guard.logout()
      assert.deepStrictEqual(takeRememberDirective(), { action: 'clear' })
    })
    // Token was rotated to a fresh value (invalidating outstanding cookies).
    assert.strictEqual(model.updates.length, 1)
    const newToken = model.updates[0]!.data['rememberToken']
    assert.match(String(newToken), /^[0-9a-f]{64}$/)
    assert.notStrictEqual(newToken, 'old-token')
    assert.strictEqual(sess.store['auth_user_id'], undefined)
  })

  it('loginViaRememberCookie establishes the session on a valid token', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const provider = new EloquentUserProvider(fakeModel(users) as never, noHashCheck)
    const sess = fakeSession()
    const guard = new SessionGuard(provider, sess.instance)

    const ok = await guard.loginViaRememberCookie('1', 'stored-token')
    assert.strictEqual(ok, true)
    assert.strictEqual(sess.store['auth_user_id'], '1')
  })

  it('loginViaRememberCookie does NOT rotate the token (cookie stays valid)', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const model = fakeModel(users)
    const provider = new EloquentUserProvider(model as never, noHashCheck)
    const guard = new SessionGuard(provider, fakeSession().instance)

    await guard.loginViaRememberCookie('1', 'stored-token')
    assert.strictEqual(model.updates.length, 0, 'auto-login must not write a new token')
  })

  it('loginViaRememberCookie fails on a bad token without establishing a session', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const provider = new EloquentUserProvider(fakeModel(users) as never, noHashCheck)
    const sess = fakeSession()
    const guard = new SessionGuard(provider, sess.instance)

    const ok = await guard.loginViaRememberCookie('1', 'wrong-token')
    assert.strictEqual(ok, false)
    assert.strictEqual(sess.store['auth_user_id'], undefined)
  })
})

// ─── End-to-end via AuthMiddleware ────────────────────────

describe('AuthMiddleware remember-me (end to end)', () => {
  const AUTH_CONFIG: AuthConfig = {
    defaults: { guard: 'web' },
    guards: { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model: null } },
  }

  /** Stand up a fake `app()` whose 'auth.manager' is a real AuthManager wired
   *  to the given users + session, run `body`, then restore globals/env. */
  async function withMiddleware(
    users: Record<string, unknown>[],
    cookieHeader: string,
    handler: (session: ReturnType<typeof fakeSession>) => Promise<void>,
  ): Promise<{ session: ReturnType<typeof fakeSession>; setCookies: string[] }> {
    const g = globalThis as Record<string, unknown>
    const prevApp = g['__rudderjs_app__']
    const prevSecret = process.env['AUTH_SECRET']
    process.env['AUTH_SECRET'] = SECRET

    const model = fakeModel(users)
    const session = fakeSession()
    const manager = new AuthManager(
      { ...AUTH_CONFIG, providers: { users: { driver: 'eloquent', model: model as never } } },
      async () => true,
      () => session.instance,
      async (v: string) => `hashed:${v}`,
    )
    g['__rudderjs_app__'] = { make: (k: string) => (k === 'auth.manager' ? manager : undefined) }

    const setCookies: string[] = []
    const req = { headers: { cookie: cookieHeader }, raw: { __rjs_session: session.instance } } as never
    const res = { raw: { header: (_k: string, v: string) => { setCookies.push(v) } } } as never

    try {
      await AuthMiddleware()(req, res, () => handler(session))
      return { session, setCookies }
    } finally {
      g['__rudderjs_app__'] = prevApp
      if (prevSecret === undefined) delete process.env['AUTH_SECRET']
      else process.env['AUTH_SECRET'] = prevSecret
    }
  }

  it('resumes a session from a valid remember cookie before the handler runs', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const cookie = `rudderjs_remember=${encodeRememberCookie('1', 'stored-token', SECRET)}`
    let uidDuringHandler: unknown
    const { session } = await withMiddleware(users, cookie, async (s) => {
      uidDuringHandler = s.store['auth_user_id']
    })
    assert.strictEqual(uidDuringHandler, '1', 'handler should already see the resumed session')
    assert.strictEqual(session.store['auth_user_id'], '1')
  })

  it('ignores a remember cookie with a stale token (no auto-login)', async () => {
    const users = [fakeUser({ rememberToken: 'rotated-token' })]
    const cookie = `rudderjs_remember=${encodeRememberCookie('1', 'old-token', SECRET)}`
    const { session } = await withMiddleware(users, cookie, async () => {})
    assert.strictEqual(session.store['auth_user_id'], undefined)
  })

  it('writes a remember Set-Cookie when the handler logs in with remember=true', async () => {
    const users = [fakeUser({ rememberToken: null })]
    const { setCookies, session } = await withMiddleware(users, '', async () => {
      await Auth.login(toAuthenticatable(users[0]!), true)
    })
    const remember = setCookies.find(c => c.startsWith('rudderjs_remember='))
    assert.ok(remember, 'a remember cookie must be written')
    assert.match(remember!, /Max-Age=\d{5,}/)
    // The cookie decodes back to the user + the freshly-persisted token.
    const raw = parseCookie(remember!, 'rudderjs_remember')!
    const decoded = decodeRememberCookie(raw, SECRET)
    assert.strictEqual(decoded?.userId, '1')
    assert.strictEqual(session.store['auth_user_id'], '1')
  })

  it('clears the remember cookie on logout', async () => {
    const users = [fakeUser({ rememberToken: 'stored-token' })]
    const cookie = `rudderjs_remember=${encodeRememberCookie('1', 'stored-token', SECRET)}`
    const { setCookies } = await withMiddleware(users, cookie, async () => {
      await Auth.logout()
    })
    const remember = setCookies.find(c => c.startsWith('rudderjs_remember='))
    assert.ok(remember, 'a remember deletion cookie must be written')
    assert.match(remember!, /Max-Age=0/)
  })
})
