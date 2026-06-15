import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { RouteDefinition, MiddlewareHandler } from '@rudderjs/contracts'
import { MalformedBodyError, PayloadTooLargeError } from '@rudderjs/contracts'
import { hono, compileControllerViewRegex, devErrorPageEnabled } from './index.js'
import { renderErrorPage, buildErrorMarkdown, resolveErrorLine, applyDevStackFix, resolveRudderVersion } from './error-page.js'

/** Walk up from the test cwd to the pnpm workspace root. */
function repoRoot(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('workspace root (pnpm-workspace.yaml) not found')
}

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

  it('throws MalformedBodyError on malformed JSON (httpStatus=400 so the core pipeline renders 400)', async () => {
    const adapter = hono().create()
    let handlerRan = false
    adapter.registerRoute({
      method:  'POST',
      path:    '/echo',
      handler: async (_req, res) => { handlerRan = true; return res.json({ ok: true }) },
      middleware: [],
    })
    const app = adapter.getNativeServer() as {
      fetch:   (req: Request) => Promise<Response>
      onError: (fn: (err: unknown) => Response) => void
    }
    let errCaught: unknown = undefined
    app.onError((err) => {
      errCaught = err
      // Mimic the central pipeline's response shape so the assertion
      // covers both "the throw reached onError" and "the renderer would
      // produce a 400 — the response we serve here is just for the test".
      return new Response('intercepted', { status: 500 })
    })
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{not json',
    }))
    assert.strictEqual(res.status, 500, 'Hono default for uncaught — would be 400 via the framework pipeline')
    assert.strictEqual(handlerRan, false, 'route handler must not run when body parse throws')
    assert.ok(errCaught instanceof MalformedBodyError,
      `expected MalformedBodyError, got ${(errCaught as Error)?.constructor?.name}`)
    assert.strictEqual((errCaught as MalformedBodyError).httpStatus, 400)
    assert.strictEqual((errCaught as MalformedBodyError).contentType, 'application/json')
    assert.match((errCaught as Error).message, /Malformed request body.*application\/json/i)
    // The original parse error survives as `cause` for diagnostics.
    assert.ok((errCaught as Error & { cause?: unknown }).cause instanceof SyntaxError,
      'cause should be the underlying JSON SyntaxError')
  })

  it('rejects an oversized JSON body with PayloadTooLargeError (413)', async () => {
    const adapter = hono({ bodyLimit: 1024 }).create()  // 1 KB cap
    let handlerRan = false
    adapter.registerRoute({
      method:  'POST',
      path:    '/echo',
      handler: async (_req, res) => { handlerRan = true; return res.json({ ok: true }) },
      middleware: [],
    })
    const app = adapter.getNativeServer() as {
      fetch:   (req: Request) => Promise<Response>
      onError: (fn: (err: unknown) => Response) => void
    }
    let errCaught: unknown
    app.onError((err) => { errCaught = err; return new Response('intercepted', { status: 500 }) })
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ data: 'a'.repeat(5000) }), // > 1 KB
    }))
    assert.strictEqual(res.status, 500, 'Hono default for uncaught — 413 via the framework pipeline')
    assert.strictEqual(handlerRan, false, 'handler must not run when the body exceeds the limit')
    assert.ok(errCaught instanceof PayloadTooLargeError,
      `expected PayloadTooLargeError, got ${(errCaught as Error)?.constructor?.name}`)
    assert.strictEqual((errCaught as PayloadTooLargeError).httpStatus, 413)
    assert.strictEqual((errCaught as PayloadTooLargeError).limit, 1024)
  })

  it('rejects an oversized form-urlencoded body with PayloadTooLargeError (413)', async () => {
    const adapter = hono({ bodyLimit: 1024 }).create()
    adapter.registerRoute({
      method:  'POST',
      path:    '/echo',
      handler: async (req, res) => res.json({ body: req.body }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as {
      fetch:   (req: Request) => Promise<Response>
      onError: (fn: (err: unknown) => Response) => void
    }
    let errCaught: unknown
    app.onError((err) => { errCaught = err; return new Response('intercepted', { status: 500 }) })
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'data=' + 'a'.repeat(5000),
    }))
    assert.strictEqual(res.status, 500)
    assert.ok(errCaught instanceof PayloadTooLargeError,
      `expected PayloadTooLargeError, got ${(errCaught as Error)?.constructor?.name}`)
    assert.strictEqual((errCaught as PayloadTooLargeError).httpStatus, 413)
  })

  it('leaves req.body at the default when JSON body is empty (no parse, no throw)', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '',
    }))
    assert.strictEqual(res.status, 200)
    // Empty body: no parse attempted, no throw — req.body stays at the
    // normalizer default (null). Validators see "no body" and emit the
    // normal missing-field errors instead of cryptic JSON parse messages.
    assert.strictEqual(getCaptured(), null)
  })

  it('throws MalformedBodyError on malformed JSON with charset suffix on content-type', async () => {
    const adapter = hono().create()
    adapter.registerRoute({
      method:  'POST',
      path:    '/echo',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as {
      fetch:   (req: Request) => Promise<Response>
      onError: (fn: (err: unknown) => Response) => void
    }
    let errCaught: unknown = undefined
    app.onError((err) => { errCaught = err; return new Response('x', { status: 500 }) })
    await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body:    '{"name": "tru',  // truncated
    }))
    assert.ok(errCaught instanceof MalformedBodyError,
      'content-type matching is substring-based — charset suffix must not bypass parsing')
  })

  it('leaves req.body at the default when form-urlencoded body is empty', async () => {
    const { app, getCaptured } = setupCapture()
    const res = await app.fetch(new Request('http://localhost/echo', {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    '',
    }))
    assert.strictEqual(res.status, 200)
    // Mirrors the JSON-empty path — no parse attempted, no req.body
    // assignment, so the normalizer default (null) survives.
    assert.strictEqual(getCaptured(), null)
  })

  it('preserves raw body stream after pre-parse — handlers that need raw access (e.g. MCP streamable-HTTP transport) can still read c.req.raw.body', async () => {
    const adapter = hono().create()
    let parsedBody: unknown = undefined
    let rawText:    string  = ''
    adapter.registerRoute({
      method:  'POST',
      path:    '/raw',
      handler: async (req, res) => {
        const c = req.raw as { req: { raw: Request } }
        parsedBody = req.body
        // The streaming-aware handler reaches for the raw stream — must still
        // be available after server-hono's pre-parse populated req.body.
        rawText = await c.req.raw.text()
        return res.json({ ok: true })
      },
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const payload = '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
    const res = await app.fetch(new Request('http://localhost/raw', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    payload,
    }))
    assert.strictEqual(res.status, 200)
    assert.deepStrictEqual(parsedBody, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    assert.strictEqual(rawText, payload)
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

  it('never renders the legacy version placeholder badge', () => {
    const html = renderErrorPage(new Error('boom'), req)
    // The badge now shows a resolved @rudderjs/core version or is omitted — the
    // hard-coded sentinel must never reach the page. Match the rendered badge
    // fragment (with `">`), not the bare text: the source-context section
    // HTML-escapes the test file's own source (where this assertion lives), so
    // a bare `RUDDERJS 1.x` would false-positive while the escaped `&quot;&gt;`
    // form never does.
    assert.ok(!html.includes('badge-gray">RUDDERJS 1.x'), 'the 1.x placeholder badge must be gone')
  })

  describe('Open-in-editor action', () => {
    // The distinctive rendered-button anchor. Keying off this (not the bare
    // `open-editor-btn` class) avoids false positives from the CSS `<style>`
    // block and from the test file's own source echoed in the source-context
    // section (which is HTML-escaped, so the raw `<a ...` never matches).
    const BTN = '<a class="action-btn open-editor-btn" href="'
    const prev = process.env['APP_EDITOR']
    afterEach(() => {
      if (prev === undefined) delete process.env['APP_EDITOR']
      else process.env['APP_EDITOR'] = prev
    })

    it('renders a prominent "Open in editor" action opening the top frame in the resolved editor', () => {
      process.env['APP_EDITOR'] = 'vscode'
      const html = renderErrorPage(new Error('boom'), req)
      assert.ok(html.includes(BTN), 'primary action button must be present')
      assert.ok(html.includes('<span>Open in editor</span>'), 'button label must be present')
      // The button targets the top app frame via the resolved editor's scheme.
      assert.match(html, /class="action-btn open-editor-btn" href="vscode:\/\/file[^"]+:\d+"/)
    })

    it('honors APP_EDITOR for the action scheme (cursor)', () => {
      process.env['APP_EDITOR'] = 'cursor'
      const html = renderErrorPage(new Error('boom'), req)
      assert.match(html, /class="action-btn open-editor-btn" href="cursor:\/\/file[^"]+:\d+"/)
    })

    it('is hidden when APP_EDITOR=none (no editor URL available)', () => {
      process.env['APP_EDITOR'] = 'none'
      const html = renderErrorPage(new Error('boom'), req)
      assert.ok(!html.includes(BTN), 'button must be omitted when APP_EDITOR=none')
      // The Copy-as-Markdown button is unaffected by the opt-out.
      assert.ok(html.includes('Copy as Markdown'), 'copy button must still render')
    })

    it('is hidden when the error has no stack (no top frame to open)', () => {
      process.env['APP_EDITOR'] = 'vscode'
      const err = new Error('no stack')
      delete err.stack
      const html = renderErrorPage(err, req)
      assert.ok(!html.includes(BTN), 'no editor button without a top frame')
    })
  })
})

// ─── resolveRudderVersion() ────────────────────────────────

describe('resolveRudderVersion()', () => {
  it('resolves the app-installed @rudderjs/core version (not the adapter, not a placeholder)', () => {
    // The playground app declares @rudderjs/core, so resolving from its dir
    // yields core's real version — proving we read core, not server-hono's own
    // package.json (the previous, mislabeled behavior).
    const appDir   = path.join(repoRoot(), 'playground')
    const expected = (createRequire(path.join(appDir, 'package.json'))('@rudderjs/core/package.json') as { version: string }).version
    const got      = resolveRudderVersion(appDir)
    assert.equal(got, expected)
    assert.match(got!, /^\d+\.\d+\.\d+/)
    assert.notEqual(got, '1.x')
  })

  it('returns null when no @rudderjs package resolves (graceful fallback, never "1.x")', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rjs-ver-'))
    try {
      assert.equal(resolveRudderVersion(tmp), null)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
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
    assert.ok(md.includes('Rudder 1.2.3'), 'rudder version')
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

// ─── resolveErrorLine() — Vite SSR offset compensation ────────────

describe('resolveErrorLine()', () => {
  it('trusts the reported line when it has real code', () => {
    const lines = ['const x = 1', 'throw new Error("boom")', 'const z = 3']
    assert.strictEqual(resolveErrorLine(lines, 2), 2, 'throw on reported line is preserved')
  })

  it('trusts a non-throw, non-comment statement (call-site frames are still useful)', () => {
    const lines = ['function caller() {', '  riskyCall()', '}']
    assert.strictEqual(resolveErrorLine(lines, 2), 2)
  })

  it('scans forward to the next throw when reported line is blank', () => {
    const lines = ['function f() {', '', '', '', 'throw new Error("x")', '}']
    // Reported = 2 (blank). Throw is at line 5.
    assert.strictEqual(resolveErrorLine(lines, 2), 5)
  })

  it('skips comment lines and finds the next throw', () => {
    const lines = [
      'function f() {',
      '// a comment',
      '// another comment',
      '/* block start',
      ' * still inside */',
      'throw new Error("x")',
    ]
    // Reported = 2 (comment). Should skip past 3-5 and find throw at line 6.
    assert.strictEqual(resolveErrorLine(lines, 2), 6)
  })

  it('finds a throw 90+ lines forward — covers Vite SSR module-runner offset', () => {
    const lines: string[] = []
    lines.push('// line 1')
    for (let i = 2; i <= 119; i++) lines.push('')        // 118 blank lines
    lines.push('throw new Error("vite-ssr-offset")')     // line 120
    // Reported = 1 (a comment in the existing logic). The fix scans 150 forward.
    assert.strictEqual(resolveErrorLine(lines, 1), 120)
  })

  it('matches abort() calls in addition to throw statements', () => {
    const lines = ['function notFound() {', '', '  abort(404, "Missing")', '}']
    assert.strictEqual(resolveErrorLine(lines, 2), 3)
  })

  it('matches `throw new ...` mid-line via the boundary regex', () => {
    const lines = ['function f() {', '', 'if (broken) { throw new Error("x") }']
    assert.strictEqual(resolveErrorLine(lines, 2), 3)
  })

  it('returns null when no throw / abort is found within the 150-line window', () => {
    const lines = ['', 'const a = 1', 'const b = 2', '// just data, no error trigger']
    // Reported = 1 (blank). No throw/abort anywhere → null so the renderer
    // can drop the source section rather than mislead with an unrelated line.
    assert.strictEqual(resolveErrorLine(lines, 1), null)
  })
})

// ─── applyDevStackFix() — primary line-accuracy mechanism (sourcemap remap) ──
//
// In dev, @rudderjs/vite registers a `globalThis.__rudderjs_fix_stacktrace__`
// hook (Vite's `ssrFixStacktrace`) that rewrites an eval'd SSR module-runner
// stack to true source positions. applyDevStackFix invokes it so the Ignition
// page (and the app's error handler) read accurate line numbers instead of
// transformed-coordinate ones (the wrong-line bug where a route's throw at
// source line 235 surfaced as ~140 / an unrelated route).
describe('applyDevStackFix()', () => {
  const KEY = '__rudderjs_fix_stacktrace__'
  const g = globalThis as Record<string, unknown>

  it('invokes the globalThis hook with the same error instance and applies its in-place mutation', () => {
    const seen: Error[] = []
    g[KEY] = (e: Error) => { seen.push(e); e.stack = 'remapped:' + (e.stack ?? '') }
    try {
      const err = new Error('boom'); err.stack = 'raw'
      applyDevStackFix(err)
      assert.strictEqual(seen.length, 1, 'hook called exactly once')
      assert.strictEqual(seen[0], err, 'hook received the same error instance')
      assert.strictEqual(err.stack, 'remapped:raw', 'in-place stack rewrite is preserved')
    } finally { delete g[KEY] }
  })

  it('is a no-op when no hook is registered (production / non-dev)', () => {
    delete g[KEY]
    const err = new Error('boom'); err.stack = 'raw'
    assert.doesNotThrow(() => applyDevStackFix(err))
    assert.strictEqual(err.stack, 'raw', 'stack untouched without a hook')
  })

  it('swallows a throwing hook and keeps the original stack', () => {
    g[KEY] = () => { throw new Error('hook blew up') }
    try {
      const err = new Error('boom'); err.stack = 'raw'
      assert.doesNotThrow(() => applyDevStackFix(err))
      assert.strictEqual(err.stack, 'raw', 'original stack preserved when the hook throws')
    } finally { delete g[KEY] }
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

// ─── compileControllerViewRegex() — Hono-style path → regex ────
//
// The path-to-regex compiler powers the parameterised-route fast path
// for the .pageContext.json rewrite. Static paths take the Set fast
// path; this compiler is only consulted when a route's path contains
// `:`. Wildcard-only routes (`*` with no `:`) are intentionally left
// out of both indexes — they're catch-all fallbacks, not view returns.

describe('compileControllerViewRegex()', () => {
  it('static path: matches itself exactly', () => {
    const re = compileControllerViewRegex('/users')
    assert.ok(re.test('/users'))
    assert.ok(!re.test('/users/42'),  'must not match a longer prefix')
    assert.ok(!re.test('/use'),       'must not match a shorter prefix')
    assert.ok(!re.test('/users/'),    'must not match trailing slash')
  })

  it(':param: matches one segment, rejects multi-segment & empty', () => {
    const re = compileControllerViewRegex('/users/:id')
    assert.ok(re.test('/users/42'))
    assert.ok(re.test('/users/john-doe'))
    assert.ok(!re.test('/users'),         'parent path must not match a required :param route')
    assert.ok(!re.test('/users/'),        'empty segment must not match')
    assert.ok(!re.test('/users/42/edit'), 'multi-segment must not match')
  })

  it('multiple params + nested params: each is one segment', () => {
    const re = compileControllerViewRegex('/posts/:slug/comments/:cid')
    assert.ok(re.test('/posts/hello-world/comments/42'))
    assert.ok(!re.test('/posts/hello-world/comments'))
    assert.ok(!re.test('/posts/hello/world/comments/42'),
      'param must not span multiple segments')
  })

  it('optional :param? after slash: matches both with and without the segment', () => {
    const re = compileControllerViewRegex('/users/:id?')
    assert.ok(re.test('/users/42'))
    assert.ok(re.test('/users'),         'optional :param? must allow the bare parent path')
    assert.ok(!re.test('/users/42/x'),   'extra segment must not match')
    assert.ok(!re.test('/users/'),       'trailing slash without value must not match (Hono parity)')
  })

  it('custom regex :param{regex}: passes through verbatim — UUID', () => {
    const re = compileControllerViewRegex('/users/:id{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}')
    assert.ok(re.test('/users/550e8400-e29b-41d4-a716-446655440000'),
      'a valid UUID must match')
    assert.ok(!re.test('/users/not-a-uuid'), 'non-UUID must not match')
  })

  it('custom regex :param{regex}: passes through verbatim — number constraint', () => {
    const re = compileControllerViewRegex('/users/:id{[0-9]+}')
    assert.ok(re.test('/users/42'))
    assert.ok(!re.test('/users/abc'),  'letters must not match a {[0-9]+} constraint')
  })

  it('escapes regex metacharacters in literal path segments', () => {
    // A path like `/posts/v1.0` historically had `.` interpreted as
    // "any char" — would have matched `/posts/v1Xa`. The escaper must
    // make `.` literal.
    const re = compileControllerViewRegex('/posts/v1.0')
    assert.ok(re.test('/posts/v1.0'))
    assert.ok(!re.test('/posts/v1X0'), '`.` must be literal, not regex any-char')
  })

  it('root path matches only root', () => {
    const re = compileControllerViewRegex('/')
    assert.ok(re.test('/'))
    assert.ok(!re.test('/users'))
  })
})

// ─── controllerViewPatterns — parameterised SPA-nav rewrite ───────
//
// End-to-end: a route registered with `:param` must show up in
// controllerViewPatterns, the new _matchesControllerView() must accept
// the rewritten path, and the .pageContext.json fetch rewrite must
// dispatch to the controller rather than fall back to Vike's full-reload
// path. This is the Phase 1 fix from
// docs/plans/2026-05-21-framework-pipeline-hardening.md.

describe('HonoAdapter — controllerViewPatterns (parameterised SPA-nav)', () => {
  it('static GET route lands in controllerViewPaths (Set fast path)', () => {
    const adapter = hono().create() as ReturnType<ReturnType<typeof hono>['create']> & {
      controllerViewPaths:    Set<string>
      controllerViewPatterns: Array<{ regex: RegExp; path: string }>
    }
    adapter.registerRoute({
      method:  'GET',
      path:    '/users',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    assert.ok(adapter.controllerViewPaths.has('/users'))
    assert.strictEqual(adapter.controllerViewPatterns.length, 0,
      'static path must not bloat the pattern array')
  })

  it('parameterised GET route lands in controllerViewPatterns (regex slow path)', () => {
    const adapter = hono().create() as ReturnType<ReturnType<typeof hono>['create']> & {
      controllerViewPaths:    Set<string>
      controllerViewPatterns: Array<{ regex: RegExp; path: string }>
    }
    adapter.registerRoute({
      method:  'GET',
      path:    '/users/:id',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    assert.ok(!adapter.controllerViewPaths.has('/users/:id'),
      'parameterised paths must not pollute the static Set — would cause false negatives on real URLs')
    assert.strictEqual(adapter.controllerViewPatterns.length, 1)
    assert.strictEqual(adapter.controllerViewPatterns[0]?.path, '/users/:id')
    assert.ok(adapter.controllerViewPatterns[0]?.regex.test('/users/42'))
  })

  it('wildcard-only route (`*` with no `:`) is excluded from both indexes', () => {
    const adapter = hono().create() as ReturnType<ReturnType<typeof hono>['create']> & {
      controllerViewPaths:    Set<string>
      controllerViewPatterns: Array<{ regex: RegExp; path: string }>
    }
    adapter.registerRoute({
      method:  'ALL',
      path:    '/api/*',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    assert.ok(!adapter.controllerViewPaths.has('/api/*'),
      'wildcard fallback should not be a view candidate — was a no-op in the Set lookup pre-2026-05-22, keeping that contract')
    assert.strictEqual(adapter.controllerViewPatterns.length, 0)
  })

  it('non-GET/non-ALL routes are not tracked as view candidates', () => {
    const adapter = hono().create() as ReturnType<ReturnType<typeof hono>['create']> & {
      controllerViewPaths:    Set<string>
      controllerViewPatterns: Array<{ regex: RegExp; path: string }>
    }
    adapter.registerRoute({
      method:  'POST',
      path:    '/users/:id',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    assert.strictEqual(adapter.controllerViewPatterns.length, 0,
      'POST :param routes never receive .pageContext.json rewrites — Vike client nav is GET-only')
  })

  it('_matchesControllerView returns the matching pattern for parameterised URLs', () => {
    const adapter = hono().create() as ReturnType<ReturnType<typeof hono>['create']> & {
      _matchesControllerView: (path: string) => string | undefined
    }
    adapter.registerRoute({
      method:  'GET',
      path:    '/users',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    adapter.registerRoute({
      method:  'GET',
      path:    '/users/:id',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })

    assert.strictEqual(adapter._matchesControllerView('/users'),    '/users')
    assert.strictEqual(adapter._matchesControllerView('/users/42'), '/users/:id')
    assert.strictEqual(adapter._matchesControllerView('/random'),   undefined)
  })

  it('end-to-end: SPA-nav rewrite reaches the controller for /users/:id (Phase 1 regression)', async () => {
    // The whole point of Phase 1: SPA navigation between `/users/:id`-style
    // routes used to silently degrade to full reloads because the
    // .pageContext.json rewrite was gated on a Set lookup that only
    // tracked static paths. After this fix, the parameterised pattern
    // catches the rewrite and the controller runs end-to-end.
    const provider = hono()
    const handler  = await provider.createFetchHandler((adapter) => {
      adapter.registerRoute({
        method:  'GET',
        path:    '/users/:id',
        handler: async (req, res) => res.json({ userId: req.params['id'] }),
        middleware: [],
      })
    })

    const res = await handler(new Request('http://localhost/users/42/index.pageContext.json'))

    // Pre-fix: this would either 404 (Vike middleware doesn't know about
    // a controller-owned route) or return HTML, NOT JSON with userId 42.
    // Post-fix: the controller runs, returns JSON.
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`)
    const body = await res.json() as { userId: string }
    assert.strictEqual(body.userId, '42')
  })

  it('end-to-end: requests for static view routes still rewrite (Set fast path regression)', async () => {
    const provider = hono()
    const handler  = await provider.createFetchHandler((adapter) => {
      adapter.registerRoute({
        method:  'GET',
        path:    '/about',
        handler: async (_req, res) => res.json({ page: 'about' }),
        middleware: [],
      })
    })

    const res = await handler(new Request('http://localhost/about/index.pageContext.json'))
    assert.strictEqual(res.status, 200)
    const body = await res.json() as { page: string }
    assert.strictEqual(body.page, 'about')
  })

  it('end-to-end: .pageContext.json for an unregistered path is not rewritten (Vike handles)', async () => {
    const provider = hono()
    let controllerRan = false
    const handler  = await provider.createFetchHandler((adapter) => {
      adapter.registerRoute({
        method:  'GET',
        path:    '/users/:id',
        handler: async (_req, res) => { controllerRan = true; return res.json({ ok: true }) },
        middleware: [],
      })
    })

    // /nope/42 doesn't match any registered controller view — the rewrite
    // must NOT fire, so the request falls through to Vike's middleware.
    // What Vike returns in the test sandbox doesn't matter (no `app/Views`
    // exists, so it errors) — the contract being pinned here is that the
    // controller was NOT invoked. Pre-fix this was already the behaviour
    // for static URLs; this test guards against a future regression that
    // over-matches in the pattern array.
    await handler(new Request('http://localhost/nope/42/index.pageContext.json'))
    assert.strictEqual(controllerRan, false,
      'controller handler must not run for an unregistered .pageContext.json path')
  })
})

// vike-react-rsc-rudder serves its server-component stream and server actions
// from a fixed internal path (/_rsc, GET + POST), registered as a vike *config*
// middleware (`middleware: "import:vike-react-rsc-rudder/__internal/integration/rscMiddleware"`).
// vike's own renderPageServer reads `globalContext.config.middleware` and
// dispatches to it, so the existing `vike(app)` catch-all already serves /_rsc
// once an app extends vikeReactRsc — no extra mount is needed (see the RSC
// integration design doc, Phase 3). The only server-hono code that could break
// RSC is the .pageContext.json SPA-nav rewrite wrapper. These pin that it never
// diverts /_rsc: the path has no `/index.pageContext.json` suffix, so the
// controller-view rewrite is skipped and the request flows through to
// app.fetch (→ Vike → the RSC middleware), for both GET navigations and POST
// server actions.
describe('createFetchHandler() — RSC /_rsc pass-through (Phase 3)', () => {
  for (const method of ['GET', 'POST'] as const) {
    it(`${method} /_rsc is never diverted to a controller view`, async () => {
      const provider = hono()
      let controllerRan = false
      const handler = await provider.createFetchHandler((adapter) => {
        adapter.registerRoute({
          method:  'GET',
          path:    '/about',
          handler: async (_req, res) => { controllerRan = true; return res.json({ ok: true }) },
          middleware: [],
        })
      })

      // The response depends on Vike (no app/Views in this sandbox, and
      // vike-react-rsc-rudder isn't installed) and is irrelevant — the rewrite
      // decision happens before app.fetch, so the contract holds regardless of
      // whatever Vike returns or throws downstream.
      try {
        await handler(new Request('http://localhost/_rsc', { method }))
      } catch { /* Vike may error in the bare sandbox; rewrite already decided */ }

      assert.strictEqual(controllerRan, false,
        `${method} /_rsc must fall through to Vike, not a controller view`)
    })
  }
})

describe('HonoAdapter — null-body statuses (204/205/304)', () => {
  function appWith(method: 'GET' | 'DELETE', handler: RouteDefinition['handler']) {
    const adapter = hono().create()
    adapter.registerRoute({ method, path: '/r', handler, middleware: [] })
    return adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
  }

  it('res.status(204).send("") → 204 with no body (no undici throw)', async () => {
    const app = appWith('DELETE', async (_req, res) => res.status(204).send(''))
    const r = await app.fetch(new Request('http://localhost/r', { method: 'DELETE' }))
    assert.strictEqual(r.status, 204)
    assert.strictEqual(await r.text(), '')
  })

  it('res.status(304).send("body") drops the body', async () => {
    const app = appWith('GET', async (_req, res) => res.status(304).send('ignored'))
    const r = await app.fetch(new Request('http://localhost/r'))
    assert.strictEqual(r.status, 304)
    assert.strictEqual(await r.text(), '')
  })

  it('res.status(204).json({...}) does not crash and sends no body', async () => {
    const app = appWith('GET', async (_req, res) => res.status(204).json({ a: 1 }))
    const r = await app.fetch(new Request('http://localhost/r'))
    assert.strictEqual(r.status, 204)
    assert.strictEqual(await r.text(), '')
  })

  it('a normal 200 send still carries its body (regression guard)', async () => {
    const app = appWith('GET', async (_req, res) => res.send('hello'))
    const r = await app.fetch(new Request('http://localhost/r'))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(await r.text(), 'hello')
  })
})

// ─── Test-mode side channel ─────────────────────────────────
//
// `@rudderjs/testing` flips `globalThis['__rudderjs_test_mode__']` during
// bootstrap. The route handler then emits two extra base64-JSON headers on
// the response so TestResponse can call `assertSessionHas` / `assertViewIs`
// without coupling to @rudderjs/session or @rudderjs/view internals.

describe('HonoAdapter — test-mode side channel', () => {
  const G = globalThis as Record<string, unknown>

  function withTestMode(fn: () => Promise<void>): () => Promise<void> {
    return async () => {
      const prior = G['__rudderjs_test_mode__']
      G['__rudderjs_test_mode__'] = true
      try {
        await fn()
      } finally {
        if (prior === undefined) delete G['__rudderjs_test_mode__']
        else G['__rudderjs_test_mode__'] = prior
      }
    }
  }

  function decodeHeader<T>(value: string | null): T | undefined {
    if (!value) return undefined
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T
  }

  it('emits x-rudderjs-test-session when a session instance is on the request', withTestMode(async () => {
    const adapter = hono().create()
    // Mimic sessionMiddleware: stash a SessionInstance-shaped object on the
    // request before the chain runs. The duck-typed read in
    // attachTestSideChannel only requires `.all()` (and uses `.allFlash()`
    // when present).
    adapter.applyMiddleware(async (req, _res, next) => {
      ;(req.raw as Record<string, unknown>)['__rjs_session'] = {
        all:      () => ({ user_id: 9 }),
        allFlash: () => ({ message: 'Saved!' }),
      }
      await next()
    })
    adapter.registerRoute({
      method:  'GET',
      path:    '/r',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const r   = await app.fetch(new Request('http://localhost/r'))

    const payload = decodeHeader<{ data: Record<string, unknown>; flash: Record<string, unknown> }>(
      r.headers.get('x-rudderjs-test-session'),
    )
    assert.ok(payload, 'expected x-rudderjs-test-session header')
    assert.deepStrictEqual(payload.data, { user_id: 9 })
    assert.deepStrictEqual(payload.flash, { message: 'Saved!' })
  }))

  it('does NOT emit x-rudderjs-test-session in normal (non-test) mode', async () => {
    delete G['__rudderjs_test_mode__']
    const adapter = hono().create()
    adapter.applyMiddleware(async (req, _res, next) => {
      ;(req.raw as Record<string, unknown>)['__rjs_session'] = { all: () => ({ user_id: 9 }) }
      await next()
    })
    adapter.registerRoute({
      method:  'GET',
      path:    '/r',
      handler: async (_req, res) => res.json({ ok: true }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const r   = await app.fetch(new Request('http://localhost/r'))
    assert.strictEqual(r.headers.get('x-rudderjs-test-session'), null)
  })

  it('emits x-rudderjs-test-view when the handler returns a ViewResponse', withTestMode(async () => {
    // Build a duck-typed ViewResponse stand-in — server-hono detects this
    // via `constructor.__rudder_view__ === true` plus `.toResponse()`.
    class StubViewResponse {
      static readonly __rudder_view__ = true
      constructor(public readonly id: string, public readonly props: Record<string, unknown>) {}
      async toResponse(_ctx: { url: string }): Promise<Response> {
        return new Response(`<html>${this.id}</html>`, {
          status:  200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
    }

    const adapter = hono().create()
    adapter.registerRoute({
      method:  'GET',
      path:    '/r',
      handler: async () => new StubViewResponse('dashboard', { count: 5 }),
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const r   = await app.fetch(new Request('http://localhost/r'))

    const payload = decodeHeader<{ id: string; props: Record<string, unknown> }>(
      r.headers.get('x-rudderjs-test-view'),
    )
    assert.ok(payload, 'expected x-rudderjs-test-view header')
    assert.equal(payload.id, 'dashboard')
    assert.deepStrictEqual(payload.props, { count: 5 })
  }))
})

// ─── Client IP resolution (extractIp) ───────────────────────
//
// req.ip resolution — Laravel Request::ip() semantics. The socket address is
// the universal fallback; proxy headers are read ONLY under trustProxy. The
// srvx production server (node dist/server/index.mjs) hands the adapter a
// Request carrying an `ip` getter + `runtime.node`; @hono/node-server passes
// `{ incoming }` as hono's env. Regression for the shared-'unknown'-bucket
// bug: with trustProxy=false every req.ip was undefined, so all clients
// keyed into ONE rate-limit bucket in every default deployment.
describe('HonoAdapter — client IP resolution', () => {
  function setupEcho(trustProxy: boolean | number) {
    const adapter = hono({ trustProxy }).create()
    adapter.registerRoute({
      method:  'GET',
      path:    '/ip',
      handler: async (req, res) => res.json({ ip: req.ip ?? null }),
      middleware: [],
    })
    return adapter.getNativeServer() as {
      fetch: (req: Request, env?: unknown) => Promise<Response>
    }
  }

  function srvxStyle(url: string, opts: { ip?: string; runtimeIp?: string; headers?: Record<string, string> }): Request {
    const r = new Request(url, { headers: opts.headers ?? {} }) as Request & {
      ip?: string
      runtime?: unknown
    }
    if (opts.ip) r.ip = opts.ip
    if (opts.runtimeIp) r.runtime = { node: { req: { socket: { remoteAddress: opts.runtimeIp } } } }
    return r
  }

  it('trustProxy=false: srvx request.ip getter resolves (socket fallback)', async () => {
    const app = setupEcho(false)
    const res = await app.fetch(srvxStyle('http://localhost/ip', { ip: '203.0.113.9' }))
    assert.deepStrictEqual(await res.json(), { ip: '203.0.113.9' })
  })

  it('trustProxy=false: client-sent x-forwarded-for is IGNORED — socket wins', async () => {
    const app = setupEcho(false)
    const res = await app.fetch(srvxStyle('http://localhost/ip', {
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': '6.6.6.6' },
    }))
    assert.deepStrictEqual(await res.json(), { ip: '203.0.113.9' })
  })

  it('trustProxy=true: takes the RIGHTMOST x-forwarded-for entry (the trusted proxy appended it)', async () => {
    const app = setupEcho(true)
    const res = await app.fetch(srvxStyle('http://localhost/ip', {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
    }))
    // One trusted proxy → the rightmost entry is the address the proxy observed.
    assert.deepStrictEqual(await res.json(), { ip: '10.0.0.1' })
  })

  it('trustProxy=true: a client-SPOOFED leftmost x-forwarded-for entry is ignored', async () => {
    // Attacker sends `X-Forwarded-For: 1.2.3.4`; the trusted proxy appends the
    // real client (198.51.100.7), so the header arrives as "1.2.3.4, 198.51.100.7".
    // req.ip must be the rightmost (real) hop, NOT the attacker-chosen leftmost —
    // otherwise ip-keyed rate limits / allowlists are trivially bypassed. (The
    // pre-fix leftmost behavior returned 1.2.3.4.)
    const app = setupEcho(true)
    const res = await app.fetch(srvxStyle('http://localhost/ip', {
      ip: '198.51.100.7',
      headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' },
    }))
    assert.deepStrictEqual(await res.json(), { ip: '198.51.100.7' })
  })

  it('trustProxy=N: takes the Nth entry from the right (multi-proxy chain)', async () => {
    // Two trusted proxies in front: client → proxyA → proxyB → app. The chain is
    // "client, proxyA"; with 2 trusted hops the real client is 2 from the right.
    const app = setupEcho(2)
    const res = await app.fetch(srvxStyle('http://localhost/ip', {
      ip: '10.0.0.2',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    }))
    assert.deepStrictEqual(await res.json(), { ip: '203.0.113.5' })
  })

  it('trustProxy=true with NO proxy header: falls back to the socket (direct hit)', async () => {
    const app = setupEcho(true)
    const res = await app.fetch(srvxStyle('http://localhost/ip', { ip: '203.0.113.9' }))
    assert.deepStrictEqual(await res.json(), { ip: '203.0.113.9' })
  })

  it('srvx runtime.node.req.socket channel resolves when the ip getter is absent', async () => {
    const app = setupEcho(false)
    const res = await app.fetch(srvxStyle('http://localhost/ip', { runtimeIp: '192.0.2.4' }))
    assert.deepStrictEqual(await res.json(), { ip: '192.0.2.4' })
  })

  it('@hono/node-server env.incoming.socket channel resolves', async () => {
    const app = setupEcho(false)
    const res = await app.fetch(
      new Request('http://localhost/ip'),
      { incoming: { socket: { remoteAddress: '192.0.2.8' } } },
    )
    assert.deepStrictEqual(await res.json(), { ip: '192.0.2.8' })
  })

  it('dev-only: x-real-ip (rudderjs:ip vite injection) stands in when no socket is reachable', async () => {
    // NODE_ENV is not 'production' under the test runner, so the dev branch
    // is active — mirrors the vite pipeline where the node request became a
    // plain web Request before reaching the adapter.
    assert.notEqual(process.env['NODE_ENV'], 'production')
    const app = setupEcho(false)
    const res = await app.fetch(new Request('http://localhost/ip', {
      headers: { 'x-real-ip': '172.16.0.3' },
    }))
    assert.deepStrictEqual(await res.json(), { ip: '172.16.0.3' })
  })

  it('normalizes IPv4-mapped IPv6 socket addresses', async () => {
    const app = setupEcho(false)
    const res = await app.fetch(srvxStyle('http://localhost/ip', { ip: '::ffff:203.0.113.5' }))
    assert.deepStrictEqual(await res.json(), { ip: '203.0.113.5' })
  })

  it('returns null/undefined when no channel exists in production mode', async () => {
    const prev = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'
    try {
      const app = setupEcho(false)
      const res = await app.fetch(new Request('http://localhost/ip', {
        headers: { 'x-real-ip': '6.6.6.6' },   // client-sent — must NOT be trusted in prod
      }))
      assert.deepStrictEqual(await res.json(), { ip: null })
    } finally {
      if (prev === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = prev
    }
  })
})

// ─── Internal SPA-nav URL is not client-forgeable ──────────
// The original URL handed to Vike's renderPage() must come from the framework's
// own .pageContext.json rewrite (a per-request ALS), never from a client header
// (the old `x-rudder-original-url`), which a direct request could forge to inject
// an arbitrary URL into Vike's routing.
describe('HonoAdapter — internal SPA-nav URL is not client-forgeable', () => {
  class FakeView {
    static __rudder_view__ = true
    id = 'fake'
    props = {}
    async toResponse(ctx: { url: string }): Promise<Response> {
      return new Response(ctx.url, { status: 200 })
    }
  }

  it('ignores a forged x-rudder-original-url header — toResponse gets the real request URL', async () => {
    const adapter = hono().create()
    adapter.registerRoute({
      method:     'GET',
      path:       '/dash',
      handler:    (async () => new FakeView()) as unknown as RouteDefinition['handler'],
      middleware: [],
    })
    const app = adapter.getNativeServer() as { fetch: (req: Request) => Promise<Response> }
    const res = await app.fetch(new Request('http://localhost/dash', {
      headers: { 'x-rudder-original-url': 'http://evil.example/inject.pageContext.json' },
    }))
    assert.strictEqual(await res.text(), 'http://localhost/dash')
  })
})

// ─── Dev error-page gate (secure-by-default) ───────────────
describe('devErrorPageEnabled — secure-by-default error-page gate', () => {
  it('treats unset env as production (no dev page) — the secure default', () => {
    assert.strictEqual(devErrorPageEnabled({}), false)
  })

  it('renders the dev page only for explicit dev/local envs', () => {
    assert.strictEqual(devErrorPageEnabled({ APP_ENV: 'local' }), true)
    assert.strictEqual(devErrorPageEnabled({ APP_ENV: 'development' }), true)
    assert.strictEqual(devErrorPageEnabled({ NODE_ENV: 'development' }), true)
  })

  it('treats production / staging / unknown as production', () => {
    assert.strictEqual(devErrorPageEnabled({ APP_ENV: 'production' }), false)
    assert.strictEqual(devErrorPageEnabled({ NODE_ENV: 'production' }), false)
    assert.strictEqual(devErrorPageEnabled({ APP_ENV: 'staging' }), false)
    assert.strictEqual(devErrorPageEnabled({ APP_ENV: 'production', NODE_ENV: 'development' }), false)
  })
})
