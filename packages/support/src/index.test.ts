import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Collection,
  Env,
  env,
  defineEnv,
  sleep,
  ucfirst,
  toSnakeCase,
  toCamelCase,
  isObject,
  deepClone,
  tap,
  pick,
  omit,
  dump,
  ConfigRepository,
  config,
  setConfigRepository,
} from './index.js'
import { z } from 'zod'

// ─── Collection ────────────────────────────────────────────

describe('Collection', () => {
  it('constructor makes a defensive copy', () => {
    const src = [1, 2, 3]
    const col = new Collection(src)
    src.push(4)
    assert.strictEqual(col.count(), 3)
  })

  it('of() is a static factory', () => {
    const col = Collection.of([10, 20])
    assert.ok(col instanceof Collection)
    assert.deepStrictEqual(col.toArray(), [10, 20])
  })

  it('all() returns the internal array', () => {
    const col = new Collection([1, 2])
    assert.deepStrictEqual(col.all(), [1, 2])
  })

  it('count() returns the number of items', () => {
    assert.strictEqual(new Collection([]).count(), 0)
    assert.strictEqual(new Collection([1, 2, 3]).count(), 3)
  })

  it('first() / last() return undefined on empty collection', () => {
    const col = new Collection<number>([])
    assert.strictEqual(col.first(), undefined)
    assert.strictEqual(col.last(), undefined)
  })

  it('first() / last() return correct items', () => {
    const col = new Collection([10, 20, 30])
    assert.strictEqual(col.first(), 10)
    assert.strictEqual(col.last(), 30)
  })

  it('map() transforms items into a new Collection', () => {
    const col = new Collection([1, 2, 3]).map(n => n * 2)
    assert.deepStrictEqual(col.toArray(), [2, 4, 6])
  })

  it('filter() keeps matching items', () => {
    const col = new Collection([1, 2, 3, 4]).filter(n => n % 2 === 0)
    assert.deepStrictEqual(col.toArray(), [2, 4])
  })

  it('find() returns the first matching item or undefined', () => {
    const col = new Collection([1, 2, 3])
    assert.strictEqual(col.find(n => n > 1), 2)
    assert.strictEqual(col.find(n => n > 10), undefined)
  })

  it('each() iterates and returns this for chaining', () => {
    const seen: number[] = []
    const col = new Collection([1, 2])
    const returned = col.each(n => seen.push(n))
    assert.deepStrictEqual(seen, [1, 2])
    assert.strictEqual(returned, col)
  })

  it('pluck() extracts a property from object items', () => {
    const col = new Collection([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
    assert.deepStrictEqual(col.pluck('id').toArray(), [1, 2])
  })

  it('groupBy() groups by a key', () => {
    const col = new Collection([
      { role: 'admin', name: 'Alice' },
      { role: 'user',  name: 'Bob' },
      { role: 'admin', name: 'Carol' },
    ])
    const groups = col.groupBy('role')
    assert.strictEqual(groups['admin']?.length, 2)
    assert.strictEqual(groups['user']?.length, 1)
  })

  it('contains() returns true when predicate matches', () => {
    const col = new Collection([1, 2, 3])
    assert.ok(col.contains(n => n === 2))
    assert.ok(!col.contains(n => n === 99))
  })

  it('isEmpty() returns true only for empty collections', () => {
    assert.ok(new Collection([]).isEmpty())
    assert.ok(!new Collection([1]).isEmpty())
  })

  it('toArray() returns a new copy of the items', () => {
    const col = new Collection([1, 2])
    const arr = col.toArray()
    arr.push(3)
    assert.strictEqual(col.count(), 2)
  })

  it('toJSON() returns T[] so JSON.stringify works correctly', () => {
    const col = new Collection([1, 2, 3])
    const json = JSON.stringify(col)
    assert.strictEqual(json, '[1,2,3]')
  })

  it('toJSON() does not double-encode', () => {
    const col = new Collection([{ a: 1 }])
    const parsed = JSON.parse(JSON.stringify(col))
    assert.deepStrictEqual(parsed, [{ a: 1 }])
  })
})

// ─── Env ───────────────────────────────────────────────────

describe('Env', () => {
  const KEY = 'RUDDERJS_TEST_SUPPORT'

  beforeEach(() => { delete process.env[KEY] })
  afterEach(()  => { delete process.env[KEY] })

  it('get() returns the env var value', () => {
    process.env[KEY] = 'hello'
    assert.strictEqual(Env.get(KEY), 'hello')
  })

  it('get() returns fallback when var is missing', () => {
    assert.strictEqual(Env.get(KEY, 'fallback'), 'fallback')
  })

  it('get() throws when var is missing and no fallback', () => {
    assert.throws(() => Env.get(KEY), /Missing environment variable/)
  })

  it('has() returns true when var is set', () => {
    process.env[KEY] = 'x'
    assert.ok(Env.has(KEY))
  })

  it('has() returns false when var is missing', () => {
    assert.ok(!Env.has(KEY))
  })

  it('getBool() true for "true"', () => {
    process.env[KEY] = 'true'
    assert.strictEqual(Env.getBool(KEY), true)
  })

  it('getBool() true for "TRUE" (case-insensitive)', () => {
    process.env[KEY] = 'TRUE'
    assert.strictEqual(Env.getBool(KEY), true)
  })

  it('getBool() true for "1"', () => {
    process.env[KEY] = '1'
    assert.strictEqual(Env.getBool(KEY), true)
  })

  it('getBool() false for "false"', () => {
    process.env[KEY] = 'false'
    assert.strictEqual(Env.getBool(KEY), false)
  })

  it('getBool() false for "0"', () => {
    process.env[KEY] = '0'
    assert.strictEqual(Env.getBool(KEY), false)
  })

  it('getBool() returns fallback when var is missing', () => {
    assert.strictEqual(Env.getBool(KEY, false), false)
    assert.strictEqual(Env.getBool(KEY, true),  true)
  })

  it('getBool() throws when var is missing and no fallback', () => {
    assert.throws(() => Env.getBool(KEY), /Missing environment variable/)
  })

  it('getNumber() parses an integer', () => {
    process.env[KEY] = '42'
    assert.strictEqual(Env.getNumber(KEY), 42)
  })

  it('getNumber() parses a float', () => {
    process.env[KEY] = '3.14'
    assert.ok(Math.abs(Env.getNumber(KEY) - 3.14) < 0.001)
  })

  it('getNumber() throws on non-numeric value', () => {
    process.env[KEY] = 'abc'
    assert.throws(() => Env.getNumber(KEY), /not a number/)
  })

  it('getNumber() returns fallback when var is missing', () => {
    assert.strictEqual(Env.getNumber(KEY, 7), 7)
  })

  it('getNumber() throws when var is missing and no fallback', () => {
    assert.throws(() => Env.getNumber(KEY), /Missing environment variable/)
  })
})

// ─── env() helper ──────────────────────────────────────────

describe('env()', () => {
  const KEY = 'RUDDERJS_TEST_ENV_HELPER'

  beforeEach(() => { delete process.env[KEY] })
  afterEach(()  => { delete process.env[KEY] })

  it('returns the env var value', () => {
    process.env[KEY] = 'value'
    assert.strictEqual(env(KEY), 'value')
  })

  it('returns the fallback when missing', () => {
    assert.strictEqual(env(KEY, 'default'), 'default')
  })

  it('throws when missing and no fallback', () => {
    assert.throws(() => env(KEY), /Missing environment variable/)
  })
})

// ─── ConfigRepository ──────────────────────────────────────

describe('ConfigRepository', () => {
  it('get() returns top-level value', () => {
    const repo = new ConfigRepository({ app: { name: 'RudderJS' } })
    assert.deepStrictEqual(repo.get('app'), { name: 'RudderJS' })
  })

  it('get() returns nested value with dot notation', () => {
    const repo = new ConfigRepository({ app: { name: 'RudderJS' } })
    assert.strictEqual(repo.get('app.name'), 'RudderJS')
  })

  it('get() returns fallback for missing key', () => {
    const repo = new ConfigRepository({})
    assert.strictEqual(repo.get('missing', 'default'), 'default')
  })

  it('get() returns undefined (not fallback) for value 0', () => {
    const repo = new ConfigRepository({ port: 0 })
    assert.strictEqual(repo.get('port', 3000), 0)
  })

  it('get() returns undefined (not fallback) for value false', () => {
    const repo = new ConfigRepository({ debug: false })
    assert.strictEqual(repo.get('debug', true), false)
  })

  it('get() returns undefined (not fallback) for empty string', () => {
    const repo = new ConfigRepository({ name: '' })
    assert.strictEqual(repo.get('name', 'fallback'), '')
  })

  it('get() returns undefined (not fallback) for null', () => {
    const repo = new ConfigRepository({ val: null })
    assert.strictEqual(repo.get('val', 'fallback'), null)
  })

  it('has() returns true for existing key', () => {
    const repo = new ConfigRepository({ a: 1 })
    assert.ok(repo.has('a'))
  })

  it('has() returns false for missing key', () => {
    const repo = new ConfigRepository({})
    assert.ok(!repo.has('missing'))
  })

  it('all() returns the entire data object', () => {
    const data = { a: 1, b: { c: 2 } }
    const repo = new ConfigRepository(data)
    assert.deepStrictEqual(repo.all(), data)
  })

  it('set() creates a new top-level key', () => {
    const repo = new ConfigRepository({})
    repo.set('key', 'value')
    assert.strictEqual(repo.get('key'), 'value')
  })

  it('set() creates nested keys with dot notation', () => {
    const repo = new ConfigRepository({})
    repo.set('app.name', 'Test')
    assert.strictEqual(repo.get('app.name'), 'Test')
  })

  it('set() overwrites an existing value', () => {
    const repo = new ConfigRepository({ x: 1 })
    repo.set('x', 99)
    assert.strictEqual(repo.get('x'), 99)
  })

  it('set() silently ignores __proto__ key', () => {
    const repo = new ConfigRepository({})
    repo.set('__proto__.polluted', true)
    assert.strictEqual(({} as Record<string, unknown>)['polluted'], undefined)
  })

  it('set() silently ignores constructor key', () => {
    const repo = new ConfigRepository({})
    assert.doesNotThrow(() => repo.set('constructor.polluted', true))
  })
})

// ─── config() helper ───────────────────────────────────────

describe('config()', () => {
  it('reads from the registered ConfigRepository', () => {
    const repo = new ConfigRepository({ db: { host: 'localhost' } })
    setConfigRepository(repo)
    assert.strictEqual(config('db.host'), 'localhost')
  })

  it('returns fallback when key is missing', () => {
    const repo = new ConfigRepository({})
    setConfigRepository(repo)
    assert.strictEqual(config('missing', 'default'), 'default')
  })
})

// ─── Helpers ───────────────────────────────────────────────

describe('ucfirst()', () => {
  it('uppercases the first letter', () => {
    assert.strictEqual(ucfirst('hello'), 'Hello')
  })

  it('leaves an already-uppercase string unchanged', () => {
    assert.strictEqual(ucfirst('Hello'), 'Hello')
  })

  it('handles empty string', () => {
    assert.strictEqual(ucfirst(''), '')
  })
})

describe('toSnakeCase()', () => {
  it('converts camelCase to snake_case', () => {
    assert.strictEqual(toSnakeCase('myVariableName'), 'my_variable_name')
  })

  it('handles already-lowercase string', () => {
    assert.strictEqual(toSnakeCase('foo'), 'foo')
  })

  it('does not add leading underscore', () => {
    assert.strictEqual(toSnakeCase('MyClass'), 'my_class')
  })
})

describe('toCamelCase()', () => {
  it('converts snake_case to camelCase', () => {
    assert.strictEqual(toCamelCase('my_variable_name'), 'myVariableName')
  })

  it('handles already-camelCase string', () => {
    assert.strictEqual(toCamelCase('foo'), 'foo')
  })
})

describe('isObject()', () => {
  it('returns true for plain objects', () => {
    assert.ok(isObject({ a: 1 }))
    assert.ok(isObject({}))
  })

  it('returns false for null', () => {
    assert.ok(!isObject(null))
  })

  it('returns false for arrays', () => {
    assert.ok(!isObject([]))
  })

  it('returns false for primitives', () => {
    assert.ok(!isObject(42))
    assert.ok(!isObject('string'))
    assert.ok(!isObject(true))
  })

  it('returns false for Date', () => {
    assert.ok(!isObject(new Date()))
  })
})

describe('deepClone()', () => {
  it('returns an equal but distinct object', () => {
    const obj = { a: 1, b: { c: 2 } }
    const clone = deepClone(obj)
    assert.deepStrictEqual(clone, obj)
    assert.notStrictEqual(clone, obj)
    assert.notStrictEqual(clone.b, obj.b)
  })

  it('handles arrays', () => {
    const arr = [1, [2, 3]]
    const clone = deepClone(arr)
    assert.deepStrictEqual(clone, arr)
    assert.notStrictEqual(clone, arr)
  })
})

describe('tap()', () => {
  it('passes the value to the callback and returns the value', () => {
    let seen: number | undefined
    const result = tap(42, v => { seen = v })
    assert.strictEqual(result, 42)
    assert.strictEqual(seen, 42)
  })

  it('works with objects (returns same reference)', () => {
    const obj = { x: 1 }
    const result = tap(obj, v => v.x++)
    assert.strictEqual(result, obj)
    assert.strictEqual(obj.x, 2)
  })
})

describe('pick()', () => {
  it('returns only the specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 }
    assert.deepStrictEqual(pick(obj, ['a', 'c']), { a: 1, c: 3 })
  })

  it('returns empty object for empty keys array', () => {
    assert.deepStrictEqual(pick({ a: 1 }, []), {})
  })
})

describe('omit()', () => {
  it('returns the object without the specified keys', () => {
    const obj = { a: 1, b: 2, c: 3 }
    assert.deepStrictEqual(omit(obj, ['b']), { a: 1, c: 3 })
  })

  it('returns full object when keys array is empty', () => {
    const obj = { a: 1, b: 2 }
    assert.deepStrictEqual(omit(obj, []), { a: 1, b: 2 })
  })
})

describe('dump()', () => {
  it('does not throw', () => {
    const original = console.log
    const logged: string[] = []
    console.log = (...args: unknown[]) => logged.push(args.join(''))
    try {
      dump({ a: 1 }, [1, 2])
      assert.strictEqual(logged.length, 2)
    } finally {
      console.log = original
    }
  })
})

describe('sleep()', () => {
  it('resolves after at least the specified delay', async () => {
    const start = Date.now()
    await sleep(20)
    assert.ok(Date.now() - start >= 15)
  })
})

// ─── defineEnv ─────────────────────────────────────────────

describe('defineEnv()', () => {
  const KEY1 = 'RUDDERJS_DEFINE_ENV_NAME'
  const KEY2 = 'RUDDERJS_DEFINE_ENV_PORT'

  beforeEach(() => {
    delete process.env[KEY1]
    delete process.env[KEY2]
  })
  afterEach(() => {
    delete process.env[KEY1]
    delete process.env[KEY2]
  })

  it('returns parsed values for a valid schema', () => {
    process.env[KEY1] = 'myapp'
    process.env[KEY2] = '3000'
    const parsed = defineEnv(z.object({
      [KEY1]: z.string().min(1),
      [KEY2]: z.coerce.number().int(),
    }))
    assert.strictEqual(parsed[KEY1], 'myapp')
    assert.strictEqual(parsed[KEY2], 3000)
  })

  it('throws with a descriptive message on invalid input', () => {
    process.env[KEY2] = 'not-a-number'
    assert.throws(
      () => defineEnv(z.object({ [KEY2]: z.coerce.number().int() })),
      /Invalid environment configuration/
    )
  })

  it('throws when a required var is missing', () => {
    assert.throws(
      () => defineEnv(z.object({ [KEY1]: z.string() })),
      /Invalid environment configuration/
    )
  })
})
