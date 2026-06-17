import 'reflect-metadata'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { BaseAuthController } from './base-auth-controller.js'
import { AuthManager, runWithAuth, type AuthConfig } from './auth-manager.js'
import type { PasswordBroker } from './password-reset.js'

// ─── Why this file ────────────────────────────────────────
//
// `index.test.ts` and `base-auth-controller-rate-limits.test.ts` only verify
// route-registration shape and that the rate-limit middleware is applied — they
// stop before any handler body runs. These tests invoke each handler directly
// (bypassing the router + rate-limit middleware) so the status-code contract
// between the auth controller and client apps is actually exercised: `signIn`
// 422/401, `signUp` 422/409, `signOut` 200, and `resetPassword`'s broker-status
// → HTTP mapping. The no-broker `requestPasswordReset` branch is covered in
// `base-auth-controller-password-reset.test.ts`; here we cover the broker path.

// ─── Fixtures ─────────────────────────────────────────────

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

function fakeReq(body: unknown): { body: unknown } {
  return { body }
}

/** A model whose `query().where(...).first()` matches against the seeded rows. */
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
    create: async (attrs: Record<string, unknown>) => ({ id: '99', ...attrs }),
    update: async () => ({}),
  }
}

function fakeSession() {
  const store: Record<string, unknown> = {}
  return {
    get<T>(key: string, fallback?: T): T | undefined {
      return (key in store ? store[key] : fallback) as T | undefined
    },
    put(key: string, value: unknown) { store[key] = value },
    forget(key: string) { delete store[key] },
    async regenerate() { /* no-op for tests */ },
  }
}

/** Build a manager backed by `providerModel` so `Auth.attempt/login/logout` work. */
function makeManager(providerModel: ReturnType<typeof fakeModel>, hashOk = true): AuthManager {
  const config: AuthConfig = {
    defaults:  { guard: 'web' },
    guards:    { web: { driver: 'session', provider: 'users' } },
    providers: { users: { driver: 'eloquent', model: providerModel } },
  }
  return new AuthManager(
    config,
    async () => hashOk,                 // hashCheck
    () => fakeSession() as never,       // getSession
    async (p: string) => `hashed:${p}`, // hashMake
  )
}

/** Subclass exposing the protected handlers, configurable userModel + broker. */
function makeController(opts: {
  userModel?: ReturnType<typeof fakeModel>
  broker?:    PasswordBroker
} = {}) {
  const model = opts.userModel ?? fakeModel([])
  class TestController extends BaseAuthController {
    protected userModel = model
    protected hash      = { make: async (p: string) => `hashed:${p}`, check: async () => true }
    protected override passwordBroker?: PasswordBroker = opts.broker
    // Silence the default stdout reset-email side effect.
    protected override async sendResetEmail() { /* no-op */ }
  }
  return new TestController()
}

const PASS_HASH = '$2b$04$hashed'

// ─── signIn ───────────────────────────────────────────────

describe('BaseAuthController.signIn', () => {
  it('returns 422 when email is missing', async () => {
    const ctrl = makeController()
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.signIn(fakeReq({ password: 'secret' }), res)
    assert.equal(res.statusCode, 422)
    assert.deepEqual(res.body, { message: 'Email and password are required.' })
  })

  it('returns 422 when password is missing', async () => {
    const ctrl = makeController()
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.signIn(fakeReq({ email: 'a@x.com' }), res)
    assert.equal(res.statusCode, 422)
  })

  it('returns 401 on bad credentials (hashCheck fails)', async () => {
    const ctrl    = makeController()
    const manager = makeManager(fakeModel([{ id: '1', email: 'a@x.com', password: PASS_HASH }]), /* hashOk */ false)
    const res     = fakeRes()
    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signIn(fakeReq({ email: 'a@x.com', password: 'wrong' }), res),
    )
    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.body, { message: 'Invalid email or password.' })
  })

  it('returns 401 when the user does not exist', async () => {
    const ctrl    = makeController()
    const manager = makeManager(fakeModel([]))
    const res     = fakeRes()
    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signIn(fakeReq({ email: 'ghost@x.com', password: 'secret' }), res),
    )
    assert.equal(res.statusCode, 401)
  })

  it('returns { ok: true } on valid credentials', async () => {
    const ctrl    = makeController()
    const manager = makeManager(fakeModel([{ id: '1', email: 'a@x.com', password: PASS_HASH, rememberToken: null }]))
    const res     = fakeRes()
    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signIn(fakeReq({ email: 'a@x.com', password: 'secret' }), res),
    )
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { ok: true })
  })
})

// ─── signUp ───────────────────────────────────────────────

describe('BaseAuthController.signUp', () => {
  it('returns 422 when email or password is missing', async () => {
    const ctrl = makeController()
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.signUp(fakeReq({ name: 'Ann' }), res)
    assert.equal(res.statusCode, 422)
    assert.deepEqual(res.body, { message: 'Email and password are required.' })
  })

  it('returns 422 when the password is shorter than 8 characters', async () => {
    const ctrl = makeController()
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.signUp(fakeReq({ email: 'a@x.com', password: 'short' }), res)
    assert.equal(res.statusCode, 422)
    assert.deepEqual(res.body, { message: 'Password must be at least 8 characters.' })
  })

  it('returns 409 when an account with the email already exists', async () => {
    const ctrl = makeController({ userModel: fakeModel([{ id: '1', email: 'taken@x.com' }]) })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.signUp(fakeReq({ email: 'taken@x.com', password: 'longenough' }), res)
    assert.equal(res.statusCode, 409)
    assert.deepEqual(res.body, { message: 'An account with this email already exists.' })
  })

  it('creates the user, signs them in, and returns { ok: true }', async () => {
    const ctrl    = makeController({ userModel: fakeModel([]) })
    const manager = makeManager(fakeModel([]))
    const res     = fakeRes()
    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signUp(fakeReq({ name: 'Ann', email: 'ann@x.com', password: 'longenough' }), res),
    )
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { ok: true })
  })
})

// ─── signOut ──────────────────────────────────────────────

describe('BaseAuthController.signOut', () => {
  it('logs the user out and returns { ok: true }', async () => {
    const ctrl    = makeController()
    const manager = makeManager(fakeModel([]))
    const res     = fakeRes()
    await runWithAuth(manager, () =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.signOut(fakeReq({}), res),
    )
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { ok: true })
  })
})

// ─── requestPasswordReset (broker configured) ─────────────

describe('BaseAuthController.requestPasswordReset — broker configured', () => {
  it('invokes the broker and returns the enumeration-safe { status: "sent" }', async () => {
    let sendResetLinkCalled = false
    const broker = {
      async sendResetLink(_creds: unknown, _cb: unknown) { sendResetLinkCalled = true; return 'RESET_LINK_SENT' },
      async reset() { return 'PASSWORD_RESET' },
    } as unknown as PasswordBroker

    const ctrl = makeController({ broker })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.requestPasswordReset(fakeReq({ email: 'a@x.com' }), res)

    assert.equal(sendResetLinkCalled, true)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { status: 'sent' })
  })

  it('returns 422 when email is missing, before touching the broker', async () => {
    let touched = false
    const broker = {
      async sendResetLink() { touched = true; return 'RESET_LINK_SENT' },
      async reset() { return 'PASSWORD_RESET' },
    } as unknown as PasswordBroker

    const ctrl = makeController({ broker })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.requestPasswordReset(fakeReq({}), res)

    assert.equal(res.statusCode, 422)
    assert.equal(touched, false)
  })
})

// ─── resetPassword (broker status → HTTP mapping) ─────────

describe('BaseAuthController.resetPassword', () => {
  function brokerReturning(status: string): PasswordBroker {
    return {
      async sendResetLink() { return 'RESET_LINK_SENT' },
      async reset() { return status },
    } as unknown as PasswordBroker
  }

  it('returns 422 when token, email, or newPassword is missing', async () => {
    const ctrl = makeController({ broker: brokerReturning('PASSWORD_RESET') })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.resetPassword(fakeReq({ email: 'a@x.com' }), res)
    assert.equal(res.statusCode, 422)
    assert.deepEqual(res.body, { message: 'Token, email, and new password are required.' })
  })

  it('returns 500 when no passwordBroker is configured', async () => {
    const ctrl = makeController()
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.resetPassword(fakeReq({ token: 't', email: 'a@x.com', newPassword: 'longenough' }), res)
    assert.equal(res.statusCode, 500)
    assert.deepEqual(res.body, { message: 'Password reset not configured.' })
  })

  it('returns { ok: true } on PASSWORD_RESET', async () => {
    const ctrl = makeController({ broker: brokerReturning('PASSWORD_RESET') })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.resetPassword(fakeReq({ token: 't', email: 'a@x.com', newPassword: 'longenough' }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { ok: true })
  })

  it('returns 400 with the expiry message on TOKEN_EXPIRED', async () => {
    const ctrl = makeController({ broker: brokerReturning('TOKEN_EXPIRED') })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.resetPassword(fakeReq({ token: 't', email: 'a@x.com', newPassword: 'longenough' }), res)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.body, { message: 'Reset token has expired.' })
  })

  it('returns 400 with the generic message on INVALID_TOKEN', async () => {
    const ctrl = makeController({ broker: brokerReturning('INVALID_TOKEN') })
    const res  = fakeRes()
    // @ts-expect-error — exercising the protected handler directly
    await ctrl.resetPassword(fakeReq({ token: 'bad', email: 'a@x.com', newPassword: 'longenough' }), res)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.body, { message: 'Invalid or expired token.' })
  })
})
