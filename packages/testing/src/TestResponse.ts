import assert from 'node:assert/strict'
import { AssertableJson } from './AssertableJson.js'

/**
 * Wraps an HTTP response with fluent assertion methods.
 *
 * @example
 * const response = await t.get('/api/users')
 * response.assertOk()
 * response.assertJson({ name: 'John' })
 * response.assertJsonPath('data.0.email', 'john@test.com')
 */
/**
 * Decoded payload from the server-hono test-mode side channel. Surfaced to
 * `assertSessionHas` / `assertSessionMissing` / `assertSessionHasErrors`.
 *
 * `data` mirrors `SessionInstance.all()`; `flash` mirrors `allFlash()` —
 * Laravel's `withErrors(...)` redirects flash a `Record<string, string[]>`
 * under the `errors` key, which both `assertSessionHasErrors` and the
 * web-side `assertInvalid` read from.
 */
export interface TestResponseSession {
  data:  Record<string, unknown>
  flash: Record<string, unknown>
}

/**
 * Decoded payload from the server-hono test-mode side channel for routes
 * that returned a `view('...', props)` from `@rudderjs/view`. Surfaced to
 * `assertViewIs` / `assertViewHas`.
 */
export interface TestResponseView {
  id:    string
  props: Record<string, unknown>
}

export interface TestResponseExtras {
  /** Server-side session payload, decoded from the test-mode side channel. */
  session?: TestResponseSession
  /** Rendered view info, decoded from the test-mode side channel. */
  view?:    TestResponseView
}

export class TestResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: unknown
  /**
   * Raw `Set-Cookie` header values from the response, one entry per cookie set.
   * Empty when the response sets no cookies. Provided as a separate array
   * because `headers` collapses duplicate header names to a single value.
   */
  readonly setCookies: string[]
  private _text: string
  private _session: TestResponseSession | undefined
  private _view:    TestResponseView | undefined

  constructor(
    status: number,
    headers: Record<string, string>,
    body: unknown,
    text: string,
    setCookies: string[] = [],
    extras: TestResponseExtras = {},
  ) {
    this.status     = status
    this.headers    = headers
    this.body       = body
    this._text      = text
    this.setCookies = setCookies
    this._session   = extras.session
    this._view      = extras.view
  }

  /** Raw response text. */
  text(): string { return this._text }

  /** Parsed JSON body (same as .body). */
  json(): unknown { return this.body }

  // ─── Status assertions ──────────────────────────────────

  assertStatus(expected: number): this {
    assert.equal(this.status, expected, `Expected status ${expected}, got ${this.status}`)
    return this
  }

  assertOk(): this { return this.assertStatus(200) }
  assertCreated(): this { return this.assertStatus(201) }
  assertAccepted(): this { return this.assertStatus(202) }
  assertNoContent(): this { return this.assertStatus(204) }
  assertBadRequest(): this { return this.assertStatus(400) }
  assertUnauthorized(): this { return this.assertStatus(401) }
  assertForbidden(): this { return this.assertStatus(403) }
  assertNotFound(): this { return this.assertStatus(404) }
  assertConflict(): this { return this.assertStatus(409) }
  assertGone(): this { return this.assertStatus(410) }
  assertUnprocessable(): this { return this.assertStatus(422) }
  assertTooManyRequests(): this { return this.assertStatus(429) }

  assertSuccessful(): this {
    assert.ok(this.status >= 200 && this.status < 300, `Expected successful status (2xx), got ${this.status}`)
    return this
  }

  assertServerError(): this {
    assert.ok(this.status >= 500, `Expected server error (5xx), got ${this.status}`)
    return this
  }

  // ─── JSON assertions ───────────────────────────────────

  /**
   * Assert on response JSON. Two forms:
   *
   * - **Subset match** — pass a partial object; every entry is checked
   *   against the corresponding top-level key (deep equal). Extra keys in
   *   the response are ignored.
   * - **Fluent** — pass a callback `(json: AssertableJson) => void` and use
   *   the Laravel-parity DSL (`has` / `where` / `whereType` / `missing` /
   *   `count` / `first` / `each` / `etc`). Strict-by-default: every key not
   *   touched by an assertion fails the test unless `etc()` is called.
   *
   * @example
   * res.assertJson({ name: 'Alice' })                   // subset match
   *
   * res.assertJson(json =>
   *   json.has('user').where('user.name', 'Alice').etc()
   * )                                                    // fluent
   */
  assertJson(expected: Record<string, unknown>): this
  assertJson(callback: (json: AssertableJson) => void): this
  assertJson(arg: Record<string, unknown> | ((json: AssertableJson) => void)): this {
    if (typeof arg === 'function') {
      const j = new AssertableJson(this.body)
      arg(j)
      ;(j as unknown as { _verifyInteracted(): void })._verifyInteracted()
      return this
    }
    const body = this.body as Record<string, unknown>
    for (const [key, value] of Object.entries(arg)) {
      assert.deepStrictEqual(body[key], value, `JSON key "${key}" does not match`)
    }
    return this
  }

  /** Assert a value at a dot-separated JSON path. */
  assertJsonPath(path: string, expected: unknown): this {
    const actual = getPath(this.body, path)
    assert.deepStrictEqual(actual, expected, `JSON path "${path}" does not match`)
    return this
  }

  /** Assert an array at the given JSON path has the expected length. */
  assertJsonCount(count: number, path?: string): this {
    const target = path ? getPath(this.body, path) : this.body
    assert.ok(Array.isArray(target), `Expected array at ${path ?? 'root'}, got ${typeof target}`)
    assert.equal(target.length, count, `Expected ${count} items at "${path ?? 'root'}", got ${target.length}`)
    return this
  }

  /** Assert response JSON has the given top-level keys. */
  assertJsonStructure(keys: string[]): this {
    const body = this.body as Record<string, unknown>
    for (const key of keys) {
      assert.ok(key in body, `Expected JSON to have key "${key}"`)
    }
    return this
  }

  /** Assert response JSON does NOT contain the given key-value pairs. */
  assertJsonMissing(data: Record<string, unknown>): this {
    const body = this.body as Record<string, unknown>
    for (const [key, value] of Object.entries(data)) {
      if (key in body) {
        assert.notDeepStrictEqual(body[key], value, `JSON key "${key}" should not match the given value`)
      }
    }
    return this
  }

  /** Assert the response JSON exactly equals the given object (no extra keys). */
  assertExactJson(expected: Record<string, unknown>): this {
    assert.deepStrictEqual(
      this.body,
      expected,
      `Response JSON does not exactly match — expected ${JSON.stringify(expected)}, got ${JSON.stringify(this.body)}`,
    )
    return this
  }

  /** Assert the response JSON does NOT exactly equal the given object. */
  assertJsonMissingExact(expected: Record<string, unknown>): this {
    assert.notDeepStrictEqual(
      this.body,
      expected,
      `Response JSON should not exactly match ${JSON.stringify(expected)}`,
    )
    return this
  }

  /**
   * Assert the response JSON contains the given fragment somewhere in its
   * tree — matches if every key/value pair appears together on any object
   * node in the body. Walks arrays and nested objects.
   */
  assertJsonFragment(fragment: Record<string, unknown>): this {
    assert.ok(
      containsFragment(this.body, fragment),
      `Response JSON does not contain fragment ${JSON.stringify(fragment)}`,
    )
    return this
  }

  // ─── Content assertions ────────────────────────────────

  /** Assert the raw response text equals the given value. */
  assertContent(value: string): this {
    assert.equal(this._text, value, `Expected response body to equal "${value}", got "${this._text}"`)
    return this
  }

  /** Assert the response body contains the given substring (raw — includes HTML). */
  assertSee(value: string): this {
    assert.ok(this._text.includes(value), `Expected response body to contain "${value}"`)
    return this
  }

  /** Assert the response body does NOT contain the given substring (raw). */
  assertDontSee(value: string): this {
    assert.ok(!this._text.includes(value), `Expected response body NOT to contain "${value}"`)
    return this
  }

  /** Like `assertSee`, but strips HTML tags + collapses whitespace before matching. */
  assertSeeText(value: string): this {
    const text = stripHtml(this._text)
    assert.ok(text.includes(value), `Expected response text (HTML stripped) to contain "${value}"`)
    return this
  }

  /** Like `assertDontSee`, but strips HTML tags + collapses whitespace before matching. */
  assertDontSeeText(value: string): this {
    const text = stripHtml(this._text)
    assert.ok(!text.includes(value), `Expected response text (HTML stripped) NOT to contain "${value}"`)
    return this
  }

  /** Assert the given substrings appear in the response body in this order. */
  assertSeeInOrder(values: string[]): this {
    let cursor = 0
    for (const v of values) {
      const idx = this._text.indexOf(v, cursor)
      assert.ok(idx >= 0, `Expected to see "${v}" in order, but it was missing or out of order`)
      cursor = idx + v.length
    }
    return this
  }

  // ─── Cookie assertions ─────────────────────────────────

  /**
   * Assert that the response set a cookie with the given name. Optionally
   * verify the value substring.
   */
  assertCookie(name: string, value?: string): this {
    const cookie = this.setCookies.find((c) => c.startsWith(`${name}=`))
    assert.ok(cookie, `Expected response to set cookie "${name}"`)
    if (value !== undefined) {
      const cookieValue = cookie.slice(name.length + 1).split(';')[0] ?? ''
      assert.ok(
        cookieValue.includes(value),
        `Expected cookie "${name}" to contain "${value}", got "${cookieValue}"`,
      )
    }
    return this
  }

  /** Assert that the response did NOT set a cookie with the given name. */
  assertCookieMissing(name: string): this {
    const cookie = this.setCookies.find((c) => c.startsWith(`${name}=`))
    assert.equal(cookie, undefined, `Expected no Set-Cookie for "${name}", but found one`)
    return this
  }

  // ─── Header assertions ─────────────────────────────────

  assertHeader(name: string, value?: string): this {
    const actual = this.headers[name.toLowerCase()]
    assert.ok(actual !== undefined, `Expected header "${name}" to be present`)
    if (value !== undefined) {
      assert.ok(actual.includes(value), `Expected header "${name}" to contain "${value}", got "${actual}"`)
    }
    return this
  }

  assertHeaderMissing(name: string): this {
    assert.equal(this.headers[name.toLowerCase()], undefined, `Expected header "${name}" to be absent`)
    return this
  }

  // ─── Session assertions ────────────────────────────────

  /**
   * Assert the response's session has `key` set in the data bag. When `value`
   * is provided, compares deep-equal. Reads from the `x-rudderjs-test-session`
   * side channel emitted by server-hono in test mode — requires a session
   * provider on the route (auto-installed on the `web` group).
   */
  assertSessionHas(key: string, value?: unknown): this {
    const session = this._requireSession('assertSessionHas')
    assert.ok(
      key in session.data,
      `Expected session to have key "${key}", but it was missing. ` +
      `Keys: [${Object.keys(session.data).join(', ')}]`,
    )
    if (value !== undefined) {
      assert.deepStrictEqual(
        session.data[key],
        value,
        `Expected session["${key}"] to deeply equal ${JSON.stringify(value)}, ` +
        `got ${JSON.stringify(session.data[key])}`,
      )
    }
    return this
  }

  /** Assert the response's session does NOT have `key` set in the data bag. */
  assertSessionMissing(key: string): this {
    const session = this._requireSession('assertSessionMissing')
    assert.ok(
      !(key in session.data),
      `Expected session NOT to have key "${key}", but it was present ` +
      `(value: ${JSON.stringify(session.data[key])})`,
    )
    return this
  }

  /**
   * Assert the response flashed validation errors for each of the given keys.
   * Matches Laravel's session-based error bag — `errors` lives in the flash
   * payload as a `Record<string, string[]>` (the shape `withErrors($validator)`
   * produces on redirect).
   */
  assertSessionHasErrors(keys: string[]): this {
    const session = this._requireSession('assertSessionHasErrors')
    const errors = (session.flash['errors'] ?? {}) as Record<string, unknown>
    for (const key of keys) {
      assert.ok(
        key in errors,
        `Expected session flash["errors"] to contain "${key}", ` +
        `got [${Object.keys(errors).join(', ')}]`,
      )
    }
    return this
  }

  // ─── View assertions ───────────────────────────────────

  /**
   * Assert the route returned `view(id, ...)` from `@rudderjs/view` with the
   * given id. Reads from the `x-rudderjs-test-view` side channel emitted by
   * server-hono in test mode — fails when the response wasn't a `ViewResponse`.
   */
  assertViewIs(id: string): this {
    const view = this._requireView('assertViewIs')
    assert.equal(view.id, id, `Expected view "${id}", got "${view.id}"`)
    return this
  }

  /**
   * Assert the rendered view received `key` in its props. When `value` is
   * provided, compares deep-equal.
   */
  assertViewHas(key: string, value?: unknown): this {
    const view = this._requireView('assertViewHas')
    assert.ok(
      key in view.props,
      `Expected view "${view.id}" to have prop "${key}", ` +
      `got props: [${Object.keys(view.props).join(', ')}]`,
    )
    if (value !== undefined) {
      assert.deepStrictEqual(
        view.props[key],
        value,
        `Expected view "${view.id}" prop "${key}" to deeply equal ` +
        `${JSON.stringify(value)}, got ${JSON.stringify(view.props[key])}`,
      )
    }
    return this
  }

  // ─── Validation assertions ─────────────────────────────

  /**
   * Assert the response carries no validation errors — neither in the JSON
   * body (`{ errors: { ... } }`, the API shape) nor in the session flash
   * `errors` bag (the web/redirect shape). Status code is not checked here;
   * pair with `assertOk()` / `assertRedirect()` as appropriate.
   */
  assertValid(): this {
    const jsonErrors = this._jsonValidationErrors()
    if (jsonErrors) {
      assert.fail(
        `Expected no validation errors, got JSON errors for: ` +
        `[${Object.keys(jsonErrors).join(', ')}]`,
      )
    }
    if (this._session) {
      const flashErrors = (this._session.flash['errors'] ?? {}) as Record<string, unknown>
      const keys = Object.keys(flashErrors)
      if (keys.length > 0) {
        assert.fail(`Expected no validation errors, got session errors for: [${keys.join(', ')}]`)
      }
    }
    return this
  }

  /**
   * Assert the response carries validation errors. With `keys`, every listed
   * key must be present. Looks at the JSON body's `errors` map and the
   * session flash `errors` bag — whichever applies. Call sites that *only*
   * want the JSON path can use `assertJsonValidationErrors` instead.
   */
  assertInvalid(keys?: string[]): this {
    const jsonErrors = this._jsonValidationErrors()
    const flashErrors = this._session
      ? (this._session.flash['errors'] ?? {}) as Record<string, unknown>
      : {}

    const hasJson  = jsonErrors !== undefined && Object.keys(jsonErrors).length > 0
    const hasFlash = Object.keys(flashErrors).length > 0
    assert.ok(
      hasJson || hasFlash,
      `Expected validation errors on the response, but found none ` +
      `(no JSON body.errors and no session flash.errors).`,
    )
    if (keys?.length) {
      const merged = { ...flashErrors, ...(jsonErrors ?? {}) }
      for (const key of keys) {
        assert.ok(
          key in merged,
          `Expected validation error for "${key}", ` +
          `got errors for: [${Object.keys(merged).join(', ')}]`,
        )
      }
    }
    return this
  }

  /**
   * Assert the JSON body contains validation errors for each of the given
   * keys. Matches Laravel's `assertJsonValidationErrors` — strictly the JSON
   * path; session flash isn't consulted. Pair with `assertUnprocessable()`
   * when asserting the typical 422 response from a form-request rejection.
   */
  assertJsonValidationErrors(keys: string[]): this {
    const errors = this._jsonValidationErrors()
    assert.ok(
      errors !== undefined,
      `Expected JSON body to have an "errors" object, ` +
      `got ${JSON.stringify(this.body)}`,
    )
    for (const key of keys) {
      assert.ok(
        key in errors,
        `Expected JSON validation error for "${key}", ` +
        `got errors for: [${Object.keys(errors).join(', ')}]`,
      )
    }
    return this
  }

  // ─── Redirect assertions ───────────────────────────────

  assertRedirect(location?: string): this {
    assert.ok(
      this.status >= 300 && this.status < 400,
      `Expected redirect status (3xx), got ${this.status}`,
    )
    if (location) {
      const actual = this.headers['location']
      assert.ok(actual?.includes(location), `Expected redirect to "${location}", got "${actual}"`)
    }
    return this
  }

  // ─── Helpers ──────────────────────────────────────────────

  private _requireSession(label: string): TestResponseSession {
    if (!this._session) {
      assert.fail(
        `${label} called but the response carries no session payload. ` +
        `The session test-mode side channel only fires when a session ` +
        `provider is registered (auto-installed on the "web" group) and ` +
        `the route ran through that group.`,
      )
    }
    return this._session
  }

  private _requireView(label: string): TestResponseView {
    if (!this._view) {
      assert.fail(
        `${label} called but the response was not produced by view(...). ` +
        `Either the route returned JSON / a raw Response, or the route is ` +
        `outside the controller-view path.`,
      )
    }
    return this._view
  }

  /**
   * Return the JSON body's `errors` map when present (Laravel's API-style
   * validation error envelope: `{ message?, errors: { field: [...] } }`).
   * Returns `undefined` when the body isn't an object or has no `errors` key
   * — both states mean "no JSON validation errors here, check elsewhere".
   */
  private _jsonValidationErrors(): Record<string, unknown> | undefined {
    if (this.body === null || typeof this.body !== 'object' || Array.isArray(this.body)) {
      return undefined
    }
    const errors = (this.body as Record<string, unknown>)['errors']
    if (errors === null || errors === undefined || typeof errors !== 'object' || Array.isArray(errors)) {
      return undefined
    }
    return errors as Record<string, unknown>
  }
}

// ─── Helpers ──────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Walk a JSON body recursively, returning true when any object node contains
 * every key/value pair from `fragment` (deep-equal values).
 */
function containsFragment(node: unknown, fragment: Record<string, unknown>): boolean {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) return node.some((child) => containsFragment(child, fragment))
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const matchesHere = Object.entries(fragment).every(([k, v]) => deepEqual(obj[k], v))
    if (matchesHere) return true
    return Object.values(obj).some((child) => containsFragment(child, fragment))
  }
  return false
}

function deepEqual(a: unknown, b: unknown): boolean {
  try { assert.deepStrictEqual(a, b); return true } catch { return false }
}

/** Strip HTML tags and collapse runs of whitespace for content assertions. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
