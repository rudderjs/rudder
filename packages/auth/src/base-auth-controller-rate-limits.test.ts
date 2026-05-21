import 'reflect-metadata'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Router } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import { CacheRegistry, MemoryAdapter } from '@rudderjs/cache'
import type { MiddlewareHandler, RouteDefinition } from '@rudderjs/contracts'
import {
  BaseAuthController,
  DEFAULT_AUTH_RATE_LIMITS,
  type AuthRateLimits,
} from './base-auth-controller.js'

// ─── Test plumbing ────────────────────────────────────────
//
// `BaseAuthController` rate-limit injection runs once per subclass (guarded
// by a module-level WeakSet). Each test below defines its OWN subclass so
// repeat constructions don't reuse another test's cached injection state.

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
  headers:    Record<string, string>
  status:     (code: number) => FakeRes
  json:       (b: unknown) => void
  header:     (k: string, v: string) => void
}

function fakeReq(overrides: Partial<{ path: string; method: string; ip: string; body: unknown }> = {}): Record<string, unknown> {
  return {
    path:    overrides.path   ?? '/auth/sign-in/email',
    method:  overrides.method ?? 'POST',
    ip:      overrides.ip     ?? '127.0.0.1',
    body:    overrides.body   ?? {},
    headers: {},
    raw:     {},
  }
}

function fakeRes(): FakeRes {
  const r: FakeRes = {
    statusCode: 200,
    body:       undefined,
    headers:    {},
    status(code: number) { r.statusCode = code; return r },
    json(b: unknown)     { r.body = b },
    header(k: string, v: string) { r.headers[k] = v },
  }
  return r
}

/**
 * Run only the registered route's middleware chain — the handler is
 * intentionally not invoked. These tests are scoped to "does the rate-limit
 * fire?", not "does the handler do its real auth work?" (covered elsewhere).
 * Returns `true` if the limiter let the request through to where the handler
 * would have been called.
 */
async function runMiddlewareOnly(route: RouteDefinition, req: Record<string, unknown>, res: FakeRes): Promise<boolean> {
  const chain = [...route.middleware]
  let idx           = 0
  let reachedHandler = false
  const next = async (): Promise<void> => {
    if (idx < chain.length) {
      const mw = chain[idx++] as MiddlewareHandler
      await mw(req as never, res as never, next)
    } else {
      reachedHandler = true
    }
  }
  await next()
  return reachedHandler
}

function findRoute(router: Router, path: string): RouteDefinition {
  const route = router.list().find(r => r.path === path)
  if (!route) throw new Error(`Route ${path} not registered`)
  return route
}

// ─── Tests ────────────────────────────────────────────────

describe('BaseAuthController — default rate-limits', () => {
  beforeEach(() => {
    CacheRegistry.reset()
    CacheRegistry.set(new MemoryAdapter())
  })

  it('exports a frozen DEFAULT_AUTH_RATE_LIMITS with sign-in / sign-up / password-reset entries', () => {
    assert.ok(Object.isFrozen(DEFAULT_AUTH_RATE_LIMITS))
    assert.ok(typeof DEFAULT_AUTH_RATE_LIMITS.signIn === 'function')
    assert.ok(typeof DEFAULT_AUTH_RATE_LIMITS.signUp === 'function')
    assert.ok(typeof DEFAULT_AUTH_RATE_LIMITS.requestPasswordReset === 'function')
  })

  it('default sign-in limit allows 10 attempts and returns 429 on the 11th from the same IP', async () => {
    class AuthCtrlA extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
    }

    const router = new Router()
    router.registerController(AuthCtrlA)
    const route = findRoute(router, '/auth/sign-in/email')

    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const req = fakeReq({ ip: '10.0.0.1', body: { email: 'a@x.com', password: 'wrong' } })
      const res = fakeRes()
      await runMiddlewareOnly(route, req, res)
      statuses.push(res.statusCode)
    }

    const oks    = statuses.filter(s => s !== 429).length
    const blocks = statuses.filter(s => s === 429).length
    assert.equal(oks,    10, `expected first 10 to pass the limiter, got statuses ${statuses.join(',')}`)
    assert.equal(blocks, 1,  `expected the 11th to be 429, got statuses ${statuses.join(',')}`)
    assert.equal(statuses[10], 429)
  })

  it('default sign-up limit allows 5 and 429s the 6th from the same IP', async () => {
    class AuthCtrlB extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
    }

    const router = new Router()
    router.registerController(AuthCtrlB)
    const route = findRoute(router, '/auth/sign-up/email')

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const req = fakeReq({
        path: '/auth/sign-up/email',
        ip:   '10.0.0.2',
        body: { email: `u${i}@x.com`, password: 'long-enough-password' },
      })
      const res = fakeRes()
      await runMiddlewareOnly(route, req, res)
      statuses.push(res.statusCode)
    }

    assert.equal(statuses.filter(s => s === 429).length, 1)
    assert.equal(statuses[5], 429)
  })

  it('default password-reset limit allows 3 per email and keys by email (different emails don\'t share the bucket)', async () => {
    class AuthCtrlC extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
    }

    const router = new Router()
    router.registerController(AuthCtrlC)
    const route = findRoute(router, '/auth/request-password-reset')

    // 4 hits on email A → the 4th should 429
    const aStatuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const req = fakeReq({ path: '/auth/request-password-reset', ip: '10.0.0.3', body: { email: 'a@x.com' } })
      const res = fakeRes()
      await runMiddlewareOnly(route, req, res)
      aStatuses.push(res.statusCode)
    }
    assert.equal(aStatuses.filter(s => s === 429).length, 1, `email A: ${aStatuses.join(',')}`)
    assert.equal(aStatuses[3], 429)

    // Different email from the SAME IP should NOT be blocked (keys by email)
    const reqB = fakeReq({ path: '/auth/request-password-reset', ip: '10.0.0.3', body: { email: 'b@x.com' } })
    const resB = fakeRes()
    await runMiddlewareOnly(route, reqB, resB)
    assert.notEqual(resB.statusCode, 429, 'unrelated email should not inherit A\'s bucket')
  })

  it('subclass override `static rateLimits = {}` disables limits entirely', async () => {
    class UnprotectedAuthCtrl extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
      static override rateLimits: AuthRateLimits = {}
    }

    const router = new Router()
    router.registerController(UnprotectedAuthCtrl)
    const route = findRoute(router, '/auth/sign-in/email')

    const statuses: number[] = []
    for (let i = 0; i < 20; i++) {
      const req = fakeReq({ ip: '10.0.0.4', body: { email: 'a@x.com', password: 'wrong' } })
      const res = fakeRes()
      await runMiddlewareOnly(route, req, res)
      statuses.push(res.statusCode)
    }

    assert.equal(statuses.filter(s => s === 429).length, 0, `expected no 429s when rateLimits = {}, got ${statuses.join(',')}`)
  })

  it('subclass override tightens an individual limit (signIn: 3/min, others use defaults)', async () => {
    class TightAuthCtrl extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
      static override rateLimits: AuthRateLimits = {
        ...DEFAULT_AUTH_RATE_LIMITS,
        signIn: RateLimit.perMinute(3).message('Custom message.'),
      }
    }

    const router = new Router()
    router.registerController(TightAuthCtrl)
    const signInRoute = findRoute(router, '/auth/sign-in/email')

    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      const req = fakeReq({ ip: '10.0.0.5', body: { email: 'a@x.com', password: 'wrong' } })
      const res = fakeRes()
      await runMiddlewareOnly(signInRoute, req, res)
      statuses.push(res.statusCode)
    }
    assert.equal(statuses[3], 429, `expected tighter signIn (3/min) to 429 on attempt 4, got ${statuses.join(',')}`)

    // The custom message is in the 429 body
    const finalRes = fakeRes()
    await runMiddlewareOnly(signInRoute, fakeReq({ ip: '10.0.0.5' }), finalRes)
    assert.deepEqual(finalRes.body, { message: 'Custom message.' })
  })

  it('two subclasses with different overrides don\'t pollute each other\'s route metadata', async () => {
    // Reuse the same source class name in a tighter scope to surface any
    // leakage via the shared base prototype's route array. The two subclasses
    // must produce independent, non-shared rate-limit chains.
    class StrictCtrl extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
      static override rateLimits: AuthRateLimits = {
        signIn: RateLimit.perMinute(2).message('Strict.'),
      }
    }
    class LooseCtrl extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
      static override rateLimits: AuthRateLimits = {
        signIn: RateLimit.perMinute(50).message('Loose.'),
      }
    }

    const r1 = new Router(); r1.registerController(StrictCtrl)
    const r2 = new Router(); r2.registerController(LooseCtrl)

    const strictRoute = findRoute(r1, '/auth/sign-in/email')
    const looseRoute  = findRoute(r2, '/auth/sign-in/email')

    // Strict: 3rd hit 429s
    const strictStatuses: number[] = []
    for (let i = 0; i < 3; i++) {
      const res = fakeRes()
      await runMiddlewareOnly(strictRoute, fakeReq({ ip: '10.0.0.6' }), res)
      strictStatuses.push(res.statusCode)
    }
    assert.equal(strictStatuses[2], 429, `StrictCtrl: ${strictStatuses.join(',')}`)

    // Loose: 3 hits all pass
    const looseStatuses: number[] = []
    for (let i = 0; i < 3; i++) {
      const res = fakeRes()
      await runMiddlewareOnly(looseRoute, fakeReq({ ip: '10.0.0.7' }), res)
      looseStatuses.push(res.statusCode)
    }
    assert.equal(looseStatuses.filter(s => s === 429).length, 0, `LooseCtrl should not 429 at 3 hits: ${looseStatuses.join(',')}`)

    // Sanity: the strict subclass's prototype should have its OWN
    // ROUTE_DEFINITIONS metadata (clone, not shared with base).
    const strictMeta  = Reflect.getOwnMetadata('rudderjs:route:definitions', StrictCtrl.prototype) as unknown[] | undefined
    const looseMeta   = Reflect.getOwnMetadata('rudderjs:route:definitions', LooseCtrl.prototype)  as unknown[] | undefined
    assert.ok(strictMeta, 'StrictCtrl should own ROUTE_DEFINITIONS metadata')
    assert.ok(looseMeta,  'LooseCtrl should own ROUTE_DEFINITIONS metadata')
    assert.notStrictEqual(strictMeta, looseMeta, 'subclasses must not share the same metadata array')
  })

  it('disabling a single method with explicit null still leaves the others rate-limited', async () => {
    class MixedCtrl extends BaseAuthController {
      protected userModel = NOOP_USER_MODEL
      protected hash      = NOOP_HASH
      static override rateLimits: AuthRateLimits = {
        ...DEFAULT_AUTH_RATE_LIMITS,
        signIn: null,
      }
    }

    const router = new Router()
    router.registerController(MixedCtrl)

    // sign-in: unlimited
    const signInRoute = findRoute(router, '/auth/sign-in/email')
    const signInStatuses: number[] = []
    for (let i = 0; i < 15; i++) {
      const res = fakeRes()
      await runMiddlewareOnly(signInRoute, fakeReq({ ip: '10.0.0.8' }), res)
      signInStatuses.push(res.statusCode)
    }
    assert.equal(signInStatuses.filter(s => s === 429).length, 0, `sign-in disabled should never 429: ${signInStatuses.join(',')}`)

    // sign-up: still 5/min default
    const signUpRoute = findRoute(router, '/auth/sign-up/email')
    const signUpStatuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = fakeRes()
      await runMiddlewareOnly(signUpRoute, fakeReq({
        path: '/auth/sign-up/email',
        ip: '10.0.0.8',
        body: { email: `u${i}@x.com`, password: 'long-enough-password' },
      }), res)
      signUpStatuses.push(res.statusCode)
    }
    assert.equal(signUpStatuses[5], 429)
  })
})
