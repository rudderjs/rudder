import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AssertableJson } from './AssertableJson.js'
import { TestResponse } from './TestResponse.js'

/**
 * Each helper runs `fn` against an `AssertableJson` rooted at `data` and then
 * verifies strict-key interaction — mirrors what `TestResponse.assertJson(fn)`
 * does at the call site. Centralising it keeps the per-method tests focused
 * on the assertion rather than the harness.
 */
function judge(data: unknown, fn: (j: AssertableJson) => void): void {
  const j = new AssertableJson(data)
  fn(j)
  ;(j as unknown as { _verifyInteracted(): void })._verifyInteracted()
}

// ─── has / missing ────────────────────────────────────────

describe('AssertableJson — has / missing', () => {
  it('has(key) passes when the key exists', () => {
    judge({ name: 'Alice' }, (j) => j.has('name'))
  })

  it('has(key) throws when the key is absent', () => {
    assert.throws(
      () => judge({ name: 'Alice' }, (j) => j.has('missing').etc()),
      /Expected JSON to have key "missing"/,
    )
  })

  it('has(key) walks dot-paths', () => {
    judge({ user: { name: 'Alice' } }, (j) => j.has('user.name').etc())
  })

  it('has(key, n) checks array length', () => {
    judge({ items: [1, 2, 3] }, (j) => j.has('items', 3))
  })

  it('has(key, n) throws when length differs', () => {
    assert.throws(
      () => judge({ items: [1, 2] }, (j) => j.has('items', 5)),
      /to have 5 items, got 2/,
    )
  })

  it('has(key, n, fn) applies fn to the first array item', () => {
    judge({ items: [{ id: 1, name: 'first' }, { id: 2, name: 'second' }] }, (j) =>
      j.has('items', 2, (item) => item.has('id').where('name', 'first')),
    )
  })

  it('has(key, fn) scopes fn to the value (no count check)', () => {
    judge({ user: { id: 1, name: 'Alice' } }, (j) =>
      j.has('user', (user) => user.has('id').where('name', 'Alice')),
    )
  })

  it('missing(key) passes when absent', () => {
    judge({ name: 'Alice' }, (j) => j.has('name').missing('email'))
  })

  it('missing(key) throws when present', () => {
    assert.throws(
      () => judge({ password: 'x' }, (j) => j.missing('password')),
      /Expected JSON NOT to have key "password"/,
    )
  })

  it('missingAll(keys) walks every key', () => {
    judge({ name: 'A' }, (j) => j.has('name').missingAll(['password', 'token', 'secret']))
  })
})

// ─── where / whereNot ─────────────────────────────────────

describe('AssertableJson — where / whereNot', () => {
  it('where(key, value) passes on deep-equal', () => {
    judge({ name: 'Alice', age: 30 }, (j) => j.where('name', 'Alice').where('age', 30))
  })

  it('where(key, value) on dot-path', () => {
    judge({ user: { name: 'Alice' } }, (j) => j.where('user.name', 'Alice'))
  })

  it('where(key, value) throws on mismatch', () => {
    assert.throws(
      () => judge({ name: 'Alice' }, (j) => j.where('name', 'Bob')),
      /to deeply equal "Bob"/,
    )
  })

  it('whereNot(key, value) passes when value differs', () => {
    judge({ status: 'active' }, (j) => j.whereNot('status', 'deleted'))
  })

  it('whereNot(key, value) throws on match', () => {
    assert.throws(
      () => judge({ status: 'active' }, (j) => j.whereNot('status', 'active')),
      /NOT to deeply equal "active"/,
    )
  })
})

// ─── whereType ────────────────────────────────────────────

describe('AssertableJson — whereType', () => {
  it('passes for matching primitive type', () => {
    judge({ id: 42, name: 'A' }, (j) =>
      j.whereType('id', 'number').whereType('name', 'string'),
    )
  })

  it('distinguishes array, null, and object', () => {
    judge({ tags: [1, 2], parent: null, meta: { a: 1 } }, (j) =>
      j.whereType('tags', 'array').whereType('parent', 'null').whereType('meta', 'object'),
    )
  })

  it('throws on type mismatch', () => {
    assert.throws(
      () => judge({ id: '42' }, (j) => j.whereType('id', 'number')),
      /to be of type "number", got "string"/,
    )
  })
})

// ─── whereContains / count ────────────────────────────────

describe('AssertableJson — whereContains', () => {
  it('matches an array element by deep-equal', () => {
    judge({ tags: ['admin', 'user'] }, (j) => j.whereContains('tags', 'admin'))
  })

  it('matches a substring inside a string value', () => {
    judge({ message: 'Welcome, Suleiman!' }, (j) => j.whereContains('message', 'Suleiman'))
  })

  it('throws when the value is neither array nor string', () => {
    assert.throws(
      () => judge({ x: 42 }, (j) => j.whereContains('x', 'whatever')),
      /to be an array or string/,
    )
  })
})

describe('AssertableJson — count', () => {
  it('passes when the array has the expected length', () => {
    judge({ items: [1, 2] }, (j) => j.count('items', 2))
  })

  it('throws when the value is not an array', () => {
    assert.throws(
      () => judge({ items: { a: 1 } }, (j) => j.count('items', 1)),
      /to be an array \(got object\)/,
    )
  })

  it('throws when the length differs', () => {
    assert.throws(
      () => judge({ items: [1, 2, 3] }, (j) => j.count('items', 5)),
      /to have 5 items, got 3/,
    )
  })
})

// ─── first / each ─────────────────────────────────────────

describe('AssertableJson — first / each', () => {
  it('first(fn) applies fn to the first element of an array scope', () => {
    judge({ items: [{ id: 1 }, { id: 2 }] }, (j) =>
      j.has('items', (items) => items.first((first) => first.where('id', 1))),
    )
  })

  it('first(fn) throws when the array is empty', () => {
    assert.throws(
      () => judge({ items: [] }, (j) =>
        j.has('items', (items) => items.first(() => {})),
      ),
      /first\(\.\.\.\) called on an empty array/,
    )
  })

  it('first(fn) throws when called outside an array scope', () => {
    assert.throws(
      () => judge({ user: { name: 'Alice' } }, (j) =>
        j.has('user', (user) => user.first(() => {})),
      ),
      /can only be used when the current scope is an array/,
    )
  })

  it('each(fn) iterates every element with its own strict scope', () => {
    judge({ items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }, (j) =>
      j.has('items', (items) =>
        items.each((item) => item.has('id').has('name')),
      ),
    )
  })

  it('each(fn) surfaces strict-key errors per item', () => {
    assert.throws(
      () => judge({ items: [{ id: 1, name: 'a' }] }, (j) =>
        j.has('items', (items) => items.each((item) => item.has('id'))),
      ),
      /Unexpected JSON keys at "items\[0\]": \[name\]/,
    )
  })
})

// ─── Strict-by-default + etc() ────────────────────────────

describe('AssertableJson — strict-by-default', () => {
  it('throws when a top-level key is unchecked', () => {
    assert.throws(
      () => judge({ name: 'Alice', leaked: 'oops' }, (j) => j.has('name')),
      /Unexpected JSON keys at the root JSON scope: \[leaked\]/,
    )
  })

  it('etc() at root opts out of the strict check', () => {
    judge({ name: 'Alice', extra1: 1, extra2: 2 }, (j) => j.has('name').etc())
  })

  it('strict check fires on nested scopes too', () => {
    assert.throws(
      () => judge({ user: { name: 'Alice', leak: 'oops' } }, (j) =>
        j.has('user', (user) => user.has('name')),
      ),
      /Unexpected JSON keys at "user": \[leak\]/,
    )
  })

  it('etc() inside a nested scope works independently', () => {
    judge({ user: { name: 'Alice', extra: 1 }, count: 5 }, (j) =>
      j.has('user', (user) => user.has('name').etc()).has('count'),
    )
  })

  it('dot-path interactions mark only the top-level key', () => {
    // where('user.name', ...) marks 'user' as interacted; the nested 'user'
    // object is NOT strict-checked because we never opened a scope on it.
    judge({ user: { name: 'Alice', extra: 'whatever' } }, (j) =>
      j.where('user.name', 'Alice'),
    )
  })

  it('missing() counts as interacting with the (top) key', () => {
    judge({ name: 'Alice' }, (j) => j.has('name').missing('extra'))
  })

  it('arrays are not strict-checked at the scope level', () => {
    // Verifying first() / each() don't trigger a strict-key check on the
    // array itself (arrays have no keys to enumerate).
    judge({ items: [{ id: 1 }, { id: 2 }] }, (j) =>
      j.has('items', (items) => items.first((it) => it.has('id'))),
    )
  })
})

// ─── TestResponse.assertJson overload ─────────────────────

describe('TestResponse.assertJson — fluent overload', () => {
  it('subset-match form keeps existing behavior', () => {
    const body = { name: 'Alice', age: 30, tags: ['admin'] }
    const res = new TestResponse(200, {}, body, JSON.stringify(body))
    res.assertJson({ name: 'Alice' })
  })

  it('callback form drives AssertableJson against this.body', () => {
    const body = { name: 'Alice', age: 30 }
    const res = new TestResponse(200, {}, body, '')
    res.assertJson((j) => j.has('name').where('age', 30))
  })

  it('callback form enforces strict-by-default at the root', () => {
    const body = { name: 'Alice', leaked: 'oops' }
    const res = new TestResponse(200, {}, body, '')
    assert.throws(
      () => res.assertJson((j) => j.has('name')),
      /Unexpected JSON keys at the root JSON scope: \[leaked\]/,
    )
  })

  it('callback form returns the TestResponse for chaining', () => {
    const body = { ok: true }
    const res = new TestResponse(200, {}, body, '')
    const result = res.assertJson((j) => j.where('ok', true))
    assert.strictEqual(result, res)
  })
})
