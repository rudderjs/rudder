import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hono } from './index.js'

type App = { fetch: (req: Request) => Promise<Response> }

// Regression coverage for two response-header bugs in the normalizeResponse
// merge mechanism:
//   1. Global m.use middleware that set a response header via the res.header()
//      wrapper and then call next() had their headers silently dropped —
//      applyMiddleware never merged the wrapper's pending headers into c.res.
//   2. A cookie set via res.header() on the res.json()/send() path was applied
//      twice (once by applyHeaders staging onto the Hono context, once by the
//      route handler's unconditional mergeInto), duplicating the Set-Cookie.
// Both are fixed by a single `flushed` guard plus applyMiddleware capturing and
// applying its own wrapper's pending merge.

describe('HonoAdapter — global middleware response headers', () => {
  it('a global middleware can set a header via res.header() and pass through', async () => {
    const adapter = hono().create()
    adapter.applyMiddleware(async (_req, res, next) => {
      res.header('X-Global', 'yes')
      return next()
    })
    adapter.registerRoute({
      method: 'GET', path: '/p', middleware: [],
      handler: async (_req, res) => res.json({ ok: true }),
    })
    const app = adapter.getNativeServer() as App
    const res = await app.fetch(new Request('http://localhost/p'))
    assert.strictEqual(res.headers.get('X-Global'), 'yes')
  })

  it('a global middleware can set a cookie via res.header() and pass through', async () => {
    const adapter = hono().create()
    adapter.applyMiddleware(async (_req, res, next) => {
      res.header('Set-Cookie', 'g=1; Path=/')
      return next()
    })
    adapter.registerRoute({
      method: 'GET', path: '/p', middleware: [],
      handler: async (_req, res) => res.json({ ok: true }),
    })
    const app = adapter.getNativeServer() as App
    const res = await app.fetch(new Request('http://localhost/p'))
    assert.deepStrictEqual(res.headers.getSetCookie(), ['g=1; Path=/'])
  })

  it('two global middleware each set a distinct cookie via res.header() (no clobber)', async () => {
    const adapter = hono().create()
    adapter.applyMiddleware(async (_req, res, next) => { res.header('Set-Cookie', 'csrf=abc; Path=/'); return next() })
    adapter.applyMiddleware(async (_req, res, next) => { res.header('Set-Cookie', 'session=xyz; Path=/'); return next() })
    adapter.registerRoute({
      method: 'GET', path: '/p', middleware: [],
      handler: async (_req, res) => res.json({ ok: true }),
    })
    const app = adapter.getNativeServer() as App
    const res = await app.fetch(new Request('http://localhost/p'))
    const cookies = res.headers.getSetCookie()
    assert.ok(cookies.includes('csrf=abc; Path=/'), `missing csrf: ${JSON.stringify(cookies)}`)
    assert.ok(cookies.includes('session=xyz; Path=/'), `missing session: ${JSON.stringify(cookies)}`)
  })

  it('does not duplicate a cookie set via res.header() on the res.json() path', async () => {
    const adapter = hono().create()
    adapter.registerRoute({
      method: 'GET', path: '/d', middleware: [],
      handler: async (_req, res) => { res.header('Set-Cookie', 'a=1; Path=/'); return res.json({ ok: true }) },
    })
    const app = adapter.getNativeServer() as App
    const res = await app.fetch(new Request('http://localhost/d'))
    assert.deepStrictEqual(res.headers.getSetCookie(), ['a=1; Path=/'])
  })

  it('does not duplicate a cookie set by route-level middleware on the res.json() path', async () => {
    const adapter = hono().create()
    adapter.registerRoute({
      method: 'GET', path: '/r',
      middleware: [async (_req, res, next) => { res.header('Set-Cookie', 'm=1; Path=/'); return next() }],
      handler: async (_req, res) => res.json({ ok: true }),
    })
    const app = adapter.getNativeServer() as App
    const res = await app.fetch(new Request('http://localhost/r'))
    assert.deepStrictEqual(res.headers.getSetCookie(), ['m=1; Path=/'])
  })
})
