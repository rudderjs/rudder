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
  return {
    async get<T>(key: string): Promise<T | null> {
      const rec = store.get(key)
      if (!rec || Date.now() > rec.expiresAt) return null
      return rec.value as T
    },
    async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    },
    async forget(key: string): Promise<void> { store.delete(key) },
    async has(key: string): Promise<boolean> {
      const rec = store.get(key)
      return !!rec && Date.now() <= rec.expiresAt
    },
    async flush(): Promise<void> { store.clear() },
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
  it('sets CORS headers from explicit options', async () => {
    const bag = makeRes()
    await new CorsMiddleware({
      origin:  ['https://a.dev', 'https://b.dev'],
      methods: ['GET', 'POST'],
      headers: ['Content-Type'],
    }).handle(makeReq(), bag.res, async () => {})
    assert.strictEqual(bag.headers.get('access-control-allow-origin'),  'https://a.dev, https://b.dev')
    assert.strictEqual(bag.headers.get('access-control-allow-methods'), 'GET, POST')
    assert.strictEqual(bag.headers.get('access-control-allow-headers'), 'Content-Type')
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
    const req = makeReq({ headers: { 'x-real-ip': '1.2.3.4' } })
    let count = 0
    for (let i = 0; i < 3; i++) {
      await throttle.handle(req, makeRes().res, async () => { count++ })
    }
    assert.strictEqual(count, 3)
  })

  it('blocks at the limit with 429', async () => {
    const throttle = new ThrottleMiddleware(2, 10_000)
    const req = makeReq({ headers: { 'x-real-ip': '1.2.3.5' } })
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
    await handler(makeReq({ headers: { 'x-real-ip': '1.1.1.1' } }), bag.res, async () => {})
    assert.ok(bag.headers.has('x-ratelimit-limit'))
    assert.ok(bag.headers.has('x-ratelimit-remaining'))
    assert.ok(bag.headers.has('x-ratelimit-reset'))
    assert.strictEqual(bag.headers.get('x-ratelimit-limit'), '10')
  })

  it('calls next when under the limit', async () => {
    const handler = RateLimit.perMinute(5)
    let reached = false
    await handler(makeReq({ headers: { 'x-real-ip': '2.2.2.2' } }), makeRes().res, async () => { reached = true })
    assert.ok(reached)
  })

  it('returns 429 when limit is exceeded', async () => {
    const handler = RateLimit.perMinute(1)
    const req = makeReq({ headers: { 'x-real-ip': '3.3.3.3' } })
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
    await handler(makeReq({ headers: { 'x-real-ip': '4.4.4.4' } }), bag.res, async () => {})
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
    const req = makeReq({ headers: { 'x-real-ip': '5.5.5.5' } })
    let count = 0
    await handler(req, makeRes().res, async () => { count++ })
    const bag = makeRes()
    await handler(req, bag.res, async () => { count++ })
    assert.strictEqual(count, 1)
    assert.strictEqual(bag.getStatus(), 429)
  })
})
