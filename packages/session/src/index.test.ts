import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@boostkit/contracts'
import { SessionInstance, Session, sessionMiddleware, session, type SessionConfig } from './index.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const config: SessionConfig = {
  driver:   'cookie',
  lifetime: 120,
  secret:   'test-secret-32-chars-exactly!!xx',
  cookie: {
    name:     'bk_sess',
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

/** Run one fake request and return the session instance + Set-Cookie value */
async function runRequest(
  cookieHeader = '',
  fn: (session: SessionInstance) => void | Promise<void> = () => {},
): Promise<{ session: SessionInstance; setCookie: string | undefined }> {
  const mw = sessionMiddleware(config)
  const { req, res, setCookies } = makeReqRes(cookieHeader)
  let captured!: SessionInstance
  await mw(req, res, async () => {
    captured = (req.raw as Record<string, unknown>)['__bk_session'] as SessionInstance
    await fn(captured)
  })
  return { session: captured, setCookie: setCookies[0] }
}

/** Extract the raw cookie value from a Set-Cookie header string */
function extractCookieValue(setCookieHeader: string): string {
  const match = setCookieHeader.match(/^bk_sess=([^;]+)/)
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
  const { session: second } = await runRequest(`bk_sess=${cookieValue}`, secondFn)
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
    const { session: r1, setCookie: c1 } = await runRequest('', s => s.flash('msg', 'hello'))
    const cv1 = extractCookieValue(c1!)
    const { session: r2, setCookie: c2 } = await runRequest(`bk_sess=${cv1}`)
    assert.strictEqual(r2.getFlash('msg'), 'hello')
    const cv2 = extractCookieValue(c2!)
    const { session: r3 } = await runRequest(`bk_sess=${cv2}`)
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
  it('attaches session to req.raw.__bk_session', async () => {
    const mw = sessionMiddleware(config)
    const { req, res } = makeReqRes()
    await mw(req, res, async () => {
      assert.ok((req.raw as Record<string, unknown>)['__bk_session'] instanceof SessionInstance)
    })
  })

  it('writes Set-Cookie header after next() resolves', async () => {
    const { setCookie } = await runRequest()
    assert.ok(setCookie?.startsWith('bk_sess='))
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
    const { req, res } = makeReqRes('bk_sess=tampered.invalidsig')
    let sessionId!: string
    await mw(req, res, async () => {
      const s = (req.raw as Record<string, unknown>)['__bk_session'] as SessionInstance
      sessionId = s.id()
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
    assert.throws(() => Session.get('k'), /No session in context/)
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
    const { session: r1, setCookie } = await runRequest('', () => Session.flash('notice', 'ok'))
    assert.ok(setCookie)
    const cookieValue = extractCookieValue(setCookie)
    const { session: r2 } = await runRequest(`bk_sess=${cookieValue}`)
    assert.strictEqual(r2.getFlash('notice'), 'ok')
  })

  it('regenerate() changes session ID', async () => {
    await run(async () => {
      const s = (Session as unknown as { current(): SessionInstance }).current?.() ?? null
      // Test via instance
    })
    // Test through the middleware directly
    const { session: s } = await runRequest()
    const oldId = s.id()
    await s.regenerate()
    const newId = s.id()
    assert.notStrictEqual(oldId, newId)
  })
})

// ─── session() provider ───────────────────────────────────────────────────────

describe('session() provider', () => {
  const fakeApp = { instance: () => undefined } as never

  it('register() is a no-op', () => {
    const Provider = session(config)
    assert.doesNotThrow(() => new Provider(fakeApp).register?.())
  })

  it('boot() binds session.config to DI', () => {
    let bound: unknown
    const fakeAppSpy = {
      instance: (key: string, value: unknown) => { if (key === 'session.config') bound = value },
    } as never

    const Provider = session(config)
    new Provider(fakeAppSpy).boot?.()
    assert.strictEqual(bound, config)
  })
})
