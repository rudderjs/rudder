/**
 * Session integration tests — cookie driver (HMAC-SHA256)
 *
 * Tests the full middleware lifecycle: sessionMiddleware() creates a
 * SessionInstance, signs/verifies the cookie, and persists state across
 * simulated requests.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sessionMiddleware, Session, type SessionInstance, type SessionConfig } from '@rudderjs/session'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// ─── Helpers ───────────────────────────────────────────────

const config: SessionConfig = {
  driver:   'cookie',
  lifetime: 120,
  secret:   'integration-test-secret-32-chars!!',
  cookie: { name: 'bk_session', httpOnly: true, sameSite: 'lax', secure: false, path: '/' },
}

function makeReqRes(cookieHeader = '') {
  const setCookies: string[] = []
  const req = {
    headers: { cookie: cookieHeader },
    raw:     {},
  } as unknown as AppRequest

  const res = {
    raw: {
      header: (_k: string, v: string) => { setCookies.push(v) },
    },
  } as unknown as AppResponse

  return { req, res, setCookies }
}

async function runRequest(
  cookieHeader = '',
  fn: (session: SessionInstance) => Promise<void> = async () => {},
) {
  const mw = sessionMiddleware(config)
  const { req, res, setCookies } = makeReqRes(cookieHeader)
  let capturedSession!: SessionInstance

  await mw(req, res, async () => {
    capturedSession = (req.raw as Record<string, unknown>)['__bk_session'] as SessionInstance
    await fn(capturedSession)
  })

  return { session: capturedSession, setCookie: setCookies[0] ?? null }
}

function extractCookieValue(setCookieHeader: string | null): string {
  if (!setCookieHeader) return ''
  const match = setCookieHeader.match(/bk_session=([^;]+)/)
  return match?.[1] ?? ''
}

// ─── Tests ─────────────────────────────────────────────────

describe('session — cookie driver integration', () => {
  describe('basic get/put', () => {
    it('put() stores a value retrievable in the same request', async () => {
      await runRequest('', async (s) => {
        s.put('name', 'Alice')
        assert.equal(s.get('name'), 'Alice')
      })
    })

    it('get() returns undefined for missing key', async () => {
      await runRequest('', async (s) => {
        assert.strictEqual(s.get('missing'), undefined)
      })
    })

    it('has() reflects put/forget', async () => {
      await runRequest('', async (s) => {
        assert.equal(s.has('key'), false)
        s.put('key', 1)
        assert.equal(s.has('key'), true)
        s.forget('key')
        assert.equal(s.has('key'), false)
      })
    })

    it('all() returns all stored values', async () => {
      await runRequest('', async (s) => {
        s.put('a', 1)
        s.put('b', 2)
        const all = s.all()
        assert.equal(all['a'], 1)
        assert.equal(all['b'], 2)
      })
    })

    it('flush() clears all values', async () => {
      await runRequest('', async (s) => {
        s.put('x', 1)
        s.put('y', 2)
        s.flush()
        assert.deepEqual(s.all(), {})
      })
    })
  })

  describe('cookie persistence across requests', () => {
    it('values written in request 1 are readable in request 2', async () => {
      const { setCookie } = await runRequest('', async (s) => {
        s.put('userId', 'user-123')
      })

      const cookieHeader = `bk_session=${extractCookieValue(setCookie)}`

      await runRequest(cookieHeader, async (s) => {
        assert.equal(s.get('userId'), 'user-123')
      })
    })

    it('tampered cookie is rejected and starts fresh session', async () => {
      const { setCookie } = await runRequest('', async (s) => {
        s.put('secret', 'data')
      })

      const cookieVal = extractCookieValue(setCookie)
      const tampered  = cookieVal.slice(0, -1) + (cookieVal.slice(-1) === 'a' ? 'b' : 'a')

      await runRequest(`bk_session=${tampered}`, async (s) => {
        assert.strictEqual(s.get('secret'), undefined)
      })
    })

    it('Set-Cookie header is written after each request', async () => {
      const { setCookie } = await runRequest('', async (s) => {
        s.put('k', 'v')
      })
      assert.ok(setCookie !== null, 'Set-Cookie header should be set')
      assert.ok(setCookie!.includes('bk_session='), 'should contain session cookie name')
    })
  })

  describe('flash()', () => {
    it('flash value is available in next request then gone', async () => {
      const { setCookie: c1 } = await runRequest('', async (s) => {
        s.flash('notice', 'Saved!')
      })

      const { setCookie: c2 } = await runRequest(`bk_session=${extractCookieValue(c1)}`, async (s) => {
        assert.equal(s.getFlash('notice'), 'Saved!')
      })

      await runRequest(`bk_session=${extractCookieValue(c2)}`, async (s) => {
        assert.strictEqual(s.getFlash('notice'), undefined)
      })
    })
  })

  describe('regenerate()', () => {
    it('changes session id but preserves data', async () => {
      await runRequest('', async (s) => {
        s.put('role', 'admin')
        const oldId = s.id()
        await s.regenerate()
        assert.notEqual(s.id(), oldId)
        assert.equal(s.get('role'), 'admin')
      })
    })
  })

  describe('Session facade (ALS)', () => {
    it('Session.get() works inside middleware next()', async () => {
      await runRequest('', async (s) => {
        s.put('als-key', 'als-value')
        assert.equal(Session.get('als-key'), 'als-value')
      })
    })

    it('Session.put() and get() round-trip via facade', async () => {
      await runRequest('', async () => {
        Session.put('facade-key', 42)
        assert.equal(Session.get('facade-key'), 42)
      })
    })
  })
})
