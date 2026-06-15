import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { escapeHtml, html, SafeString, safeUrl, serializeViewProps, view, isViewResponse, ViewResponse, _resetVikeServerCacheForTests } from './index.js'

describe('escapeHtml()', () => {
  it('escapes the five HTML-sensitive characters', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('escapes ampersand first to avoid double-encoding', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b')
    assert.equal(escapeHtml('&amp;'), '&amp;amp;')
  })

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("it's"), 'it&#39;s')
  })

  it('returns empty string for null/undefined', () => {
    assert.equal(escapeHtml(null),      '')
    assert.equal(escapeHtml(undefined), '')
  })

  it('stringifies non-strings before escaping', () => {
    assert.equal(escapeHtml(42),    '42')
    assert.equal(escapeHtml(true),  'true')
    assert.equal(escapeHtml(false), 'false')
  })
})

describe('html`` tagged template', () => {
  it('returns a SafeString', () => {
    const result = html`<p>hi</p>`
    assert.ok(result instanceof SafeString)
    assert.equal(result.value, '<p>hi</p>')
    assert.equal(String(result), '<p>hi</p>')
  })

  it('escapes string interpolations', () => {
    const name = '<script>alert(1)</script>'
    const result = html`<h1>${name}</h1>`
    assert.equal(result.value, '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>')
  })

  it('escapes number interpolations', () => {
    const result = html`<p>${42}</p>`
    assert.equal(result.value, '<p>42</p>')
  })

  it('renders null / undefined / false as empty strings', () => {
    // Route the empties through `unknown`-typed bindings: `html` is a tagged
    // template (values reach the tag function un-stringified), but a bare
    // `${null}`/`${undefined}` literal in the source reads as a plain-template
    // string coercion to static analysis.
    const [n, u, f]: unknown[] = [null, undefined, false]
    assert.equal(html`a${n}b${u}c${f}d`.value, 'abcd')
  })

  it('passes SafeString values through without re-escaping', () => {
    const inner = new SafeString('<b>bold</b>')
    const result = html`<p>${inner}</p>`
    assert.equal(result.value, '<p><b>bold</b></p>')
  })

  it('composes nested html`` without double-escaping', () => {
    const greeting = html`<strong>${'<hi>'}</strong>`
    const outer    = html`<p>${greeting}</p>`
    assert.equal(outer.value, '<p><strong>&lt;hi&gt;</strong></p>')
  })

  it('joins array values, escaping primitives but passing through SafeStrings', () => {
    const rows = [
      html`<tr><td>${'Alice <>'}</td></tr>`,
      html`<tr><td>${'Bob'}</td></tr>`,
    ]
    const table = html`<table>${rows}</table>`
    assert.equal(
      table.value,
      '<table><tr><td>Alice &lt;&gt;</td></tr><tr><td>Bob</td></tr></table>',
    )
  })

  it('escapes primitives inside arrays', () => {
    const items = ['<a>', '<b>', '<c>']
    const result = html`<ul>${items}</ul>`
    assert.equal(result.value, '<ul>&lt;a&gt;&lt;b&gt;&lt;c&gt;</ul>')
  })

  it('handles an interpolation-only template', () => {
    assert.equal(html`${'<x>'}`.value, '&lt;x&gt;')
  })

  it('handles an empty template', () => {
    assert.equal(html``.value, '')
  })
})

describe('SafeString brand (anti-laundering)', () => {
  it('does NOT pass a prototype-spoofed fake SafeString through unescaped', () => {
    // An attacker-shaped object with SafeString's prototype but no real brand.
    const fake = Object.create(SafeString.prototype) as { value: string }
    fake.value = '<script>alert(1)</script>'
    const out = html`<div>${fake}</div>`.value
    // The fake must be escaped (treated as untrusted), not emitted raw.
    assert.doesNotMatch(out, /<script>/)
    assert.match(out, /&lt;script&gt;/)
  })

  it('SafeString.isSafe is true for genuine instances, false for impostors', () => {
    assert.equal(SafeString.isSafe(new SafeString('<b>x</b>')), true)
    assert.equal(SafeString.isSafe(html`<b>x</b>`), true)
    assert.equal(SafeString.isSafe(Object.create(SafeString.prototype)), false)
    assert.equal(SafeString.isSafe({ value: '<x>' }), false)
    assert.equal(SafeString.isSafe('<x>'), false)
    assert.equal(SafeString.isSafe(null), false)
  })
})

describe('safeUrl()', () => {
  it('neutralizes javascript:/data:/vbscript: schemes to "#"', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#')
    assert.equal(safeUrl('JavaScript:alert(1)'), '#')
    assert.equal(safeUrl('  javascript:alert(1)'), '#')
    assert.equal(safeUrl('java\tscript:alert(1)'), '#')
    assert.equal(safeUrl('data:text/html,<script>'), '#')
    assert.equal(safeUrl('vbscript:msgbox'), '#')
  })

  it('passes safe http/https/mailto/relative URLs through unchanged', () => {
    assert.equal(safeUrl('https://example.com/x?y=1'), 'https://example.com/x?y=1')
    assert.equal(safeUrl('/dashboard'), '/dashboard')
    assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com')
    assert.equal(safeUrl(null), '')
  })
})

describe('serializeViewProps()', () => {
  it('honors toJSON() on nested values and leaves plain data intact', () => {
    const model = { a: 1, secret: 'x', toJSON() { return { a: this.a } } }
    const out = serializeViewProps({ model, list: [model], n: 5, s: 'hi' })
    assert.deepEqual(out, { model: { a: 1 }, list: [{ a: 1 }], n: 5, s: 'hi' })
  })

  it('does not infinite-loop on a circular prop graph', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a['self'] = a
    assert.doesNotThrow(() => serializeViewProps({ a }))
  })
})

describe('view() + isViewResponse()', () => {
  it('view() returns a ViewResponse', () => {
    const r = view('home', { x: 1 })
    assert.ok(r instanceof ViewResponse)
    assert.equal(r.id, 'home')
    assert.deepEqual(r.props, { x: 1 })
  })

  it('isViewResponse() detects via static marker', () => {
    assert.equal(isViewResponse(view('home')), true)
    assert.equal(isViewResponse({}),            false)
    assert.equal(isViewResponse(null),          false)
  })

  it('view() with no props defaults to empty object', () => {
    const r = view('about')
    assert.ok(r instanceof ViewResponse)
    assert.equal(r.id, 'about')
    assert.deepEqual(r.props, {})
  })

  it('isViewResponse() returns false for undefined', () => {
    assert.equal(isViewResponse(undefined), false)
  })

  it('SafeString.toString() returns the raw value', () => {
    const s = new SafeString('<b>bold</b>')
    assert.equal(s.toString(), '<b>bold</b>')
  })
})

// ─── view() options.headers ───────────────────────────────

describe('view() with options.headers', () => {
  it('stores plain-object headers on the response', () => {
    const r = view('marketing.pricing', {}, {
      headers: { 'cache-control': 'public, max-age=3600' },
    })
    assert.deepEqual(r.resolveHeaders(), { 'cache-control': 'public, max-age=3600' })
  })

  it('resolves function-form headers at call time', () => {
    let count = 0
    const r = view('admin.dashboard', {}, {
      headers: () => ({ 'x-nonce': String(++count) }),
    })
    assert.deepEqual(r.resolveHeaders(), { 'x-nonce': '1' })
    assert.deepEqual(r.resolveHeaders(), { 'x-nonce': '2' })
  })

  it('returns {} when no headers option provided', () => {
    const r = view('home', {})
    assert.deepEqual(r.resolveHeaders(), {})
  })

  it('drops reserved framework-owned headers (set-cookie, vary)', () => {
    const r = view('home', {}, {
      headers: {
        'cache-control': 'public, max-age=60',
        'set-cookie':    'session=hijack',
        'vary':          'cookie',
      },
    })
    assert.deepEqual(r.resolveHeaders(), { 'cache-control': 'public, max-age=60' })
  })

  it('drops x-rudderjs-* prefixed headers', () => {
    const r = view('home', {}, {
      headers: {
        'cache-control':       'public',
        'x-rudderjs-internal': 'leak',
      },
    })
    assert.deepEqual(r.resolveHeaders(), { 'cache-control': 'public' })
  })

  it('treats reserved header check case-insensitively', () => {
    const r = view('home', {}, {
      headers: {
        'cache-control': 'public',
        'Set-Cookie':    'foo=bar',
        'Vary':          'cookie',
      },
    })
    assert.deepEqual(r.resolveHeaders(), { 'cache-control': 'public' })
  })
})

// ─── ViewResponse.toResponse() ────────────────────────────
//
// Mocks Vike's `renderPage()` via `mock.module()` to exercise the three
// branches: success (httpResponse → Response), errorWhileRendering (rethrow),
// and missing httpResponse (404 fallback). Also asserts that viewProps,
// viewHeaders, and urlOriginal are forwarded faithfully.

interface FakeHttpResponse {
  statusCode:    number
  contentType:   string
  headers:       [string, string][]
  body:          string
}

interface CapturedRenderArgs {
  urlOriginal?: string
  viewProps?:   unknown
  viewHeaders?: unknown
}

function installVikeMock(opts: {
  httpResponse?:        FakeHttpResponse
  errorWhileRendering?: unknown
}): { calls: CapturedRenderArgs[] } {
  const calls: CapturedRenderArgs[] = []
  const renderPage = async (args: CapturedRenderArgs) => {
    calls.push(args)
    const result: Record<string, unknown> = {}
    if (opts.httpResponse) {
      const hr = opts.httpResponse
      result['httpResponse'] = {
        statusCode:           hr.statusCode,
        contentType:          hr.contentType,
        headers:              hr.headers,
        getReadableWebStream() {
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(hr.body))
              controller.close()
            },
          })
        },
      }
    }
    if (opts.errorWhileRendering !== undefined) {
      result['errorWhileRendering'] = opts.errorWhileRendering
    }
    return result
  }
  mock.module('vike/server', { namedExports: { renderPage } })
  return { calls }
}

afterEach(() => {
  mock.reset()
  // `vike/server` is loaded once and cached for the process lifetime; clear
  // the cache between tests so each can install its own renderPage mock.
  _resetVikeServerCacheForTests()
})

describe('ViewResponse.toResponse()', () => {
  it('returns a Response built from Vike\'s httpResponse', async () => {
    installVikeMock({
      httpResponse: {
        statusCode:  200,
        contentType: 'text/html;charset=utf-8',
        headers:     [['x-test', 'on']],
        body:        '<html>hi</html>',
      },
    })

    const res = await view('home', { x: 1 }).toResponse({ url: '/home' })
    assert.ok(res instanceof Response)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-test'), 'on')
    assert.equal(res.headers.get('Content-Type'), 'text/html;charset=utf-8')
    assert.equal(await res.text(), '<html>hi</html>')
  })

  it('forwards urlOriginal, viewProps, and viewHeaders to renderPage', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })

    const r = view('dashboard', { user: 'alice' }, {
      headers: { 'cache-control': 'private' },
    })
    await r.toResponse({ url: '/dashboard?ref=test' })

    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.urlOriginal, '/dashboard?ref=test')
    assert.deepEqual(calls[0]!.viewProps,   { user: 'alice' })
    assert.deepEqual(calls[0]!.viewHeaders, { 'cache-control': 'private' })
  })

  it('forwards a resolved function-form viewHeaders to renderPage', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })

    let count = 0
    const r = view('admin', {}, { headers: () => ({ 'x-nonce': String(++count) }) })
    await r.toResponse({ url: '/admin' })

    assert.deepEqual(calls[0]!.viewHeaders, { 'x-nonce': '1' })
  })

  it('rethrows errorWhileRendering as-is', async () => {
    const renderErr = new Error('boom-in-render')
    installVikeMock({ errorWhileRendering: renderErr })

    await assert.rejects(
      () => view('home').toResponse({ url: '/home' }),
      (err) => err === renderErr,
    )
  })

  it('falls back to a 404 plain-text Response when httpResponse is missing', async () => {
    installVikeMock({})  // no httpResponse, no errorWhileRendering

    const res = await view('does-not-exist').toResponse({ url: '/does-not-exist' })
    assert.equal(res.status, 404)
    assert.equal(res.headers.get('Content-Type'), 'text/plain')
    assert.match(await res.text(), /View "does-not-exist" not found/)
  })

  it('preserves the statusCode from Vike (200 → 200, 500 → 500)', async () => {
    installVikeMock({
      httpResponse: { statusCode: 500, contentType: 'text/html', headers: [], body: 'oops' },
    })

    const res = await view('error').toResponse({ url: '/error' })
    assert.equal(res.status, 500)
    assert.equal(await res.text(), 'oops')
  })

  it('uses Vike\'s contentType when no Content-Type header is supplied', async () => {
    installVikeMock({
      httpResponse: {
        statusCode:  200,
        contentType: 'application/json',
        headers:     [],  // no Content-Type in the array
        body:        '{}',
      },
    })

    const res = await view('api').toResponse({ url: '/api' })
    assert.equal(res.headers.get('Content-Type'), 'application/json')
  })

  it('does not overwrite a Content-Type already present in Vike\'s headers array', async () => {
    installVikeMock({
      httpResponse: {
        statusCode:  200,
        contentType: 'application/json',
        headers:     [['content-type', 'text/html; charset=utf-8']],
        body:        '<p>hi</p>',
      },
    })

    const res = await view('mixed').toResponse({ url: '/mixed' })
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8')
  })

  it('passes an empty viewHeaders object when no headers option is provided', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })
    await view('plain').toResponse({ url: '/plain' })
    assert.deepEqual(calls[0]!.viewHeaders, {})
  })

  it('drops reserved headers from viewHeaders before forwarding', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })
    const r = view('home', {}, {
      headers: {
        'cache-control':   'public',
        'Set-Cookie':      'session=hijack',
        'x-rudderjs-mark': 'leak',
      },
    })
    await r.toResponse({ url: '/home' })
    assert.deepEqual(calls[0]!.viewHeaders, { 'cache-control': 'public' })
  })

  it('scrubs ORM-model props through toJSON() so hidden columns never reach the client', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })
    // A Model-like object whose toJSON() honors `static hidden` (drops password).
    const user = {
      id: 1,
      email: 'alice@example.com',
      password: '$2b$HASH',
      rememberToken: 'SECRET',
      toJSON() { return { id: this.id, email: this.email } },
    }
    await view('dashboard', { user, posts: [user] }).toResponse({ url: '/dashboard' })

    assert.deepEqual(calls[0]!.viewProps, {
      user:  { id: 1, email: 'alice@example.com' },
      posts: [{ id: 1, email: 'alice@example.com' }],
    })
    const serialized = JSON.stringify(calls[0]!.viewProps)
    assert.doesNotMatch(serialized, /\$2b\$HASH/, 'password hash must not be forwarded')
    assert.doesNotMatch(serialized, /SECRET/,     'remember token must not be forwarded')
  })

  it('preserves Date props as real Dates (Vike round-trips them) instead of scrubbing', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })
    const when = new Date('2026-06-15T00:00:00.000Z')
    await view('home', { when }).toResponse({ url: '/home' })
    assert.ok((calls[0]!.viewProps as { when: unknown }).when instanceof Date)
  })

  it('drops a header whose value carries CRLF instead of throwing a 500', async () => {
    const { calls } = installVikeMock({
      httpResponse: { statusCode: 200, contentType: 'text/html', headers: [], body: '' },
    })
    const r = view('home', {}, {
      headers: { 'x-ok': 'fine', 'x-bad': 'a\r\nset-cookie: evil=1' },
    })
    await r.toResponse({ url: '/home' })
    assert.deepEqual(calls[0]!.viewHeaders, { 'x-ok': 'fine' })
  })
})
