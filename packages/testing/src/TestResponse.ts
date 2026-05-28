import assert from 'node:assert/strict'

/**
 * Wraps an HTTP response with fluent assertion methods.
 *
 * @example
 * const response = await t.get('/api/users')
 * response.assertOk()
 * response.assertJson({ name: 'John' })
 * response.assertJsonPath('data.0.email', 'john@test.com')
 */
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

  constructor(
    status: number,
    headers: Record<string, string>,
    body: unknown,
    text: string,
    setCookies: string[] = [],
  ) {
    this.status     = status
    this.headers    = headers
    this.body       = body
    this._text      = text
    this.setCookies = setCookies
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

  /** Assert response JSON contains the given key-value pairs (partial match). */
  assertJson(expected: Record<string, unknown>): this {
    const body = this.body as Record<string, unknown>
    for (const [key, value] of Object.entries(expected)) {
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
