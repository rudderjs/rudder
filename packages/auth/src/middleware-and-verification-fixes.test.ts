import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { Application } from '@rudderjs/core'
import {
  AuthManager,
  AuthMiddleware,
  EnsureEmailIsVerified,
  runWithAuth,
  type AuthConfig,
} from './index.js'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// ─── Fixtures ──────────────────────────────────────────────

function fakeUser(overrides?: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', name: 'John', email: 'john@example.com', password: '$2b$04$x', rememberToken: null, ...overrides }
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
      async regenerate() { /* no-op */ },
    },
  }
}

function makeConfig(model: unknown): AuthConfig {
  return {
    defaults:  { guard: 'web' },
    guards:    { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model } },
  }
}

function makeReq(sess: ReturnType<typeof fakeSession>, init?: Partial<AppRequest>): AppRequest {
  const raw: Record<string, unknown> = { __rjs_session: sess.instance }
  return {
    method:  'GET',
    url:     '/',
    path:    '/',
    query:   {},
    params:  {},
    headers: {},
    body:    null,
    raw,
    input:    (() => undefined) as never,
    string:   (() => '') as never,
    integer:  (() => 0) as never,
    float:    (() => 0) as never,
    boolean:  (() => false) as never,
    date:     (() => new Date()) as never,
    array:    (() => []) as never,
    has:      (() => false) as never,
    missing:  (() => true) as never,
    filled:   (() => false) as never,
    ...init,
  } as AppRequest
}

function makeRes() {
  let statusCode = 200
  let jsonBody: unknown
  const res: AppResponse = {
    get statusCode() { return statusCode },
    status(code: number) { statusCode = code; return res },
    header()    { return res },
    json(data)  { jsonBody = data },
    send()      {},
    redirect()  {},
    intended()  {},
    raw:        null,
  }
  return { res, getStatus: () => statusCode, getJson: () => jsonBody }
}

// ─── AuthMiddleware — Phase 4 (try/finally) ────────────────

describe('AuthMiddleware try/finally — req.user stays consistent on throw', () => {
  let sess: ReturnType<typeof fakeSession>
  let manager: AuthManager

  beforeEach(() => {
    Application.resetForTesting()
    Application.create()
    sess = fakeSession()
    const model = fakeModel([fakeUser()])
    manager = new AuthManager(makeConfig(model), async () => true, () => sess.instance)
    Application.getInstance().instance('auth.manager', manager)
  })

  afterEach(() => Application.resetForTesting())

  it('signs the user in mid-handler, then throws — req.user reflects the post-sign-in state', async () => {
    const { res } = makeRes()
    const req = makeReq(sess)

    const middleware = AuthMiddleware()

    const handlerError = new Error('boom after sign-in')
    let observedAfterFinally: unknown

    await assert.rejects(async () => {
      await middleware(req, res, async () => {
        // Simulate the handler signing the user in (writes auth_user_id into
        // the session) and then throwing.
        sess.store['auth_user_id'] = '1'
        throw handlerError
      })
      observedAfterFinally = (req as unknown as { user?: unknown }).user
    }, /boom after sign-in/)

    // The finally block should have run syncUser even though the handler
    // threw — so the renderer (or downstream error middleware) sees the
    // user that signed in just before the failure.
    const reqUser = (req as unknown as { user?: { id?: string; email?: string } }).user
    assert.ok(reqUser, 'req.user must be populated even on handler throw')
    assert.strictEqual(reqUser.id, '1')
    assert.strictEqual(reqUser.email, 'john@example.com')

    // Pre-existing `await next()` (no error) path is reached after sync, so
    // this is observably the same as the success path's snapshot.
    void observedAfterFinally
  })

  it('signs the user OUT mid-handler, then throws — req.user is cleared on throw', async () => {
    sess.store['auth_user_id'] = '1'
    const { res } = makeRes()
    const req = makeReq(sess)

    const middleware = AuthMiddleware()
    const handlerError = new Error('boom after sign-out')

    await assert.rejects(async () => {
      await middleware(req, res, async () => {
        delete sess.store['auth_user_id']
        throw handlerError
      })
    }, /boom after sign-out/)

    const reqUser = (req as unknown as { user?: unknown }).user
    assert.strictEqual(reqUser, undefined, 'req.user must be cleared even on handler throw')
  })

  it('handler error propagates unchanged when sync itself also fails', async () => {
    // Override the manager's guard so the post-handler syncUser call throws.
    // The original handler error must still win.
    const brokenManager = new AuthManager(
      makeConfig({
        find:  async () => { throw new Error('db down') },
        query: () => ({ where: () => ({ first: async () => null }) }),
      }),
      async () => true,
      () => sess.instance,
    )
    Application.getInstance().instance('auth.manager', brokenManager)

    const { res } = makeRes()
    const req = makeReq(sess)
    const middleware = AuthMiddleware()
    const handlerError = new Error('original handler boom')

    await assert.rejects(async () => {
      await middleware(req, res, async () => {
        sess.store['auth_user_id'] = '1'   // triggers post-handler syncUser
        throw handlerError
      })
    }, /original handler boom/)
  })
})

// ─── EnsureEmailIsVerified — Phase 5 ───────────────────────

describe('EnsureEmailIsVerified — typed snapshot check + live guard re-resolve', () => {
  let sess: ReturnType<typeof fakeSession>
  let manager: AuthManager

  function setup(user: Record<string, unknown> | null) {
    Application.resetForTesting()
    Application.create()
    sess = fakeSession()
    const users = user ? [user] : []
    manager = new AuthManager(makeConfig(fakeModel(users)), async () => true, () => sess.instance)
    if (user) sess.store['auth_user_id'] = String(user['id'])
    Application.getInstance().instance('auth.manager', manager)
  }

  afterEach(() => Application.resetForTesting())

  async function run(reqUser?: Record<string, unknown>): Promise<number> {
    const req = makeReq(sess)
    if (reqUser !== undefined) (req as unknown as Record<string, unknown>)['user'] = reqUser
    const { res, getStatus } = makeRes()
    let reached = false
    await runWithAuth(manager, async () => {
      await EnsureEmailIsVerified()(req, res, async () => { reached = true })
    })
    return reached ? 200 : getStatus()
  }

  it('accepts a real Date in emailVerifiedAt', async () => {
    setup(fakeUser({ emailVerifiedAt: new Date('2026-01-01T00:00:00Z') }))
    assert.strictEqual(await run(), 200)
  })

  it('accepts an ISO-shaped string in emailVerifiedAt', async () => {
    setup(fakeUser({ emailVerifiedAt: '2026-01-01T00:00:00.000Z' }))
    assert.strictEqual(await run(), 200)
  })

  it('rejects the string "false" (mass-assignment safety)', async () => {
    setup(fakeUser({ emailVerifiedAt: 'false' }))
    assert.strictEqual(await run(), 403)
  })

  it('rejects the number 0', async () => {
    setup(fakeUser({ emailVerifiedAt: 0 }))
    assert.strictEqual(await run(), 403)
  })

  it('rejects the boolean false', async () => {
    setup(fakeUser({ emailVerifiedAt: false }))
    assert.strictEqual(await run(), 403)
  })

  it('rejects an empty string', async () => {
    setup(fakeUser({ emailVerifiedAt: '' }))
    assert.strictEqual(await run(), 403)
  })

  it('rejects null', async () => {
    setup(fakeUser({ emailVerifiedAt: null }))
    assert.strictEqual(await run(), 403)
  })

  it('rejects a non-date string like "unverified"', async () => {
    setup(fakeUser({ emailVerifiedAt: 'unverified' }))
    assert.strictEqual(await run(), 403)
  })

  it('honors MustVerifyEmail.hasVerifiedEmail() when the model implements the mixin', async () => {
    // Mixin says "verified" even when the column would say otherwise — the
    // mixin is authoritative.
    const user = {
      ...fakeUser({ emailVerifiedAt: 'false' /* would fail snapshot path */ }),
      hasVerifiedEmail() { return true },
      markEmailAsVerified() { return Promise.resolve() },
      getEmailForVerification() { return 'john@example.com' },
    }
    setup(user)
    assert.strictEqual(await run(), 200)
  })

  it('respects MustVerifyEmail returning false', async () => {
    const user = {
      ...fakeUser({ emailVerifiedAt: new Date() /* would pass snapshot path */ }),
      hasVerifiedEmail() { return false },
      markEmailAsVerified() { return Promise.resolve() },
      getEmailForVerification() { return 'john@example.com' },
    }
    setup(user)
    assert.strictEqual(await run(), 403)
  })

  it('returns 401 when no user is resolvable', async () => {
    setup(null)
    assert.strictEqual(await run(), 401)
  })
})
