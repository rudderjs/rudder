import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { attachInputAccessors } from '@rudderjs/contracts'
import {
  Middleware,
  Pipeline,
  fromClass,
  CorsMiddleware,
  LoggerMiddleware,
  ThrottleMiddleware,
  CsrfMiddleware,
  getCsrfToken,
  RateLimit,
} from './index.js'
import { CacheRegistry } from '@rudderjs/cache'

// ─── Test helpers ──────────────────────────────────────────

function makeReq(overrides: Partial<AppRequest> = {}): AppRequest {
  const req: Record<string, unknown> = {
    method:  'GET',
    url:     '/',
    path:    '/',
    query:   {},
    params:  {},
    headers: {},
    body:    null,
    raw:     null,
    // Production sets req.ip via server-hono's extractIp() — RateLimit's
    // default keying reads it (NOT raw headers), so the fixture must carry
    // it or every test request collapses into the shared 'unknown' bucket
    // and per-IP behavior is never exercised.
    ip:      '127.0.0.1',
    ...overrides,
  }
  attachInputAccessors(req)
  return req as unknown as AppRequest
}

function makeRes() {
  const headers = new Map<string, string>()
  let statusCode = 200
  let jsonBody: unknown
  const res: AppResponse = {
    get statusCode()    { return statusCode },
    status(code)        { statusCode = code; return res },
    header(key, value)  { headers.set(key.toLowerCase(), value); return res },
    json(data)          { jsonBody = data },
    send()              {},
    redirect()          {},
    raw: null,
  }
  return { res, headers, getStatus: () => statusCode, getJson: () => jsonBody }
}

/** Minimal in-memory cache adapter for RateLimit tests */
function makeMemoryCache() {
  const store = new Map<string, { value: unknown; expiresAt: number }>()
  const lockNotImplemented = (): never => {
    throw new Error('makeMemoryCache: lock() is not exercised by RateLimit tests')
  }
  return {
    async get<T>(key: string): Promise<T | null> {
      const rec = store.get(key)
      if (!rec || Date.now() > rec.expiresAt) return null
      return rec.value as T
    },
    async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
    async increment(key: string, by = 1, ttlSeconds = 60): Promise<number> {
      const rec = store.get(key)
      const now = Date.now()
      if (rec && now <= rec.expiresAt && typeof rec.value === 'number') {
        const next = rec.value + by
        store.set(key, { value: next, expiresAt: rec.expiresAt })
        return next
      }
      store.set(key, { value: by, expiresAt: now + ttlSeconds * 1000 })
      return by
    },
    async add(key: string, value: unknown, ttlSeconds = 60): Promise<boolean> {
      const rec = store.get(key)
      const now = Date.now()
      if (rec && now <= rec.expiresAt) return false
      store.set(key, { value, expiresAt: now + ttlSeconds * 1000 })
      return true
    },
    async forget(key: string): Promise<void> { store.delete(key) },
    async has(key: string): Promise<boolean> {
      const rec = store.get(key)
      return !!rec && Date.now() <= rec.expiresAt
    },
    async flush(): Promise<void> { store.clear() },
    lock:        lockNotImplemented,
    restoreLock: lockNotImplemented,
    _store: store,
  }
}

// ─── Middleware base class ─────────────────────────────────

describe('Middleware base class', () => {
  it('toHandler() wires handle() correctly', async () => {
    let called = false
    class M extends Middleware {
      async handle(_req: AppRequest, _res: AppResponse, next: () => Promise<void>) {
        called = true
        await next()
      }
    }
    let reached = false
    await new M().toHandler()(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(called)
    assert.ok(reached)
  })

  it('errors thrown inside handle() propagate through toHandler()', async () => {
    class BrokenMiddleware extends Middleware {
      async handle() { throw new Error('boom') }
    }
    await assert.rejects(
      async () => new BrokenMiddleware().toHandler()(makeReq(), makeRes().res, async () => {}),
      /boom/
    )
  })
})

// ─── fromClass() ───────────────────────────────────────────

describe('fromClass()', () => {
  it('converts a no-arg Middleware class to a handler', async () => {
    let ran = false
    class M extends Middleware {
      async handle(_req: AppRequest, _res: AppResponse, next: () => Promise<void>) {
        ran = true
        await next()
      }
    }
    let reached = false
    await fromClass(M)(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(ran)
    assert.ok(reached)
  })
})

// ─── Pipeline ─────────────────────────────────────────────

describe('Pipeline', () => {
  it('constructor accepts an array of middleware', async () => {
    const order: string[] = []
    await new Pipeline([
      async (_req, _res, next) => { order.push('a'); await next() },
      async (_req, _res, next) => { order.push('b'); await next() },
    ]).run(makeReq(), makeRes().res, async () => { order.push('dest') })
    assert.deepStrictEqual(order, ['a', 'b', 'dest'])
  })

  it('make() + through() works as before', async () => {
    const order: string[] = []
    await Pipeline.make()
      .through([
        async (_req, _res, next) => { order.push('x'); await next() },
      ])
      .run(makeReq(), makeRes().res, async () => { order.push('dest') })
    assert.deepStrictEqual(order, ['x', 'dest'])
  })

  it('runs handlers in onion order (post-next code runs in reverse)', async () => {
    const order: string[] = []
    await new Pipeline([
      async (_req, _res, next) => { order.push('a'); await next(); order.push('a:after') },
      async (_req, _res, next) => { order.push('b'); await next(); order.push('b:after') },
    ]).run(makeReq(), makeRes().res, async () => { order.push('dest') })
    assert.deepStrictEqual(order, ['a', 'b', 'dest', 'b:after', 'a:after'])
  })

  it('short-circuits when next() is not called', async () => {
    let reached = false
    await new Pipeline([async () => undefined])
      .run(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(!reached)
  })

  it('empty pipeline goes straight to destination', async () => {
    let reached = false
    await new Pipeline([])
      .run(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('errors in middleware propagate out of run()', async () => {
    await assert.rejects(
      async () => new Pipeline([async () => { throw new Error('fail') }])
        .run(makeReq(), makeRes().res, async () => {}),
      /fail/
    )
  })
})

// ─── CorsMiddleware ────────────────────────────────────────

describe('CorsMiddleware', () => {
  it('reflects a matching origin from the allowlist', async () => {
    const bag = makeRes()
    await new CorsMiddleware({
      origin:  ['https://a.dev', 'https://b.dev'],
      methods: ['GET', 'POST'],
      headers: ['Content-Type'],
    }).handle(makeReq({ headers: { origin: 'https://b.dev' } }), bag.res, async () => {})
    assert.strictEqual(bag.headers.get('access-control-allow-origin'),  'https://b.dev')
    assert.strictEqual(bag.headers.get('access-control-allow-methods'), 'GET, POST')
    assert.strictEqual(bag.headers.get('access-control-allow-headers'), 'Content-Type')
  })

  it('falls back to first allowed origin when request origin is not in the list', async () => {
    const bag = makeRes()
    await new CorsMiddleware({ origin: ['https://a.dev', 'https://b.dev'] })
      .handle(makeReq({ headers: { origin: 'https://evil.com' } }), bag.res, async () => {})
    assert.strictEqual(bag.headers.get('access-control-allow-origin'), 'https://a.dev')
  })

  it('uses * for origin when not specified', async () => {
    const bag = makeRes()
    await new CorsMiddleware().handle(makeReq(), bag.res, async () => {})
    assert.strictEqual(bag.headers.get('access-control-allow-origin'), '*')
  })

  it('accepts a single string origin', async () => {
    const bag = makeRes()
    await new CorsMiddleware({ origin: 'https://example.com' }).handle(makeReq(), bag.res, async () => {})
    assert.strictEqual(bag.headers.get('access-control-allow-origin'), 'https://example.com')
  })

  it('calls next after setting headers', async () => {
    let reached = false
    await new CorsMiddleware().handle(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })
})

// ─── LoggerMiddleware ──────────────────────────────────────

describe('LoggerMiddleware', () => {
  it('calls next and completes', async () => {
    let reached = false
    const logger = new LoggerMiddleware()
    const original = console.log
    console.log = () => {}
    try {
      await logger.handle(makeReq({ method: 'GET', path: '/test' }), makeRes().res, async () => {
        reached = true
      })
    } finally {
      console.log = original
    }
    assert.ok(reached)
  })
})

// ─── ThrottleMiddleware ────────────────────────────────────

describe('ThrottleMiddleware', () => {
  it('allows requests under the limit', async () => {
    const throttle = new ThrottleMiddleware(3, 10_000)
    const req = makeReq({ ip: '1.2.3.4' })
    let count = 0
    for (let i = 0; i < 3; i++) {
      await throttle.handle(req, makeRes().res, async () => { count++ })
    }
    assert.strictEqual(count, 3)
  })

  it('blocks at the limit with 429', async () => {
    const throttle = new ThrottleMiddleware(2, 10_000)
    const req = makeReq({ ip: '1.2.3.5' })
    let nextCount = 0
    await throttle.handle(req, makeRes().res, async () => { nextCount++ })
    await throttle.handle(req, makeRes().res, async () => { nextCount++ })
    const blocked = makeRes()
    await throttle.handle(req, blocked.res, async () => { nextCount++ })
    assert.strictEqual(nextCount, 2)
    assert.strictEqual(blocked.getStatus(), 429)
  })

  it('skips paths starting with /@', async () => {
    const throttle = new ThrottleMiddleware(0, 10_000)
    let passed = false
    await throttle.handle(makeReq({ path: '/@vite/client' }), makeRes().res, async () => { passed = true })
    assert.ok(passed)
  })

  it('skips paths with file extensions (static assets)', async () => {
    const throttle = new ThrottleMiddleware(0, 10_000)
    let passed = false
    await throttle.handle(makeReq({ path: '/assets/app.js' }), makeRes().res, async () => { passed = true })
    assert.ok(passed)
  })

  it('uses x-forwarded-for header for client key', async () => {
    const throttle = new ThrottleMiddleware(1, 10_000)
    const req = makeReq({ headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' } })
    let nextCount = 0
    await throttle.handle(req, makeRes().res, async () => { nextCount++ })
    const blocked = makeRes()
    await throttle.handle(req, blocked.res, async () => { nextCount++ })
    assert.strictEqual(nextCount, 1)
    assert.strictEqual(blocked.getStatus(), 429)
  })
})

// ─── CsrfMiddleware ────────────────────────────────────────

describe('CsrfMiddleware()', () => {
  it('returns a MiddlewareHandler (function)', () => {
    assert.strictEqual(typeof CsrfMiddleware(), 'function')
  })

  it('skips GET requests without validation', async () => {
    let reached = false
    await CsrfMiddleware()(makeReq({ method: 'GET' }), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('skips HEAD requests without validation', async () => {
    let reached = false
    await CsrfMiddleware()(makeReq({ method: 'HEAD' }), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('skips OPTIONS requests without validation', async () => {
    let reached = false
    await CsrfMiddleware()(makeReq({ method: 'OPTIONS' }), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('rejects POST with no token — 419', async () => {
    const bag = makeRes()
    await CsrfMiddleware()(
      makeReq({ method: 'POST', headers: { cookie: 'csrf_token=abc123' } }),
      bag.res,
      async () => {}
    )
    assert.strictEqual(bag.getStatus(), 419)
  })

  it('rejects POST with mismatched token — 419', async () => {
    const bag = makeRes()
    await CsrfMiddleware()(
      makeReq({
        method: 'POST',
        headers: { cookie: 'csrf_token=abc123', 'x-csrf-token': 'wrong' },
      }),
      bag.res,
      async () => {}
    )
    assert.strictEqual(bag.getStatus(), 419)
  })

  it('allows POST with matching token in header', async () => {
    const token = 'a'.repeat(64)
    let reached = false
    await CsrfMiddleware()(
      makeReq({
        method: 'POST',
        headers: { cookie: `csrf_token=${token}`, 'x-csrf-token': token },
      }),
      makeRes().res,
      async () => { reached = true }
    )
    assert.ok(reached)
  })

  it('allows POST with matching token in body field', async () => {
    const token = 'b'.repeat(64)
    let reached = false
    await CsrfMiddleware()(
      makeReq({
        method: 'POST',
        headers: { cookie: `csrf_token=${token}` },
        body: { _token: token },
      }),
      makeRes().res,
      async () => { reached = true }
    )
    assert.ok(reached)
  })

  it('sets csrf_token cookie on GET when not present', async () => {
    const bag = makeRes()
    await CsrfMiddleware()(makeReq({ method: 'GET', headers: {} }), bag.res, async () => {})
    const cookie = bag.headers.get('set-cookie')
    assert.ok(cookie?.startsWith('csrf_token='))
  })

  it('skips excluded paths', async () => {
    let reached = false
    await CsrfMiddleware({ exclude: ['/api/*'] })(
      makeReq({ method: 'POST', path: '/api/webhook' }),
      makeRes().res,
      async () => { reached = true }
    )
    assert.ok(reached)
  })

  it('skips static asset paths', async () => {
    let reached = false
    await CsrfMiddleware()(
      makeReq({ method: 'POST', path: '/assets/app.css' }),
      makeRes().res,
      async () => { reached = true }
    )
    assert.ok(reached)
  })

  it('respects custom cookieName and headerName options', async () => {
    const token = 'c'.repeat(64)
    let reached = false
    await CsrfMiddleware({ cookieName: 'my_csrf', headerName: 'x-my-csrf' })(
      makeReq({
        method: 'POST',
        headers: { cookie: `my_csrf=${token}`, 'x-my-csrf': token },
      }),
      makeRes().res,
      async () => { reached = true }
    )
    assert.ok(reached)
  })
})

// ─── getCsrfToken() ────────────────────────────────────────

describe('getCsrfToken()', () => {
  it('returns empty string in non-browser environment (no document)', () => {
    assert.strictEqual(getCsrfToken(), '')
  })
})

// ─── RateLimit ─────────────────────────────────────────────

describe('RateLimit', () => {
  let cache: ReturnType<typeof makeMemoryCache>

  beforeEach(() => {
    cache = makeMemoryCache()
    CacheRegistry.set(cache)
  })

  afterEach(() => {
    ;(CacheRegistry as unknown as { adapter: null }).adapter = null
  })

  it('perMinute() factory returns a MiddlewareHandler', () => {
    assert.strictEqual(typeof RateLimit.perMinute(10), 'function')
  })

  it('perHour() factory returns a MiddlewareHandler', () => {
    assert.strictEqual(typeof RateLimit.perHour(100), 'function')
  })

  it('perDay() factory returns a MiddlewareHandler', () => {
    assert.strictEqual(typeof RateLimit.perDay(1000), 'function')
  })

  it('per() factory accepts custom window', () => {
    assert.strictEqual(typeof RateLimit.per(5, 30_000), 'function')
  })

  it('sets X-RateLimit-* headers', async () => {
    const handler = RateLimit.perMinute(10)
    const bag = makeRes()
    await handler(makeReq({ ip: '1.1.1.1' }), bag.res, async () => {})
    assert.ok(bag.headers.has('x-ratelimit-limit'))
    assert.ok(bag.headers.has('x-ratelimit-remaining'))
    assert.ok(bag.headers.has('x-ratelimit-reset'))
    assert.strictEqual(bag.headers.get('x-ratelimit-limit'), '10')
  })

  it('calls next when under the limit', async () => {
    const handler = RateLimit.perMinute(5)
    let reached = false
    await handler(makeReq({ ip: '2.2.2.2' }), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('returns 429 when limit is exceeded', async () => {
    const handler = RateLimit.perMinute(1)
    const req = makeReq({ ip: '3.3.3.3' })
    await handler(req, makeRes().res, async () => {})
    const bag = makeRes()
    await handler(req, bag.res, async () => {})
    assert.strictEqual(bag.getStatus(), 429)
  })

  it('fails open when no cache is configured', async () => {
    ;(CacheRegistry as unknown as { adapter: null }).adapter = null
    let reached = false
    await RateLimit.perMinute(1)(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('skips static asset paths', async () => {
    const handler = RateLimit.perMinute(0)
    let passed = false
    await handler(makeReq({ path: '/assets/app.js' }), makeRes().res, async () => { passed = true })
    assert.ok(passed)
  })

  it('.message() overrides the 429 body', async () => {
    const handler = RateLimit.perMinute(0).message('Slow down!')
    const bag = makeRes()
    await handler(makeReq({ ip: '4.4.4.4' }), bag.res, async () => {})
    assert.deepStrictEqual(bag.getJson(), { message: 'Slow down!' })
  })

  it('.skipIf() bypasses rate limiting when predicate returns true', async () => {
    const handler = RateLimit.perMinute(0).skipIf(() => true)
    let reached = false
    await handler(makeReq(), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('.byRoute() keys by method:path', async () => {
    const handler = RateLimit.perMinute(1).byRoute()
    const req1 = makeReq({ method: 'GET',  path: '/a' })
    const req2 = makeReq({ method: 'POST', path: '/a' })
    let count = 0
    // Each unique method:path combo has its own counter
    await handler(req1, makeRes().res, async () => { count++ })
    await handler(req2, makeRes().res, async () => { count++ })
    assert.strictEqual(count, 2)
  })

  it('.by(fn) keys by custom extractor', async () => {
    const handler = RateLimit.perMinute(1).by(req => req.headers['x-tenant-id'] ?? 'anon')
    const req = makeReq({ headers: { 'x-tenant-id': 'tenant-1' } })
    let count = 0
    await handler(req, makeRes().res, async () => { count++ })
    const bag = makeRes()
    await handler(req, bag.res, async () => { count++ })
    assert.strictEqual(count, 1)
    assert.strictEqual(bag.getStatus(), 429)
  })

  it('.byIp() returns a new handler keyed by IP', async () => {
    const handler = RateLimit.perMinute(1).byIp()
    const req = makeReq({ ip: '5.5.5.5' })
    let count = 0
    await handler(req, makeRes().res, async () => { count++ })
    const bag = makeRes()
    await handler(req, bag.res, async () => { count++ })
    assert.strictEqual(count, 1)
    assert.strictEqual(bag.getStatus(), 429)
  })

  // Regression — 50 concurrent requests against `perMinute(5)` must let
  // exactly 5 pass through. Before atomic increment landed the counter was
  // get → modify → set, so racing requests would both read N and both write
  // N+1, doubling (or worse) the effective limit. RFC 6819 §5.2.2.3.
  it('rejects all but the configured limit under concurrent load', async () => {
    const handler = RateLimit.perMinute(5)
    const ip = '9.9.9.9'

    const results = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const bag = makeRes()
        let reached = false
        await handler(makeReq({ ip }), bag.res, async () => { reached = true })
        return { status: bag.getStatus(), reached }
      }),
    )

    const allowed = results.filter((r: { reached: boolean }) => r.reached).length
    const blocked = results.filter((r: { status: number }) => r.status === 429).length
    assert.strictEqual(allowed, 5,  `expected 5 to pass, got ${allowed}`)
    assert.strictEqual(blocked, 45, `expected 45 to be blocked, got ${blocked}`)
  })

  // Regression — separate limiter instances must own separate buckets even
  // when they key by the same identifier (e.g. IP). Before per-instance ID
  // namespacing landed, the cache key was `rudderjs:rl:<ip>` and every
  // ip-keyed limiter in the app shared a single bucket — so a tight 5/min
  // sign-up limiter would burn its quota on unrelated 60/min global GETs.
  // Surfaced by the scaffolder-render E2E once `BaseAuthController` default
  // rate-limits landed alongside the playground's global `RateLimit.perMinute(60)`.
  it('separate RateLimit instances do not share a bucket when keyed by the same identifier', async () => {
    const tight = RateLimit.perMinute(2)
    const loose = RateLimit.perMinute(50)
    const ip = '7.7.7.7'

    // Fill `loose` to 10 requests — would push the shared bucket past `tight`'s
    // limit of 2 if buckets were shared.
    for (let i = 0; i < 10; i++) {
      await loose(makeReq({ ip }), makeRes().res, async () => {})
    }

    // `tight`'s own bucket should be empty — first 2 hits pass, 3rd 429s.
    const statuses: number[] = []
    for (let i = 0; i < 3; i++) {
      const bag = makeRes()
      await tight(makeReq({ ip }), bag.res, async () => {})
      statuses.push(bag.getStatus())
    }

    assert.notStrictEqual(statuses[0], 429, `tight #1: ${statuses.join(',')}`)
    assert.notStrictEqual(statuses[1], 429, `tight #2: ${statuses.join(',')}`)
    assert.strictEqual(statuses[2],    429, `tight #3 should 429 on its own bucket: ${statuses.join(',')}`)
  })

  it('a shared RateLimit handler reference DOES share a bucket across routes (Laravel-style named limiter)', async () => {
    // Whoever needs a shared limit constructs ONE handler and applies it
    // multiple times — same instance id → same bucket. This is the
    // documented use case `m.web(RateLimit.perMinute(60))` relies on.
    const shared = RateLimit.perMinute(3)
    const ip = '8.8.8.8'

    // Two routes, same handler reference — 4th call should 429 regardless
    // of which "route" it came from.
    await shared(makeReq({ ip, url: '/a' }), makeRes().res, async () => {})
    await shared(makeReq({ ip, url: '/b' }), makeRes().res, async () => {})
    await shared(makeReq({ ip, url: '/a' }), makeRes().res, async () => {})

    const bag = makeRes()
    await shared(makeReq({ ip, url: '/b' }), bag.res, async () => {})
    assert.strictEqual(bag.getStatus(), 429)
  })

  // Regression — the headline per-IP contract: two clients with different
  // `req.ip` values get SEPARATE buckets on the same handler. Before the
  // fixtures carried `req.ip`, every request keyed to the shared 'unknown'
  // bucket and this behavior was unverifiable (the old `x-real-ip` header
  // fixtures were inert — production keying reads `req.ip` only).
  it('different req.ip values get separate buckets on one handler', async () => {
    const handler = RateLimit.perMinute(2)

    // Client A exhausts its bucket.
    await handler(makeReq({ ip: '10.0.0.1' }), makeRes().res, async () => {})
    await handler(makeReq({ ip: '10.0.0.1' }), makeRes().res, async () => {})
    const aBlocked = makeRes()
    await handler(makeReq({ ip: '10.0.0.1' }), aBlocked.res, async () => {})
    assert.strictEqual(aBlocked.getStatus(), 429, 'client A should be limited')

    // Client B is untouched by A's consumption.
    const bBag = makeRes()
    let bReached = false
    await handler(makeReq({ ip: '10.0.0.2' }), bBag.res, async () => { bReached = true })
    assert.ok(bReached, 'client B must not share client A\'s bucket')
    assert.notStrictEqual(bBag.getStatus(), 429)
  })
})
