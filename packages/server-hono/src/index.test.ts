import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { RouteDefinition, MiddlewareHandler } from '@rudderjs/contracts'
import { hono } from './index.js'
import { renderErrorPage, buildErrorMarkdown } from './error-page.js'

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
    // The visible page renders the message HTML-escaped.
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'),
      'visible page must HTML-escape the error message')
    // No raw injection: the attacker payload must NOT appear as a literal
    // <script>alert(...)</script> tag anywhere in the document (i.e. cannot
    // execute as injected HTML). The legitimate copy-button <script> block
    // is a fixed string and contains no user-controlled values.
    assert.ok(!html.includes('<script>alert'),
      'attacker-controlled <script>alert must not appear unescaped')
    // The embedded clipboard payload escapes `<` to < so the same XSS
    // payload can't break out of the JS string literal either.
    assert.ok(html.includes('\\u003cscript\\u003ealert'),
      'embedded markdown payload escapes < as \\u003c so attacker can\'t close the inline script tag')
  })

  it('HTML-escapes the request URL', () => {
    const xssReq = { method: 'GET', url: 'http://localhost/<evil>', headers: {} }
    const html = renderErrorPage(new Error('test'), xssReq)
    // Visible page: URL HTML-escaped.
    assert.ok(html.includes('http://localhost/&lt;evil&gt;'),
      'visible page must HTML-escape the request URL')
    // The raw `<evil>` substring must not appear anywhere — the embedded
    // markdown also unicode-escapes `<` so the URL can't break out of the
    // <script> string literal.
    assert.ok(!html.includes('<evil>'),
      '<evil> must not appear unescaped anywhere in the document')
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

  it('renders the Copy-as-Markdown button + embedded markdown script', () => {
    const html = renderErrorPage(new Error('copyable'), req)
    assert.ok(html.includes('id="rjs-copy-md"'), 'button must be present')
    assert.ok(html.includes('Copy as Markdown'), 'button label must be present')
    assert.ok(html.includes('navigator.clipboard.writeText'), 'click handler must wire to the clipboard API')
    // The markdown payload is embedded via JSON.stringify so the error name
    // ('Error') and message ('copyable') survive into the script literal.
    assert.ok(html.includes('# Error: copyable'), 'embedded markdown must include the heading')
  })
})

// ─── buildErrorMarkdown() ──────────────────────────────────

describe('buildErrorMarkdown()', () => {
  const req = { method: 'GET', url: 'http://localhost/demo', headers: { accept: 'text/html', host: 'localhost' } }
  const parts = {
    frames:    [],
    appFrames: [{ func: 'doStuff', file: '/app/src/foo.ts',          line: 42, col: 9, isVendor: false }],
    topFrame:  { func: 'doStuff', file: '/app/src/foo.ts',           line: 42, col: 9, isVendor: false },
    source:    [
      { n: 41, code: 'function doStuff() {', isError: false },
      { n: 42, code: '  throw new Error(\'boom\')', isError: true },
      { n: 43, code: '}', isError: false },
    ],
    nodeVersion:     'v22.14.0',
    rudderjsVersion: '1.2.3',
  }

  it('starts with `# {errorName}: {message}`', () => {
    const md = buildErrorMarkdown(new TypeError('bad type'), req, parts)
    assert.ok(md.startsWith('# TypeError: bad type'), 'first line should be the H1 header')
  })

  it('includes location, request, and versions metadata', () => {
    const md = buildErrorMarkdown(new Error('e'), req, parts)
    assert.ok(md.includes('**Location**:'), 'location label')
    assert.ok(md.includes(':42'),          'line number from topFrame')
    assert.ok(md.includes('**Request**: `GET http://localhost/demo`'), 'request line')
    assert.ok(md.includes('Node v22.14.0'),  'node version')
    assert.ok(md.includes('RudderJS 1.2.3'), 'rudderjs version')
  })

  it('renders source with `>` marker on the error line', () => {
    const md = buildErrorMarkdown(new Error('e'), req, parts)
    assert.ok(md.includes('## Source'),                  'source section header')
    assert.ok(md.includes('>   42 |   throw new Error'), 'error line marked with `>` and aligned line number')
    assert.ok(md.includes('   41 | function doStuff'),  'non-error line uses a space prefix')
  })

  it('renders an app-frames Stack section as fenced code', () => {
    const md = buildErrorMarkdown(new Error('e'), req, parts)
    assert.ok(md.includes('## Stack'), 'stack section header')
    assert.ok(md.includes('at doStuff (/app/src/foo.ts:42:9)'.replace('/app', '~/app').replace(process.env['HOME'] ?? '___none___', '~')) ||
              md.includes('at doStuff (/app/src/foo.ts:42:9)'),
              'stack frame line — exact path may be tilde-relative depending on HOME')
  })

  it('wraps vendor frames in <details> when present', () => {
    const withVendor = {
      ...parts,
      frames: [
        ...parts.appFrames,
        { func: 'compose', file: '/path/node_modules/hono/dist/compose.js', line: 22, col: 17, isVendor: true },
      ],
    }
    const md = buildErrorMarkdown(new Error('e'), req, withVendor)
    assert.ok(md.includes('<details><summary>1 vendor frames</summary>'), 'details opener with count')
    assert.ok(md.includes('at compose (')        , 'vendor frame is listed')
    assert.ok(md.includes('</details>'),           'details closer')
  })

  it('renders Request Headers as a bullet list', () => {
    const md = buildErrorMarkdown(new Error('e'), req, parts)
    assert.ok(md.includes('## Request Headers'), 'headers section header')
    assert.ok(md.includes('- `accept`: text/html'), 'accept header entry')
    assert.ok(md.includes('- `host`: localhost'),   'host header entry')
  })

  it('omits Source section when no top frame is available', () => {
    const noFrame = { ...parts, topFrame: undefined as never, source: null, appFrames: [] }
    const md = buildErrorMarkdown(new Error('no-stack'), req, noFrame)
    assert.ok(!md.includes('## Source'), 'no source section')
    assert.ok(!md.includes('## Stack'),  'no stack section')
  })
})

// ─── End-to-end dev-page wiring (regression guard, 2026-05-14) ─────
//
// Verifies the full pipeline: a route throws → the registered user-handler
// re-throws (matching `app-builder.ts` buildHandler's dev+HTML behavior) →
// `createFetchHandler`'s onError catches the rethrow and renders the
// Ignition-style page. The user-handler-rethrows path was effectively dead
// from 2026-04-06 (when the core error pipeline always returned a Response)
// until 2026-05-14 when buildHandler started bubbling for HTML+debug.

describe('createFetchHandler() — dev error page wiring', () => {
  async function fetchThrowingRoute(opts: {
    isProd: boolean
    accept: string
    userHandler?: (err: unknown) => Promise<Response>
  }): Promise<Response> {
    const prev = process.env['APP_ENV']
    process.env['APP_ENV'] = opts.isProd ? 'production' : 'development'
    try {
      const provider = hono()
      const handler = await provider.createFetchHandler((adapter) => {
        const route: RouteDefinition = {
          method:     'GET',
          path:       '/boom',
          handler:    async () => { throw new Error('integration boom') },
          middleware: [] as MiddlewareHandler[],
        }
        adapter.registerRoute(route)
        // Mimic the dev+HTML branch of `buildHandler()`: re-throw so the
        // adapter's onError catches it and renders the dev page.
        const userHandler = opts.userHandler ?? (async (err: unknown) => { throw err })
        adapter.setErrorHandler?.(userHandler)
      })
      return await handler(new Request('http://localhost/boom', {
        headers: { accept: opts.accept },
      }))
    } finally {
      if (prev === undefined) delete process.env['APP_ENV']
      else process.env['APP_ENV'] = prev
    }
  }

  it('renders the Ignition-style HTML page in dev when the user-handler rethrows', async () => {
    const res = await fetchThrowingRoute({ isProd: false, accept: 'text/html' })
    assert.strictEqual(res.status, 500)
    const html = await res.text()
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'must be a full HTML document')
    assert.ok(html.includes('integration boom'), 'must include the thrown error message')
    assert.ok(html.includes('Error'), 'must include the error name')
  })

  it('renders the simple JSON 500 in prod even when the user-handler rethrows', async () => {
    const res = await fetchThrowingRoute({ isProd: true, accept: 'text/html' })
    assert.strictEqual(res.status, 500)
    const body = await res.text()
    assert.ok(!body.includes('integration boom'), 'prod must not leak the error message')
    assert.ok(!body.startsWith('<!DOCTYPE html>'), 'prod returns JSON, not HTML')
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
