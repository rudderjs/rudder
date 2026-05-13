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

// ─── Body parsing ───────────────────────────────────────────

describe('HonoAdapter — body parsing', () => {
  function setupCapture() {
    const adapter = hono().create()
    let captured: unknown = undefined
    adapter.registerRoute({
      method:  'POST',
      path:    '/echo',
      handler: async (req, res) => { captured = req.body; return res.json({ ok: true }) },
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    return { app, getCaptured: () => captured }
  }

  it('parses application/json bodies', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ grant_type: 'client_credentials', client_id: 'abc' }),
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), { grant_type: 'client_credentials', client_id: 'abc' })
  })

  it('parses application/x-www-form-urlencoded bodies (RFC 6749 §3.2 OAuth token endpoint)', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'grant_type=client_credentials&client_id=abc&client_secret=shh',
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), {
      grant_type:    'client_credentials',
      client_id:     'abc',
      client_secret: 'shh',
    })
  })

  it('parses form-urlencoded with charset suffix on content-type', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body:    'a=1&b=2',
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), { a: '1', b: '2' })
  })

  it('decodes percent-encoded values in form-urlencoded bodies', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'redirect_uri=https%3A%2F%2Fexample.com%2Fcb&scope=read%20write',
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), {
      redirect_uri: 'https://example.com/cb',
      scope:        'read write',
    })
  })

  it('leaves multipart/form-data untouched (handlers parse via c.req.parseBody())', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----foo' },
      body:    '------foo\r\nContent-Disposition: form-data; name="x"\r\n\r\n1\r\n------foo--\r\n',
    }))
    assert.strictEqual(res.status, 200)
    // Adapter does not touch req.body for multipart; it stays at the normalizer default (null).
    assert.strictEqual(getCaptured(), null)
  })

  it('falls back to {} on malformed JSON', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{not json',
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(getCaptured(), {})
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

// ─── normalizeRequest getter persistence ────────────────────
//
// The framework relies on the contract that `req.body`/`session`/`user`/`token`
// are getters reading from the Hono context, so values set during middleware
// (which has its own `req` instance) are visible to the route handler (which
// has another `req` instance, but the same underlying `c`). If this contract
// breaks, AuthMiddleware will appear to "set" `req.user` and the route handler
// will see `undefined`.

describe('HonoAdapter — req getter persistence across middleware/route', () => {
  it('value stashed on req.raw is visible via req.user getter in the route handler', async () => {
    const adapter = hono().create()
    let observedUser: unknown = undefined

    adapter.applyMiddleware(async (req, _res, next) => {
      // Pattern used by AuthMiddleware — write directly to the context stash.
      ;(req.raw as Record<string, unknown>)['__rjs_user'] = { id: 'u-1', name: 'Ada' }
      await next()
    })
    adapter.registerRoute({
      method:  'GET',
      path:    '/whoami',
      handler: async (req, res) => {
        // `req.user` is added by @rudderjs/auth via module augmentation; in
        // this isolated package test we just read the property via index access.
        observedUser = (req as unknown as Record<string, unknown>)['user']
        return res.json({ ok: true })
      },
      middleware: [],
    })

    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const res = await app.fetch(new Request('http://localhost/whoami'))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(observedUser, { id: 'u-1', name: 'Ada' })
  })

})

// ─── multi-value Set-Cookie ─────────────────────────────────
//
// Cooperative cookie writers (CsrfMiddleware + SessionMiddleware is the
// canonical pair) append directly to `c.res.headers` after the handler has
// finalized the Response. The pattern relies on `headers.append('Set-Cookie',
// value)` keeping multi-value Set-Cookie distinct — `new Response(body, {
// headers })` collapses them under Node's undici-backed fetch.

describe('HonoAdapter — multi-value Set-Cookie', () => {
  it('middleware appending to c.res.headers preserves multiple Set-Cookie headers', async () => {
    const adapter = hono().create()

    // Two middleware each append a Set-Cookie after the handler returns —
    // mirrors how @rudderjs/session writes cookies post-next().
    adapter.applyMiddleware(async (req, _res, next) => {
      await next()
      const c = req.raw as { res: Response | undefined }
      if (c.res) c.res.headers.append('Set-Cookie', 'csrf=abc; Path=/; HttpOnly')
    })
    adapter.applyMiddleware(async (req, _res, next) => {
      await next()
      const c = req.raw as { res: Response | undefined }
      if (c.res) c.res.headers.append('Set-Cookie', 'session=xyz; Path=/; HttpOnly')
    })
    adapter.registerRoute({
      method:  'GET',
      path:    '/cookies',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })

    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const res = await app.fetch(new Request('http://localhost/cookies'))

    // Headers.getSetCookie() returns each Set-Cookie as a separate string. If
    // the implementation collapsed them into one comma-joined header, this
    // would return a single entry — that's the bug the dedicated cookies
    // array in normalizeResponse exists to prevent.
    const setCookies = res.headers.getSetCookie()
    assert.ok(setCookies.length >= 2,
      `expected >= 2 separate Set-Cookie headers, got ${setCookies.length}: ${JSON.stringify(setCookies)}`)
    assert.ok(setCookies.some(c => c.startsWith('csrf=abc')), 'expected csrf cookie')
    assert.ok(setCookies.some(c => c.startsWith('session=xyz')), 'expected session cookie')
  })
})
