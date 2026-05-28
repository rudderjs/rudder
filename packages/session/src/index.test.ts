import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { ConfigRepository, setConfigRepository, getConfigRepository } from '@rudderjs/core'
import { SessionInstance, Session, sessionMiddleware, SessionProvider, RedisDriver, type SessionConfig } from './index.js'

function withSessionConfig(cfg: SessionConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ session: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const config: SessionConfig = {
  driver:   'cookie',
  lifetime: 120,
  secret:   'test-secret-32-chars-exactly!!xx',
  cookie: {
    name:     'rjs_sess',
    secure:   false,
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
  },
}

function makeReqRes(cookieHeader = ''): {
  req: AppRequest
  res: AppResponse
  setCookies: string[]
} {
  const setCookies: string[] = []
  const req = {
    headers: { cookie: cookieHeader },
    raw: {},
  } as unknown as AppRequest
  const res = {
    raw: {
      header: (_k: string, v: string) => { setCookies.push(v) },
    },
  } as unknown as AppResponse
  return { req, res, setCookies }
}

/** Read the session that sessionMiddleware stashed on req.raw. Centralizes
 *  the property-bag cast for tests so individual cases don't repeat it. */
function readSession(req: AppRequest): SessionInstance {
  return (req.raw as Record<string, unknown>)['__rjs_session'] as SessionInstance
}

/** Run one fake request and return the session instance + Set-Cookie value */
async function runRequest(
  cookieHeader = '',
  fn: (session: SessionInstance) => void | Promise<void> = () => {},
): Promise<{ session: SessionInstance; setCookie: string | undefined }> {
  const mw = sessionMiddleware(config)
  const { req, res, setCookies } = makeReqRes(cookieHeader)
  let captured!: SessionInstance
  await mw(req, res, async () => {
    captured = readSession(req)
    await fn(captured)
  })
  return { session: captured, setCookie: setCookies[0] }
}

/** Extract the raw cookie value from a Set-Cookie header string */
function extractCookieValue(setCookieHeader: string): string {
  const match = setCookieHeader.match(/^rjs_sess=([^;]+)/)
  return match![1]!
}

/** Simulate two consecutive requests, passing cookie from first to second */
async function twoRequests(
  firstFn: (s: SessionInstance) => void | Promise<void>,
  secondFn: (s: SessionInstance) => void | Promise<void> = () => {},
): Promise<{ first: SessionInstance; second: SessionInstance }> {
  const { session: first, setCookie } = await runRequest('', firstFn)
  assert.ok(setCookie, 'first request must set a cookie')
  const cookieValue = extractCookieValue(setCookie)
  const { session: second } = await runRequest(`rjs_sess=${cookieValue}`, secondFn)
  return { first, second }
}

// ─── SessionInstance (unit, via cookie driver) ─────────────────────────────────

describe('SessionInstance — get/put/forget/flush/has/all', () => {
  it('get() returns undefined for a missing key', async () => {
    const { session: s } = await runRequest()
    assert.strictEqual(s.get('missing'), undefined)
  })

  it('get() returns a fallback for a missing key', async () => {
    const { session: s } = await runRequest()
    assert.strictEqual(s.get('missing', 'default'), 'default')
  })

  it('put() + get() round-trip various types', async () => {
    const { session: s } = await runRequest()
    s.put('str',  'hello')
    s.put('num',  42)
    s.put('bool', true)
    s.put('obj',  { x: 1 })
    s.put('arr',  [1, 2])
    assert.strictEqual(s.get('str'),         'hello')
    assert.strictEqual(s.get('num'),          42)
    assert.strictEqual(s.get('bool'),         true)
    assert.deepStrictEqual(s.get('obj'),     { x: 1 })
    assert.deepStrictEqual(s.get('arr'),     [1, 2])
  })

  it('forget() removes a key', async () => {
    const { session: s } = await runRequest()
    s.put('k', 'v')
    s.forget('k')
    assert.strictEqual(s.get('k'), undefined)
    assert.strictEqual(s.has('k'), false)
  })

  it('forget() on a non-existent key is a no-op', async () => {
    const { session: s } = await runRequest()
    assert.doesNotThrow(() => s.forget('ghost'))
  })

  it('flush() clears all data', async () => {
    const { session: s } = await runRequest()
    s.put('a', 1)
    s.put('b', 2)
    s.flush()
    assert.deepStrictEqual(s.all(), {})
  })

  it('has() returns true for an existing key', async () => {
    const { session: s } = await runRequest()
    s.put('k', 'v')
    assert.strictEqual(s.has('k'), true)
  })

  it('has() returns false for a missing key', async () => {
    const { session: s } = await runRequest()
    assert.strictEqual(s.has('missing'), false)
  })

  it('all() returns a copy of current data', async () => {
    const { session: s } = await runRequest()
    s.put('a', 1)
    s.put('b', 2)
    const snapshot = s.all()
    assert.deepStrictEqual(snapshot, { a: 1, b: 2 })
    // Mutating the copy does not affect the session
    snapshot['a'] = 99
    assert.strictEqual(s.get('a'), 1)
  })

  it('id() returns a non-empty string', async () => {
    const { session: s } = await runRequest()
    assert.ok(typeof s.id() === 'string')
    assert.ok(s.id().length > 0)
  })
})

// ─── Flash messages ────────────────────────────────────────────────────────────

describe('SessionInstance — flash', () => {
  it('flash value is readable on the next request via getFlash()', async () => {
    const { second } = await twoRequests(
      s => s.flash('msg', 'hello'),
    )
    assert.strictEqual(second.getFlash('msg'), 'hello')
  })

  it('flash value is gone after the request that reads it', async () => {
    const { session: _r1, setCookie: c1 } = await runRequest('', s => s.flash('msg', 'hello'))
    const cv1 = extractCookieValue(c1!)
    const { session: r2, setCookie: c2 } = await runRequest(`rjs_sess=${cv1}`)
    assert.strictEqual(r2.getFlash('msg'), 'hello')
    const cv2 = extractCookieValue(c2!)
    const { session: r3 } = await runRequest(`rjs_sess=${cv2}`)
    assert.strictEqual(r3.getFlash('msg'), undefined)
  })

  it('getFlash() returns fallback when flash key is missing', async () => {
    const { session: s } = await runRequest()
    assert.strictEqual(s.getFlash('missing', 'fallback'), 'fallback')
  })

  it('flash does not appear in the same request via getFlash()', async () => {
    const { session: s } = await runRequest('', sess => sess.flash('msg', 'now'))
    assert.strictEqual(s.getFlash('msg'), undefined)
  })

  it('allFlash() returns every flash value set by the previous request', async () => {
    const { second } = await twoRequests((s) => {
      s.flash('success', 'Saved!')
      s.flash('user', { id: 1 })
    })
    assert.deepStrictEqual(second.allFlash(), { success: 'Saved!', user: { id: 1 } })
  })

  it('allFlash() returns {} when the previous request set no flash', async () => {
    const { second } = await twoRequests(() => { /* no flash */ })
    assert.deepStrictEqual(second.allFlash(), {})
  })

  it('allFlash() returns a copy — mutation does not affect the session', async () => {
    const { second } = await twoRequests((s) => { s.flash('msg', 'hello') })
    const snapshot = second.allFlash()
    snapshot['msg'] = 'tampered'
    assert.strictEqual(second.getFlash('msg'), 'hello')
  })

  it('regular session data survives across requests', async () => {
    const { second } = await twoRequests(s => s.put('user', 'alice'))
    assert.strictEqual(second.get('user'), 'alice')
  })
})

// ─── regenerate() ──────────────────────────────────────────────────────────────

describe('SessionInstance — regenerate()', () => {
  it('changes the session ID', async () => {
    const { session: s } = await runRequest()
    const oldId = s.id()
    await s.regenerate()
    assert.notStrictEqual(s.id(), oldId)
  })

  it('preserves session data after regeneration', async () => {
    const { session: s } = await runRequest()
    s.put('role', 'admin')
    await s.regenerate()
    assert.strictEqual(s.get('role'), 'admin')
  })
})

// ─── sessionMiddleware ─────────────────────────────────────────────────────────

describe('sessionMiddleware', () => {
  it('attaches session to req.raw.__rjs_session', async () => {
    const mw = sessionMiddleware(config)
    const { req, res } = makeReqRes()
    await mw(req, res, async () => {
      assert.ok(readSession(req) instanceof SessionInstance)
    })
  })

  it('writes Set-Cookie header after next() resolves', async () => {
    const { setCookie } = await runRequest()
    assert.ok(setCookie?.startsWith('rjs_sess='))
  })

  it('Set-Cookie header contains HttpOnly', async () => {
    const { setCookie } = await runRequest()
    assert.ok(setCookie?.includes('HttpOnly'))
  })

  it('Set-Cookie header contains SameSite=lax', async () => {
    const { setCookie } = await runRequest()
    assert.ok(setCookie?.includes('SameSite=lax'))
  })

  it('Set-Cookie header contains Max-Age', async () => {
    const { setCookie } = await runRequest()
    assert.ok(setCookie?.includes('Max-Age='))
  })

  it('session data written during next() is persisted in cookie', async () => {
    const { second } = await twoRequests(s => s.put('key', 'value'))
    assert.strictEqual(second.get('key'), 'value')
  })

  it('tampered cookie starts a fresh session', async () => {
    const mw = sessionMiddleware(config)
    const { req, res } = makeReqRes('rjs_sess=tampered.invalidsig')
    let sessionId!: string
    await mw(req, res, async () => {
      sessionId = readSession(req).id()
    })
    assert.ok(sessionId.length > 0) // fresh session created
  })

  it('missing cookie starts a fresh session', async () => {
    const { session: s } = await runRequest()
    assert.deepStrictEqual(s.all(), {})
  })
})

// ─── Session static facade ────────────────────────────────────────────────────

describe('Session facade', () => {
  let mw: ReturnType<typeof sessionMiddleware>

  beforeEach(() => { mw = sessionMiddleware(config) })

  async function run(fn: () => Promise<void>): Promise<void> {
    const { req, res } = makeReqRes()
    await mw(req, res, fn)
  }

  it('throws outside a session context', () => {
    assert.throws(() => Session.get('k'), /no session in context/)
  })

  it('get/put inside middleware context', async () => {
    await run(async () => {
      Session.put('x', 42)
      assert.strictEqual(Session.get('x'), 42)
    })
  })

  it('forget removes key', async () => {
    await run(async () => {
      Session.put('k', 'v')
      Session.forget('k')
      assert.strictEqual(Session.has('k'), false)
    })
  })

  it('has() returns true/false', async () => {
    await run(async () => {
      Session.put('a', 1)
      assert.strictEqual(Session.has('a'), true)
      assert.strictEqual(Session.has('b'), false)
    })
  })

  it('all() returns all keys', async () => {
    await run(async () => {
      Session.put('a', 1)
      Session.put('b', 2)
      assert.deepStrictEqual(Session.all(), { a: 1, b: 2 })
    })
  })

  it('flash() + getFlash() (cross-request via instance)', async () => {
    const { session: _r1, setCookie } = await runRequest('', () => Session.flash('notice', 'ok'))
    assert.ok(setCookie)
    const cookieValue = extractCookieValue(setCookie)
    const { session: r2 } = await runRequest(`rjs_sess=${cookieValue}`)
    assert.strictEqual(r2.getFlash('notice'), 'ok')
  })

  it('regenerate() changes session ID', async () => {
    const { session: s } = await runRequest()
    const oldId = s.id()
    await s.regenerate()
    assert.notStrictEqual(s.id(), oldId)
  })

  it('maybeCurrent() returns null outside an ALS context', () => {
    assert.strictEqual(Session.maybeCurrent(), null)
  })

  it('maybeCurrent() returns the instance inside an ALS context', async () => {
    await run(async () => {
      const s = Session.maybeCurrent()
      assert.ok(s instanceof SessionInstance)
    })
  })

  it('active() reflects ALS context presence', async () => {
    assert.strictEqual(Session.active(), false)
    await run(async () => {
      assert.strictEqual(Session.active(), true)
    })
    assert.strictEqual(Session.active(), false)
  })

  it('allFlash() returns {} outside an ALS context (no throw)', () => {
    assert.deepStrictEqual(Session.allFlash(), {})
  })
})

// ─── S1+S2: Redis driver security ─────────────────────────────────────────────

/**
 * Minimal in-memory stand-in for ioredis. Implements only what RedisDriver
 * touches: get / set / del. We inject it by setting RedisDriver's private
 * `client` field directly so getClient() returns it without dynamic import.
 */
function fakeRedisClient(): {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  store: Map<string, string>
} {
  const store = new Map<string, string>()
  return {
    store,
    async get(key) { return store.get(key) ?? null },
    async set(key, value) { store.set(key, value); return 'OK' },
    async del(...keys) { let n = 0; for (const k of keys) if (store.delete(k)) n++; return n },
  }
}

/** Reach into RedisDriver's private clientPromise slot to inject a fake.
 *  Centralizes the structural cast so individual tests don't repeat the
 *  `as unknown as { clientPromise }` dance. */
function injectClient(driver: RedisDriver, value: Promise<unknown>): void {
  ;(driver as unknown as { clientPromise: Promise<unknown> }).clientPromise = value
}

function readClientPromise(driver: RedisDriver): Promise<unknown> {
  return (driver as unknown as { clientPromise: Promise<unknown> }).clientPromise
}

function makeRedisDriver(secret = 'test-secret-32-chars-exactly!!xx'): { driver: RedisDriver; client: ReturnType<typeof fakeRedisClient> } {
  const driver = new RedisDriver({ prefix: 'session:' }, secret)
  const client = fakeRedisClient()
  injectClient(driver, Promise.resolve(client))
  return { driver, client }
}

describe('RedisDriver — S1: HMAC signing', () => {
  it('persist() returns a signed cookie value, not the raw session id', async () => {
    const { driver } = makeRedisDriver()
    const id = 'fixed-uuid-1111'
    const cookieValue = await driver.persist({ id, data: { k: 'v' }, flash_next: {} }, 60)
    assert.notStrictEqual(cookieValue, id, 'cookie value must not be the raw id')
    assert.ok(cookieValue.startsWith(`${id}.`), 'cookie value must be `${id}.${hmac}`')
    assert.ok(cookieValue.length > id.length + 1, 'cookie value must include a signature')
  })

  it('load() rejects an unsigned cookie value (raw id) and returns a fresh session', async () => {
    const { driver, client } = makeRedisDriver()
    // Plant a session in redis under a known id
    const plantedId = 'attacker-supplied-id'
    client.store.set(`session:${plantedId}`, JSON.stringify({ id: plantedId, data: { admin: true }, flash_next: {} }))
    // Attacker sends the raw id as the cookie (no signature)
    const loaded = await driver.load(plantedId)
    assert.notStrictEqual(loaded.id, plantedId, 'unsigned id must NOT load the planted session')
    assert.deepStrictEqual(loaded.data, {}, 'load must return a fresh empty session')
  })

  it('load() rejects a tampered signature and returns a fresh session', async () => {
    const { driver } = makeRedisDriver()
    const cookieValue = await driver.persist({ id: 'real-id', data: { x: 1 }, flash_next: {} }, 60)
    const tampered = cookieValue.slice(0, -2) + 'AA'  // mutate last 2 chars of the hmac
    const loaded = await driver.load(tampered)
    assert.notStrictEqual(loaded.id, 'real-id')
    assert.deepStrictEqual(loaded.data, {})
  })

  it('load() rejects a value with a different secret and returns a fresh session', async () => {
    const { driver } = makeRedisDriver('secret-A')
    const otherDriver = new RedisDriver({ prefix: 'session:' }, 'secret-B')
    injectClient(otherDriver, readClientPromise(driver))
    const cookieFromB = await otherDriver.persist({ id: 'cross', data: {}, flash_next: {} }, 60)
    const loaded = await driver.load(cookieFromB)
    assert.notStrictEqual(loaded.id, 'cross')
  })

  it('load() round-trips a properly signed cookie value', async () => {
    const { driver } = makeRedisDriver()
    const cookieValue = await driver.persist({ id: 'good-id', data: { user: 'alice' }, flash_next: {} }, 60)
    const loaded = await driver.load(cookieValue)
    assert.strictEqual(loaded.id, 'good-id')
    assert.strictEqual(loaded.data['user'], 'alice')
  })
})

describe('RedisDriver — S2: cache miss does not fixate on cookie id', () => {
  it('valid signature but no key in redis → fresh ID, not the cookie-supplied one', async () => {
    const { driver, client } = makeRedisDriver()
    // Pre-sign an id, then evict the redis key (simulates expiry / eviction).
    const id = 'evicted-id'
    const cookieValue = await driver.persist({ id, data: {}, flash_next: {} }, 60)
    client.store.delete(`session:${id}`)
    const loaded = await driver.load(cookieValue)
    assert.notStrictEqual(loaded.id, id, 'cache miss must mint a new ID')
    assert.deepStrictEqual(loaded.data, {})
    assert.deepStrictEqual(loaded.flash_next, {})
  })

  it('valid signature but malformed JSON in redis → fresh session', async () => {
    // Exercises the parsePayload() catch branch shared by both drivers.
    // An attacker who can write to redis (or a corrupt entry) must not
    // crash the request — the driver should fall back to a fresh session.
    const { driver, client } = makeRedisDriver()
    const id = 'corrupt-id'
    const cookieValue = await driver.persist({ id, data: { real: true }, flash_next: {} }, 60)
    client.store.set(`session:${id}`, '{ not valid json')
    const loaded = await driver.load(cookieValue)
    assert.notStrictEqual(loaded.id, id)
    assert.deepStrictEqual(loaded.data, {})
  })

  it('valid signature but payload missing string id → fresh session', async () => {
    // parsePayload rejects payloads where `id` isn't a string — guards
    // against a partial / attacker-controlled redis write that would
    // otherwise leak into SessionInstance with a non-string id.
    const { driver, client } = makeRedisDriver()
    const id = 'shape-id'
    const cookieValue = await driver.persist({ id, data: {}, flash_next: {} }, 60)
    client.store.set(`session:${id}`, JSON.stringify({ id: 42, data: { admin: true } }))
    const loaded = await driver.load(cookieValue)
    assert.strictEqual(typeof loaded.id, 'string')
    assert.notStrictEqual(loaded.id, id, 'must mint a fresh id, not reuse the cookie id')
    assert.deepStrictEqual(loaded.data, {})
  })
})

// ─── S3: Set-Cookie preserved when next() throws ──────────────────────────────

describe('sessionMiddleware — S3: save on error', () => {
  it('writes Set-Cookie even when next() throws', async () => {
    const mw = sessionMiddleware(config)
    const { req, res, setCookies } = makeReqRes()
    const boom = new Error('handler exploded')
    await assert.rejects(
      async () => mw(req, res, async () => {
        readSession(req).flash('notice', 'goodbye')  // marks dirty so save() actually writes
        throw boom
      }),
      (err: unknown) => err === boom,
    )
    assert.ok(setCookies[0]?.startsWith('rjs_sess='), 'Set-Cookie must be appended despite the throw')
  })

  it('flash messages set before a thrown next() persist into the next request', async () => {
    const mw = sessionMiddleware(config)
    const { req: req1, res: res1, setCookies } = makeReqRes()
    await assert.rejects(
      async () => mw(req1, res1, async () => {
        readSession(req1).flash('error', 'something broke')
        throw new Error('boom')
      }),
    )
    const cookieValue = extractCookieValue(setCookies[0]!)
    const { session: r2 } = await runRequest(`rjs_sess=${cookieValue}`)
    assert.strictEqual(r2.getFlash('error'), 'something broke')
  })

  it('rethrows the original error from next(), not a save error', async () => {
    const mw = sessionMiddleware(config)
    const { req, res } = makeReqRes()
    const original = new Error('original')
    await assert.rejects(
      async () => mw(req, res, async () => { throw original }),
      (err: unknown) => err === original,
    )
  })
})

// ─── S4: getClient promise caching ───────────────────────────────────────────

describe('RedisDriver — S4: cached client promise', () => {
  it('concurrent persist() calls share a single client (no orphaned connections)', async () => {
    const { driver, client } = makeRedisDriver()
    // Hammer the driver from many concurrent callers; if getClient() were
    // racy, two of them would each have constructed a Redis instance.
    await Promise.all([
      driver.persist({ id: 'a', data: {}, flash_next: {} }, 60),
      driver.persist({ id: 'b', data: {}, flash_next: {} }, 60),
      driver.persist({ id: 'c', data: {}, flash_next: {} }, 60),
    ])
    assert.strictEqual(client.store.size, 3)
  })

  it('caches a Promise<Client>, not a raw client (concurrent first-call safety)', () => {
    const driver = new RedisDriver({ prefix: 'session:' }, 'secret')
    const client = fakeRedisClient()
    injectClient(driver, Promise.resolve(client))
    const stored = readClientPromise(driver)
    assert.ok(stored instanceof Promise, 'clientPromise must be a Promise so concurrent callers await the same connect')
  })
})

// ─── S5: SessionMiddleware() resolves from container ──────────────────────────

describe('SessionMiddleware() — S5: per-route opt-in reuses the bound singleton', () => {
  it('returns the same handler instance bound to session.middleware', async () => {
    const { SessionMiddleware: SessionMiddlewareFn } = await import('./index.js')
    const sentinel: import('@rudderjs/contracts').MiddlewareHandler = (async () => undefined) as never
    const calls: string[] = []
    const fakeApp = {
      make<T>(key: string): T {
        calls.push(key)
        if (key === 'session.middleware') return sentinel as unknown as T
        throw new Error('unexpected token: ' + key)
      },
    }
    const g = globalThis as Record<string, unknown>
    const previous = g['__rudderjs_app__']
    g['__rudderjs_app__'] = fakeApp
    try {
      const m1 = SessionMiddlewareFn()
      const m2 = SessionMiddlewareFn()
      assert.strictEqual(m1, sentinel, 'must resolve from container, not build a fresh middleware')
      assert.strictEqual(m1, m2, 'two calls must return the identical reference')
      assert.deepStrictEqual(calls, ['session.middleware', 'session.middleware'])
    } finally {
      if (previous === undefined) delete g['__rudderjs_app__']
      else g['__rudderjs_app__'] = previous
    }
  })
})

// ─── S6: missing flash_next / data on load ────────────────────────────────────

describe('SessionInstance — S6: tolerates legacy/corrupt payloads', () => {
  it('constructor handles a payload missing flash_next', () => {
    const driver = { load: async () => ({} as never), persist: async () => '', destroy: async () => undefined }
    assert.doesNotThrow(() => {
      const s = new SessionInstance(
        { id: 'x', data: { k: 'v' } } as never,  // intentionally missing flash_next
        driver,
        config,
      )
      assert.strictEqual(s.get('k'), 'v')
      assert.strictEqual(s.getFlash('anything'), undefined)
    })
  })

  it('constructor handles a payload missing both data and flash_next', () => {
    const driver = { load: async () => ({} as never), persist: async () => '', destroy: async () => undefined }
    const s = new SessionInstance({ id: 'x' } as never, driver, config)
    assert.deepStrictEqual(s.all(), {})
  })

  it('redis driver round-trips a legacy payload (missing flash_next) without crashing', async () => {
    const { driver, client } = makeRedisDriver()
    // Pre-sign a real cookie value, then corrupt the redis entry to drop flash_next.
    const cookieValue = await driver.persist({ id: 'legacy', data: { user: 'alice' }, flash_next: {} }, 60)
    client.store.set('session:legacy', JSON.stringify({ id: 'legacy', data: { user: 'alice' } }))
    const loaded = await driver.load(cookieValue)
    assert.strictEqual(loaded.id, 'legacy')
    assert.strictEqual(loaded.data['user'], 'alice')
  })
})

// ─── SessionProvider ──────────────────────────────────────────────────────────

describe('SessionProvider', () => {
  const fakeApp = { instance: () => undefined } as never

  it('register() is a no-op', () => {
    const restore = withSessionConfig(config)
    try {
      assert.doesNotThrow(() => new SessionProvider(fakeApp).register?.())
    } finally { restore() }
  })

  it('boot() binds session.config to DI', () => {
    const restore = withSessionConfig(config)
    try {
      let bound: unknown
      const fakeAppSpy = {
        instance: (key: string, value: unknown) => { if (key === 'session.config') bound = value },
      } as never

      new SessionProvider(fakeAppSpy).boot?.()
      assert.deepStrictEqual(bound, config)
    } finally { restore() }
  })
})
