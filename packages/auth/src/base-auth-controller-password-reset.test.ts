import 'reflect-metadata'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { BaseAuthController } from './base-auth-controller.js'

// ─── Test plumbing ────────────────────────────────────────
//
// These tests invoke `requestPasswordReset` directly (not through the router)
// to exercise the handler's no-broker branch — the misconfiguration footgun
// where a subclass forgets to set `passwordBroker`.

const NOOP_USER_MODEL = {
  query:  () => ({ where: () => ({ first: async () => null }) }),
  create: async (attrs: Record<string, unknown>) => ({ id: '1', ...attrs }),
  update: async () => ({}),
}

const NOOP_HASH = {
  make:  async (p: string) => `hashed:${p}`,
  check: async () => true,
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

// A subclass with NO `passwordBroker` configured.
class BrokerlessAuthController extends BaseAuthController {
  protected userModel = NOOP_USER_MODEL
  protected hash      = NOOP_HASH
}

// Capture console.warn calls without leaking output into the test runner.
function captureWarn(fn: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  return fn().then(() => warnings).finally(() => { console.warn = original })
}

describe('BaseAuthController.requestPasswordReset — no broker configured', () => {
  const ORIGINAL_ENV = process.env['NODE_ENV']

  beforeEach(() => { delete process.env['NODE_ENV'] })
  afterEach(()  => {
    if (ORIGINAL_ENV === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = ORIGINAL_ENV
  })

  it('still returns the enumeration-safe { status: "sent" } 200', async () => {
    const ctrl = new BrokerlessAuthController()
    const res  = fakeRes()
    await captureWarn(() =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.requestPasswordReset({ body: { email: 'a@x.com' } }, res),
    )
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { status: 'sent' })
  })

  it('warns in development that no passwordBroker is configured', async () => {
    process.env['NODE_ENV'] = 'development'
    const ctrl = new BrokerlessAuthController()
    const res  = fakeRes()
    const warnings = await captureWarn(() =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.requestPasswordReset({ body: { email: 'a@x.com' } }, res),
    )
    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`)
    assert.match(warnings[0]!, /no passwordBroker is configured/)
    assert.deepEqual(res.body, { status: 'sent' })
  })

  it('stays silent in production (no enumeration oracle via stderr)', async () => {
    process.env['NODE_ENV'] = 'production'
    const ctrl = new BrokerlessAuthController()
    const res  = fakeRes()
    const warnings = await captureWarn(() =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.requestPasswordReset({ body: { email: 'a@x.com' } }, res),
    )
    assert.equal(warnings.length, 0, `expected no warning in production, got ${warnings.join(' | ')}`)
    assert.deepEqual(res.body, { status: 'sent' })
  })

  it('returns 422 when email is missing, before any broker check', async () => {
    const ctrl = new BrokerlessAuthController()
    const res  = fakeRes()
    const warnings = await captureWarn(() =>
      // @ts-expect-error — exercising the protected handler directly
      ctrl.requestPasswordReset({ body: {} }, res),
    )
    assert.equal(res.statusCode, 422)
    assert.equal(warnings.length, 0)
  })
})
