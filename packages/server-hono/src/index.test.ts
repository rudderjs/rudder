import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RouteDefinition, MiddlewareHandler } from '@rudderjs/contracts'
import { hono } from './index.js'
import { renderErrorPage } from './error-page.js'

// ─── hono() factory ─────────────────────────────────────────

describe('hono() factory', () => {
  it('returns an object with type "hono"', () => {
    const provider = hono()
    assert.strictEqual(provider.type, 'hono')
  })

  it('returns an object with create, createApp, createFetchHandler functions', () => {
    const provider = hono()
    assert.strictEqual(typeof provider.create, 'function')
    assert.strictEqual(typeof provider.createApp, 'function')
    assert.strictEqual(typeof provider.createFetchHandler, 'function')
  })

  it('create() returns a ServerAdapter with the required interface', () => {
    const adapter = hono().create()
    assert.strictEqual(typeof adapter.registerRoute, 'function')
    assert.strictEqual(typeof adapter.applyMiddleware, 'function')
    assert.strictEqual(typeof adapter.listen, 'function')
    assert.strictEqual(typeof adapter.getNativeServer, 'function')
  })

  it('getNativeServer() returns a Hono app (has fetch)', () => {
    const adapter = hono().create()
    const native = adapter.getNativeServer() as { fetch: unknown }
    assert.strictEqual(typeof native.fetch, 'function')
  })

  it('createApp() returns a Hono app (has fetch)', () => {
    const app = hono().createApp() as { fetch: unknown }
    assert.strictEqual(typeof app.fetch, 'function')
  })

  it('accepts HonoConfig options without throwing', () => {
    assert.doesNotThrow(() => hono({
      port:       4000,
      trustProxy: true,
      cors: {
        origin:  'https://example.com',
        methods: 'GET,POST',
        headers: 'Content-Type,Authorization',
      },
    }))
  })
})

// ─── HonoAdapter methods ─────────────────────────────────────

describe('HonoAdapter', () => {
  it('registerRoute() does not throw for GET route', () => {
    const adapter = hono().create()
    const route: RouteDefinition = {
      method:     'GET',
      path:       '/test',
      handler:    async (_req, res) => res.json({ ok: true }),
      middleware: [],
    }
    assert.doesNotThrow(() => adapter.registerRoute(route))
  })

  it('registerRoute() does not throw for ALL route', () => {
    const adapter = hono().create()
    const route: RouteDefinition = {
      method:     'ALL',
      path:       '/api/*',
      handler:    async (_req, res) => res.json({}),
      middleware: [],
    }
    assert.doesNotThrow(() => adapter.registerRoute(route))
  })

  it('registerRoute() does not throw for route with middleware', () => {
    const adapter = hono().create()
    const mw: MiddlewareHandler = async (_req, _res, next) => { await next() }
    const route: RouteDefinition = {
      method:     'POST',
      path:       '/users',
      handler:    async (_req, res) => res.json({}),
      middleware: [mw],
    }
    assert.doesNotThrow(() => adapter.registerRoute(route))
  })

  it('applyMiddleware() does not throw', () => {
    const adapter = hono().create()
    const mw: MiddlewareHandler = async (_req, _res, next) => { await next() }
    assert.doesNotThrow(() => adapter.applyMiddleware(mw))
  })

  it('multiple adapters are independent instances', () => {
    const a = hono().create()
    const b = hono().create()
    assert.notStrictEqual(a.getNativeServer(), b.getNativeServer())
  })
})

// ─── Subdomain (host) routing ──────────────────────────────
//
// Host header note: Node's synthetic `new Request(url)` does NOT auto-populate
// the Host header (browsers and `@hono/node-server` do, but undici fetch leaves
// it blank). Tests pass `Host` explicitly via the request init.

describe('HonoAdapter — host gate', () => {
  function setupHost(host: string) {
    const adapter = hono().create()
    let captured: { params: Record<string, string> } | null = null
    adapter.registerRoute({
      method:  'GET',
      path:    '/users',
      host,
      handler: async (req, res) => {
        captured = { params: req.params }
        return res.json({ ok: true })
      },
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    return { app, getCaptured: () => captured }
  }

  function withHost(url: string, host: string): Request {
    return new Request(url, { headers: { host } })
  }

  it('matches an exact host header → handler runs', async () => {
    const { app, getCaptured } = setupHost('api.example.com')
    const res = await app.fetch(withHost('http://api.example.com/users', 'api.example.com'))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), { params: {} })
  })

  it('returns 404 when host does not match', async () => {
    const { app } = setupHost('api.example.com')
    const res = await app.fetch(withHost('http://web.example.com/users', 'web.example.com'))
    assert.strictEqual(res.status, 404)
  })

  it('captures :param segments into req.params', async () => {
    const { app, getCaptured } = setupHost(':tenant.example.com')
    const res = await app.fetch(withHost('http://acme.example.com/users', 'acme.example.com'))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), { params: { tenant: 'acme' } })
  })

  it('strips the :port from the Host header before matching', async () => {
    const { app } = setupHost('api.example.com')
    const res = await app.fetch(withHost('http://api.example.com:3000/users', 'api.example.com:3000'))
    assert.strictEqual(res.status, 200)
  })

  it('is case-insensitive', async () => {
    const { app } = setupHost('api.example.com')
    const res = await app.fetch(withHost('http://API.Example.COM/users', 'API.Example.COM'))
    assert.strictEqual(res.status, 200)
  })

  it('routes without a host gate run on any host (regression check)', async () => {
    const adapter = hono().create()
    adapter.registerRoute({
      method:     'GET',
      path:       '/health',
      handler:    async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const a = await app.fetch(withHost('http://api.example.com/health', 'api.example.com'))
    const b = await app.fetch(withHost('http://web.example.com/health', 'web.example.com'))
    assert.strictEqual(a.status, 200)
    assert.strictEqual(b.status, 200)
  })

  it('subdomain :param does not collide with a same-name path :param', async () => {
    const adapter = hono().create()
    let captured: Record<string, string> = {}
    adapter.registerRoute({
      method:  'GET',
      path:    '/users/:tenant',  // path uses same name → path wins
      host:    ':tenant.example.com',
      handler: async (req, res) => { captured = req.params; return res.json({ ok: true }) },
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const res = await app.fetch(withHost('http://acme.example.com/users/bob', 'acme.example.com'))
    assert.strictEqual(res.status, 200)
    // Path :tenant ('bob') wins over subdomain :tenant ('acme') on collision
    assert.strictEqual(captured['tenant'], 'bob')
  })
})

// ─── renderErrorPage() ──────────────────────────────────────

describe('renderErrorPage()', () => {
  const req = { method: 'GET', url: 'http://localhost/test', headers: { 'content-type': 'application/json' } }

  it('returns a string', () => {
    const html = renderErrorPage(new Error('boom'), req)
    assert.strictEqual(typeof html, 'string')
  })

  it('returns valid HTML (starts with <!DOCTYPE html>)', () => {
    const html = renderErrorPage(new Error('boom'), req)
    assert.ok(html.startsWith('<!DOCTYPE html>'))
  })

  it('includes the error name', () => {
    const err = new TypeError('bad type')
    const html = renderErrorPage(err, req)
    assert.ok(html.includes('TypeError'))
  })

  it('includes the error message', () => {
    const err = new Error('something went wrong')
    const html = renderErrorPage(err, req)
    assert.ok(html.includes('something went wrong'))
  })

  it('HTML-escapes special characters in error message', () => {
    const err = new Error('<script>alert("xss")</script>')
    const html = renderErrorPage(err, req)
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  it('HTML-escapes the request URL', () => {
    const xssReq = { method: 'GET', url: 'http://localhost/<evil>', headers: {} }
    const html = renderErrorPage(new Error('test'), xssReq)
    assert.ok(!html.includes('<evil>'))
    assert.ok(html.includes('&lt;evil&gt;'))
  })

  it('includes request headers in the output', () => {
    const html = renderErrorPage(new Error('err'), req)
    assert.ok(html.includes('content-type'))
    assert.ok(html.includes('application/json'))
  })

  it('includes the HTTP method', () => {
    const postReq = { method: 'POST', url: 'http://localhost/api', headers: {} }
    const html = renderErrorPage(new Error('err'), postReq)
    assert.ok(html.includes('POST'))
  })

  it('handles an error with no stack gracefully', () => {
    const err = new Error('no stack')
    delete err.stack
    assert.doesNotThrow(() => renderErrorPage(err, req))
  })

  it('includes the status 500 badge', () => {
    const html = renderErrorPage(new Error('oops'), req)
    assert.ok(html.includes('500'))
  })
})
