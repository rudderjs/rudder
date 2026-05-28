import assert from 'node:assert/strict'

/**
 * Fluent, strict-by-default JSON assertion DSL — Laravel-parity for
 * `AssertableJson` (Laravel 12.x).
 *
 * Strict-by-default is the headline behavior: at the end of a scope (root or
 * any scoped callback), `_verifyInteracted()` asserts that every key on the
 * current object node was touched by `has` / `where` / `missing` / etc.
 * Unchecked keys throw — so an extra field accidentally added to the JSON
 * response surfaces in the test instead of leaking.
 *
 * Escape hatch: call `etc()` on a scope to opt out of the strict check.
 *
 * @example
 * res.assertJson(json =>
 *   json
 *     .has('user')
 *     .where('user.name', 'Suleiman')
 *     .has('items', 3, item =>
 *       item.where('id', 1).where('name', 'first').etc()
 *     )
 *     .etc()
 * )
 */
export class AssertableJson {
  private readonly _data: unknown
  private readonly _path: string
  private readonly _interacted = new Set<string>()
  private _etc = false

  constructor(data: unknown, path = '') {
    this._data = data
    this._path = path
  }

  // ─── Existence ──────────────────────────────────────────

  /**
   * Assert that `key` is present (and optionally that it points at an array
   * of `count` items, with `callback` applied to the FIRST item — Laravel
   * parity).
   *
   * Marks the top-level segment of `key` as interacted so strict-check passes
   * on this scope.
   */
  has(key: string): this
  has(key: string, count: number): this
  has(key: string, fn: (json: AssertableJson) => void): this
  has(key: string, count: number, fn: (json: AssertableJson) => void): this
  has(
    key: string,
    countOrFn?: number | ((json: AssertableJson) => void),
    maybeFn?: (json: AssertableJson) => void,
  ): this {
    this._markInteracted(key)
    const { exists, value } = this._getAtPath(key)
    assert.ok(exists, `Expected JSON to have key "${this._fullPath(key)}"`)

    let count: number | undefined
    let callback: ((j: AssertableJson) => void) | undefined
    if (typeof countOrFn === 'number') {
      count    = countOrFn
      callback = maybeFn
    } else if (typeof countOrFn === 'function') {
      callback = countOrFn
    }

    if (count !== undefined) {
      assert.ok(
        Array.isArray(value),
        `Expected "${this._fullPath(key)}" to be an array (got ${typeOfDsl(value)}) when checking count.`,
      )
      assert.equal(
        value.length,
        count,
        `Expected "${this._fullPath(key)}" to have ${count} items, got ${value.length}.`,
      )
    }

    if (callback) {
      // With a count: callback runs against the FIRST item (Laravel parity).
      // Without: callback runs against the value itself.
      const scope = count !== undefined && Array.isArray(value)
        ? (value as unknown[])[0]
        : value
      const scopedPath = count !== undefined && Array.isArray(value)
        ? `${this._fullPath(key)}[0]`
        : this._fullPath(key)
      const child = new AssertableJson(scope, scopedPath)
      callback(child)
      child._verifyInteracted()
    }

    return this
  }

  /** Assert that `key` is absent. */
  missing(key: string): this {
    this._markInteracted(key)
    const { exists } = this._getAtPath(key)
    assert.ok(!exists, `Expected JSON NOT to have key "${this._fullPath(key)}".`)
    return this
  }

  /** Assert that every listed key is absent. */
  missingAll(keys: string[]): this {
    for (const k of keys) this.missing(k)
    return this
  }

  // ─── Value ──────────────────────────────────────────────

  /** Assert that `key` deeply equals `expected`. */
  where(key: string, expected: unknown): this {
    this._markInteracted(key)
    const { value } = this._getAtPath(key)
    assert.deepStrictEqual(
      value,
      expected,
      `Expected "${this._fullPath(key)}" to deeply equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}.`,
    )
    return this
  }

  /** Assert that `key` does NOT deeply equal `expected`. */
  whereNot(key: string, expected: unknown): this {
    this._markInteracted(key)
    const { value } = this._getAtPath(key)
    assert.notDeepStrictEqual(
      value,
      expected,
      `Expected "${this._fullPath(key)}" NOT to deeply equal ${JSON.stringify(expected)}.`,
    )
    return this
  }

  /**
   * Assert that the value at `key` has the given type — one of
   * `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'`, `'null'`,
   * `'undefined'`. `'array'` and `'null'` are distinguished from `'object'`
   * (where typeof returns `'object'` for both).
   */
  whereType(key: string, type: string): this {
    this._markInteracted(key)
    const { value } = this._getAtPath(key)
    const actual = typeOfDsl(value)
    assert.equal(
      actual,
      type,
      `Expected "${this._fullPath(key)}" to be of type "${type}", got "${actual}".`,
    )
    return this
  }

  /**
   * Assert that an array at `key` contains `expected` (deep-equal), or that
   * a string at `key` contains `expected` (substring).
   */
  whereContains(key: string, expected: unknown): this {
    this._markInteracted(key)
    const { value } = this._getAtPath(key)
    if (Array.isArray(value)) {
      assert.ok(
        value.some((item) => deepEqual(item, expected)),
        `Expected array "${this._fullPath(key)}" to contain ${JSON.stringify(expected)}.`,
      )
    } else if (typeof value === 'string' && typeof expected === 'string') {
      assert.ok(
        value.includes(expected),
        `Expected string "${this._fullPath(key)}" to contain "${expected}".`,
      )
    } else {
      assert.fail(
        `Expected "${this._fullPath(key)}" to be an array or string to use whereContains, got ${typeOfDsl(value)}.`,
      )
    }
    return this
  }

  /** Assert that an array at `key` has the given length. */
  count(key: string, n: number): this {
    this._markInteracted(key)
    const { value } = this._getAtPath(key)
    assert.ok(
      Array.isArray(value),
      `Expected "${this._fullPath(key)}" to be an array (got ${typeOfDsl(value)}) when checking count.`,
    )
    assert.equal(
      value.length,
      n,
      `Expected "${this._fullPath(key)}" to have ${n} items, got ${value.length}.`,
    )
    return this
  }

  // ─── Array iteration ────────────────────────────────────

  /**
   * When the current scope's data IS an array, apply `fn` to the first item.
   * Throws on an empty array. Implicitly opts the array scope out of the
   * strict-key check (arrays don't have a meaningful "interacted keys" set).
   */
  first(fn: (json: AssertableJson) => void): this {
    assert.ok(
      Array.isArray(this._data),
      `first(...) can only be used when the current scope is an array (got ${typeOfDsl(this._data)}).`,
    )
    assert.ok(this._data.length > 0, `first(...) called on an empty array at "${this._path || '<root>'}".`)
    const child = new AssertableJson(this._data[0], `${this._path}[0]`)
    fn(child)
    child._verifyInteracted()
    this._etc = true
    return this
  }

  /**
   * When the current scope's data IS an array, apply `fn` to every item.
   * Each iteration runs in its own scope (so each item gets a strict-key
   * check). Implicitly opts the array scope out of the strict-key check.
   */
  each(fn: (json: AssertableJson) => void): this {
    assert.ok(
      Array.isArray(this._data),
      `each(...) can only be used when the current scope is an array (got ${typeOfDsl(this._data)}).`,
    )
    this._data.forEach((item, i) => {
      const child = new AssertableJson(item, `${this._path}[${i}]`)
      fn(child)
      child._verifyInteracted()
    })
    this._etc = true
    return this
  }

  // ─── Strictness ─────────────────────────────────────────

  /**
   * Opt this scope out of the strict-key check — extra keys not asserted on
   * via `has` / `where` / `missing` won't fail the assertion.
   */
  etc(): this {
    this._etc = true
    return this
  }

  /**
   * @internal — called by `TestResponse.assertJson(fn)` after the user's
   * callback completes, and recursively from `has(k, n, fn)` / `first` /
   * `each` after their nested scopes finish. Throws when this scope is an
   * object with keys not touched by any assertion (and `etc()` wasn't
   * called).
   */
  _verifyInteracted(): void {
    if (this._etc) return
    if (this._data === null || typeof this._data !== 'object' || Array.isArray(this._data)) {
      return
    }
    const allKeys   = Object.keys(this._data as Record<string, unknown>)
    const unchecked = allKeys.filter((k) => !this._interacted.has(k))
    if (unchecked.length === 0) return

    const where = this._path ? `at "${this._path}"` : 'at the root JSON scope'
    assert.fail(
      `Unexpected JSON keys ${where}: [${unchecked.join(', ')}]. ` +
      `Either assert on each key (via has / where / missing) or call .etc() to allow extras.`,
    )
  }

  // ─── Helpers ────────────────────────────────────────────

  private _markInteracted(key: string): void {
    // Dot-notation: where('user.name', ...) marks 'user' as interacted on the
    // CURRENT scope. We don't drill into nested scopes for the strict check —
    // that's the user's job via has(k, fn).
    const top = key.split('.')[0]!
    this._interacted.add(top)
  }

  private _fullPath(key: string): string {
    return this._path ? `${this._path}.${key}` : key
  }

  private _getAtPath(key: string): { exists: boolean; value: unknown } {
    const parts = key.split('.')
    let current: unknown = this._data
    for (const part of parts) {
      if (current === null || current === undefined) return { exists: false, value: undefined }
      if (typeof current !== 'object') return { exists: false, value: undefined }
      if (Array.isArray(current)) {
        const idx = Number(part)
        if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
          return { exists: false, value: undefined }
        }
        current = current[idx]
        continue
      }
      const obj = current as Record<string, unknown>
      if (!(part in obj)) return { exists: false, value: undefined }
      current = obj[part]
    }
    return { exists: true, value: current }
  }
}

// ─── module-level helpers ─────────────────────────────────

/**
 * Like `typeof`, but distinguishes `'array'` and `'null'` from `'object'`.
 * Matches the type strings consumers pass to `whereType`.
 */
function typeOfDsl(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function deepEqual(a: unknown, b: unknown): boolean {
  try { assert.deepStrictEqual(a, b); return true } catch { return false }
}
