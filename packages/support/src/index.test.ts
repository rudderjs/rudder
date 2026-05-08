import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Collection,
  Env,
  env,
  defineEnv,
  isWebContainer,
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
  Str,
  Num,
  t,
  validateSerializable,
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

  // ── methods added for coverage ───────────────────────────

  it('isNotEmpty() returns true for non-empty, false for empty', () => {
    assert.ok(new Collection([1]).isNotEmpty())
    assert.ok(!new Collection([]).isNotEmpty())
  })

  it('first(fn) returns the first item matching the predicate', () => {
    const col = new Collection([1, 2, 3, 4])
    assert.strictEqual(col.first(n => n > 2), 3)
    assert.strictEqual(col.first(n => n > 99), undefined)
  })

  it('last(fn) returns the last item matching the predicate', () => {
    const col = new Collection([1, 2, 3, 4])
    assert.strictEqual(col.last(n => n < 3), 2)
    assert.strictEqual(col.last(n => n > 99), undefined)
  })

  it('contains(value) returns true when value is in the collection', () => {
    const col = new Collection([1, 2, 3])
    assert.ok(col.contains(2))
    assert.ok(!col.contains(99))
  })

  it('flatMap() flattens one level and returns a new Collection', () => {
    const col = new Collection([1, 2, 3]).flatMap(n => [n, n * 10])
    assert.deepStrictEqual(col.toArray(), [1, 10, 2, 20, 3, 30])
  })

  it('reject() keeps items that do NOT match the predicate', () => {
    const col = new Collection([1, 2, 3, 4]).reject(n => n % 2 === 0)
    assert.deepStrictEqual(col.toArray(), [1, 3])
  })

  it('sole() returns the single matching item', () => {
    const col = new Collection([1, 2, 3])
    assert.strictEqual(col.sole(n => n === 2), 2)
  })

  it('sole() throws when no item matches', () => {
    const col = new Collection([1, 2, 3])
    assert.throws(() => col.sole(n => n === 99), /sole\(\) found no matching items/)
  })

  it('sole() throws when more than one item matches', () => {
    const col = new Collection([1, 2, 3])
    assert.throws(() => col.sole(n => n > 1), /sole\(\) found 2 items/)
  })

  it('keyBy() indexes items by key (last write wins on collision)', () => {
    const col = new Collection([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
    const map = col.keyBy('id')
    assert.deepStrictEqual(Object.keys(map), ['1', '2'])
    assert.strictEqual(map['1']?.name, 'Alice')
  })

  it('keyBy() accepts a function resolver', () => {
    const col = new Collection([{ code: 'A' }, { code: 'B' }])
    const map = col.keyBy(item => item.code.toLowerCase())
    assert.ok('a' in map)
    assert.ok('b' in map)
  })

  it('mapWithKeys() produces a Record from [key, value] pairs', () => {
    const col = new Collection([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
    const map = col.mapWithKeys(item => [String(item.id), item.name])
    assert.deepStrictEqual(map, { '1': 'Alice', '2': 'Bob' })
  })

  it('chunk() splits into chunks of the given size', () => {
    const chunks = new Collection([1, 2, 3, 4, 5]).chunk(2)
    assert.deepStrictEqual(chunks.toArray(), [[1, 2], [3, 4], [5]])
  })

  it('chunk() throws when size is less than 1', () => {
    assert.throws(() => new Collection([1]).chunk(0), /size must be >= 1/)
  })

  it('splitIn() splits into roughly equal groups', () => {
    const groups = new Collection([1, 2, 3, 4, 5]).splitIn(2)
    assert.strictEqual(groups.count(), 2)
    assert.deepStrictEqual(groups.toArray()[0], [1, 2, 3])
    assert.deepStrictEqual(groups.toArray()[1], [4, 5])
  })

  it('partition() splits into [passing, failing]', () => {
    const [evens, odds] = new Collection([1, 2, 3, 4]).partition(n => n % 2 === 0)
    assert.deepStrictEqual(evens.toArray(), [2, 4])
    assert.deepStrictEqual(odds.toArray(), [1, 3])
  })

  it('sliding() produces overlapping windows', () => {
    const windows = new Collection([1, 2, 3, 4]).sliding(2)
    assert.deepStrictEqual(windows.toArray(), [[1, 2], [2, 3], [3, 4]])
  })

  it('sliding() respects the step parameter', () => {
    const windows = new Collection([1, 2, 3, 4]).sliding(2, 2)
    assert.deepStrictEqual(windows.toArray(), [[1, 2], [3, 4]])
  })

  it('zip() pairs items with another array (shortest wins)', () => {
    const zipped = new Collection([1, 2, 3]).zip(['a', 'b'])
    assert.deepStrictEqual(zipped.toArray(), [[1, 'a'], [2, 'b']])
  })

  it('zip() accepts a Collection as input', () => {
    const zipped = new Collection([1, 2]).zip(new Collection(['x', 'y']))
    assert.deepStrictEqual(zipped.toArray(), [[1, 'x'], [2, 'y']])
  })

  it('crossJoin() returns the cartesian product', () => {
    const product = new Collection([1, 2]).crossJoin(['a', 'b'])
    assert.deepStrictEqual(product.toArray(), [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']])
  })

  it('combine() zips keys and values into a Record', () => {
    const record = new Collection(['name', 'age']).combine(['Alice', 30])
    assert.deepStrictEqual(record, { name: 'Alice', age: 30 })
  })

  it('mapSpread() spreads tuple items as arguments', () => {
    const col = new Collection<[number, string]>([[1, 'a'], [2, 'b']])
    const result = col.mapSpread((n, s) => `${String(n)}-${String(s)}`)
    assert.deepStrictEqual(result.toArray(), ['1-a', '2-b'])
  })

  it('when(true) applies the callback', () => {
    const col = new Collection([1, 2, 3]).when(true, c => c.filter(n => n > 1))
    assert.deepStrictEqual(col.toArray(), [2, 3])
  })

  it('when(false) skips the callback and returns this', () => {
    const original = new Collection([1, 2, 3])
    const result = original.when(false, c => c.filter(n => n > 1))
    assert.deepStrictEqual(result.toArray(), [1, 2, 3])
  })

  it('when(false) calls the otherwise branch when provided', () => {
    const col = new Collection([1, 2, 3]).when(false, c => c, c => c.filter(n => n > 2))
    assert.deepStrictEqual(col.toArray(), [3])
  })

  it('when() accepts a function condition', () => {
    const col = new Collection([1, 2, 3]).when(c => c.count() > 2, c => c.filter(n => n > 1))
    assert.deepStrictEqual(col.toArray(), [2, 3])
  })

  it('unless(true) skips the callback', () => {
    const col = new Collection([1, 2, 3]).unless(true, c => c.filter(n => n > 1))
    assert.deepStrictEqual(col.toArray(), [1, 2, 3])
  })

  it('unless(false) applies the callback', () => {
    const col = new Collection([1, 2, 3]).unless(false, c => c.filter(n => n > 1))
    assert.deepStrictEqual(col.toArray(), [2, 3])
  })

  it('pipe() passes the collection to a function and returns the result', () => {
    const count = new Collection([1, 2, 3]).pipe(c => c.count())
    assert.strictEqual(count, 3)
  })

  it('tap() calls side-effect and returns this', () => {
    let seen = 0
    const col = new Collection([1, 2, 3])
    const returned = col.tap(c => { seen = c.count() })
    assert.strictEqual(seen, 3)
    assert.strictEqual(returned, col)
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

// ─── isWebContainer ────────────────────────────────────────

describe('isWebContainer', () => {
  let original: string | undefined

  beforeEach(() => {
    original = (process.versions as Record<string, string | undefined>).webcontainer
  })

  afterEach(() => {
    if (original === undefined) {
      delete (process.versions as Record<string, string | undefined>).webcontainer
    } else {
      ;(process.versions as Record<string, string | undefined>).webcontainer = original
    }
  })

  it('returns false in a normal Node process', () => {
    delete (process.versions as Record<string, string | undefined>).webcontainer
    assert.strictEqual(isWebContainer(), false)
  })

  it('returns true when process.versions.webcontainer is set', () => {
    ;(process.versions as Record<string, string | undefined>).webcontainer = '1.0.0'
    assert.strictEqual(isWebContainer(), true)
  })
})

// ─── Str ───────────────────────────────────────────────────

describe('Str.camel()', () => {
  it('converts snake_case to camelCase', () => {
    assert.strictEqual(Str.camel('hello_world'), 'helloWorld')
  })
  it('converts kebab-case to camelCase', () => {
    assert.strictEqual(Str.camel('hello-world'), 'helloWorld')
  })
  it('lowercases the first letter', () => {
    assert.strictEqual(Str.camel('HelloWorld'), 'helloWorld')
  })
  it('handles single word', () => {
    assert.strictEqual(Str.camel('hello'), 'hello')
  })
})

describe('Str.snake()', () => {
  it('converts camelCase to snake_case', () => {
    assert.strictEqual(Str.snake('helloWorld'), 'hello_world')
  })
  it('converts StudlyCase to snake_case', () => {
    assert.strictEqual(Str.snake('HelloWorld'), 'hello_world')
  })
  it('handles consecutive uppercase (acronyms)', () => {
    assert.strictEqual(Str.snake('parseHTMLString'), 'parse_html_string')
  })
  it('handles already snake_case', () => {
    assert.strictEqual(Str.snake('hello_world'), 'hello_world')
  })
})

describe('Str.kebab()', () => {
  it('converts camelCase to kebab-case', () => {
    assert.strictEqual(Str.kebab('helloWorld'), 'hello-world')
  })
  it('converts snake_case to kebab-case', () => {
    assert.strictEqual(Str.kebab('hello_world'), 'hello-world')
  })
})

describe('Str.studly()', () => {
  it('converts snake_case to StudlyCase', () => {
    assert.strictEqual(Str.studly('hello_world'), 'HelloWorld')
  })
  it('converts kebab-case to StudlyCase', () => {
    assert.strictEqual(Str.studly('hello-world'), 'HelloWorld')
  })
  it('uppercases the first letter', () => {
    assert.strictEqual(Str.studly('hello'), 'Hello')
  })
})

describe('Str.title()', () => {
  it('capitalises each word', () => {
    assert.strictEqual(Str.title('hello world'), 'Hello World')
  })
  it('handles single word', () => {
    assert.strictEqual(Str.title('hello'), 'Hello')
  })
})

describe('Str.headline()', () => {
  it('converts snake_case to headline', () => {
    assert.strictEqual(Str.headline('user_profile'), 'User Profile')
  })
  it('converts camelCase to headline', () => {
    assert.strictEqual(Str.headline('userProfile'), 'User Profile')
  })
  it('converts kebab-case to headline', () => {
    assert.strictEqual(Str.headline('user-profile'), 'User Profile')
  })
})

describe('Str.limit()', () => {
  it('returns full string if shorter than limit', () => {
    assert.strictEqual(Str.limit('hello', 10), 'hello')
  })
  it('truncates and appends ellipsis', () => {
    assert.strictEqual(Str.limit('hello world', 5), 'hello...')
  })
  it('uses custom end', () => {
    assert.strictEqual(Str.limit('hello world', 5, '!'), 'hello!')
  })
})

describe('Str.words()', () => {
  it('returns full string when within word limit', () => {
    assert.strictEqual(Str.words('one two three', 5), 'one two three')
  })
  it('truncates to word count and appends ellipsis', () => {
    assert.strictEqual(Str.words('one two three four', 2), 'one two...')
  })
  it('uses custom end', () => {
    assert.strictEqual(Str.words('one two three', 2, ' →'), 'one two →')
  })
})

describe('Str.excerpt()', () => {
  it('returns excerpt centered on the phrase', () => {
    const result = Str.excerpt('The quick brown fox', 'quick', { radius: 3 })
    assert.ok(result.includes('quick'))
  })
  it('returns start of string when phrase not found', () => {
    const result = Str.excerpt('Hello world', 'missing', { radius: 5 })
    assert.ok(result.startsWith('Hello'))
  })
})

describe('Str.contains()', () => {
  it('returns true when needle is found', () => {
    assert.ok(Str.contains('hello world', 'world'))
  })
  it('returns false when needle is not found', () => {
    assert.ok(!Str.contains('hello world', 'foo'))
  })
  it('accepts an array of needles (any match)', () => {
    assert.ok(Str.contains('hello world', ['foo', 'world']))
    assert.ok(!Str.contains('hello world', ['foo', 'bar']))
  })
})

describe('Str.containsAll()', () => {
  it('returns true when all needles are found', () => {
    assert.ok(Str.containsAll('hello world foo', ['hello', 'world']))
  })
  it('returns false when any needle is missing', () => {
    assert.ok(!Str.containsAll('hello world', ['hello', 'missing']))
  })
})

describe('Str.startsWith()', () => {
  it('returns true when string starts with needle', () => {
    assert.ok(Str.startsWith('hello world', 'hello'))
  })
  it('returns false when string does not start with needle', () => {
    assert.ok(!Str.startsWith('hello world', 'world'))
  })
  it('accepts an array of needles', () => {
    assert.ok(Str.startsWith('hello world', ['foo', 'hello']))
  })
})

describe('Str.endsWith()', () => {
  it('returns true when string ends with needle', () => {
    assert.ok(Str.endsWith('hello world', 'world'))
  })
  it('returns false when string does not end with needle', () => {
    assert.ok(!Str.endsWith('hello world', 'hello'))
  })
  it('accepts an array of needles', () => {
    assert.ok(Str.endsWith('hello world', ['foo', 'world']))
  })
})

describe('Str.before()', () => {
  it('returns everything before first occurrence', () => {
    assert.strictEqual(Str.before('hello@example.com', '@'), 'hello')
  })
  it('returns full string when search is not found', () => {
    assert.strictEqual(Str.before('hello', '@'), 'hello')
  })
})

describe('Str.beforeLast()', () => {
  it('returns everything before the last occurrence', () => {
    assert.strictEqual(Str.beforeLast('a/b/c', '/'), 'a/b')
  })
  it('returns full string when search is not found', () => {
    assert.strictEqual(Str.beforeLast('hello', '/'), 'hello')
  })
})

describe('Str.after()', () => {
  it('returns everything after first occurrence', () => {
    assert.strictEqual(Str.after('hello@example.com', '@'), 'example.com')
  })
  it('returns full string when search is not found', () => {
    assert.strictEqual(Str.after('hello', '@'), 'hello')
  })
})

describe('Str.afterLast()', () => {
  it('returns everything after the last occurrence', () => {
    assert.strictEqual(Str.afterLast('a/b/c', '/'), 'c')
  })
  it('returns full string when search is not found', () => {
    assert.strictEqual(Str.afterLast('hello', '/'), 'hello')
  })
})

describe('Str.between()', () => {
  it('returns the substring between from and to', () => {
    assert.strictEqual(Str.between('[hello]', '[', ']'), 'hello')
  })
  it('returns empty string when markers are adjacent', () => {
    assert.strictEqual(Str.between('[]', '[', ']'), '')
  })
})

describe('Str.replaceFirst()', () => {
  it('replaces only the first occurrence', () => {
    assert.strictEqual(Str.replaceFirst('aaa', 'a', 'b'), 'baa')
  })
  it('returns unchanged string when search is not found', () => {
    assert.strictEqual(Str.replaceFirst('hello', 'x', 'y'), 'hello')
  })
})

describe('Str.replaceLast()', () => {
  it('replaces only the last occurrence', () => {
    assert.strictEqual(Str.replaceLast('aaa', 'a', 'b'), 'aab')
  })
  it('returns unchanged string when search is not found', () => {
    assert.strictEqual(Str.replaceLast('hello', 'x', 'y'), 'hello')
  })
})

describe('Str.padLeft()', () => {
  it('pads the left side with spaces by default', () => {
    assert.strictEqual(Str.padLeft('5', 3), '  5')
  })
  it('pads with custom character', () => {
    assert.strictEqual(Str.padLeft('5', 3, '0'), '005')
  })
  it('returns unchanged string when already at length', () => {
    assert.strictEqual(Str.padLeft('hello', 3), 'hello')
  })
})

describe('Str.padRight()', () => {
  it('pads the right side with spaces', () => {
    assert.strictEqual(Str.padRight('hi', 5), 'hi   ')
  })
  it('pads with custom character', () => {
    assert.strictEqual(Str.padRight('hi', 5, '-'), 'hi---')
  })
})

describe('Str.padBoth()', () => {
  it('centres the string', () => {
    const result = Str.padBoth('hi', 6)
    assert.strictEqual(result.length, 6)
    assert.ok(result.includes('hi'))
  })
  it('returns unchanged string when already at or over length', () => {
    assert.strictEqual(Str.padBoth('hello', 3), 'hello')
  })
})

describe('Str.squish()', () => {
  it('collapses multiple spaces', () => {
    assert.strictEqual(Str.squish('  hello   world  '), 'hello world')
  })
  it('trims leading and trailing whitespace', () => {
    assert.strictEqual(Str.squish('\thello\t'), 'hello')
  })
})

describe('Str.trim()', () => {
  it('trims whitespace by default', () => {
    assert.strictEqual(Str.trim('  hello  '), 'hello')
  })
  it('trims specified characters', () => {
    assert.strictEqual(Str.trim('/path/', '/'), 'path')
  })
})

describe('Str.mask()', () => {
  it('masks from start to end of string by default', () => {
    const result = Str.mask('hello', '*', 2)
    assert.strictEqual(result, 'he***')
  })
  it('masks only the specified length', () => {
    const result = Str.mask('4111 1111 1111 1111', '*', 0, 14)
    assert.strictEqual(result, '************** 1111')
  })
})

describe('Str.ascii()', () => {
  it('strips diacritics', () => {
    assert.strictEqual(Str.ascii('café'), 'cafe')
  })
  it('handles plain ASCII unchanged', () => {
    assert.strictEqual(Str.ascii('hello'), 'hello')
  })
})

describe('Str.slug()', () => {
  it('converts to URL-friendly slug', () => {
    assert.strictEqual(Str.slug('Hello World!'), 'hello-world')
  })
  it('uses custom separator', () => {
    assert.strictEqual(Str.slug('Hello World', '_'), 'hello_world')
  })
  it('strips special characters', () => {
    assert.strictEqual(Str.slug('Hello & World'), 'hello-world')
  })
})

describe('Str.uuid()', () => {
  it('generates a valid UUID v4', () => {
    const id = Str.uuid()
    assert.ok(Str.isUuid(id), `Expected UUID, got: ${id}`)
  })
  it('generates unique values', () => {
    assert.notStrictEqual(Str.uuid(), Str.uuid())
  })
})

describe('Str.isUuid()', () => {
  it('returns true for a valid UUID', () => {
    assert.ok(Str.isUuid('550e8400-e29b-41d4-a716-446655440000'))
  })
  it('returns false for invalid input', () => {
    assert.ok(!Str.isUuid('not-a-uuid'))
    assert.ok(!Str.isUuid(''))
  })
})

describe('Str.isUlid()', () => {
  it('returns false for non-ULID input', () => {
    assert.ok(!Str.isUlid('not-a-ulid'))
  })
  it('returns true for a valid ULID (26 uppercase Crockford base32 chars)', () => {
    assert.ok(Str.isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'))
  })
})

describe('Str.random()', () => {
  it('generates a string of the requested length', () => {
    assert.strictEqual(Str.random(16).length, 16)
    assert.strictEqual(Str.random(32).length, 32)
  })
  it('generates unique values', () => {
    assert.notStrictEqual(Str.random(), Str.random())
  })
})

describe('Str.password()', () => {
  it('generates a string of the requested length', () => {
    assert.strictEqual(Str.password(24).length, 24)
  })
  it('generates unique values', () => {
    assert.notStrictEqual(Str.password(), Str.password())
  })
})

describe('Str.plural()', () => {
  it('pluralises a regular word', () => {
    assert.strictEqual(Str.plural('post'), 'posts')
  })
  it('returns singular form when count is 1', () => {
    assert.strictEqual(Str.plural('post', 1), 'post')
  })
  it('handles irregular words', () => {
    assert.strictEqual(Str.plural('person'), 'people')
    assert.strictEqual(Str.plural('child'), 'children')
  })
  it('handles uncountable words', () => {
    assert.strictEqual(Str.plural('sheep'), 'sheep')
    assert.strictEqual(Str.plural('fish'), 'fish')
  })
  it('handles -y → -ies', () => {
    assert.strictEqual(Str.plural('category'), 'categories')
  })
  it('handles -s, -x, -z, -ch, -sh → -es', () => {
    assert.strictEqual(Str.plural('box'), 'boxes')
    assert.strictEqual(Str.plural('branch'), 'branches')
  })
})

describe('Str.singular()', () => {
  it('singularises a regular word', () => {
    assert.strictEqual(Str.singular('posts'), 'post')
  })
  it('handles irregular plurals', () => {
    assert.strictEqual(Str.singular('people'), 'person')
    assert.strictEqual(Str.singular('children'), 'child')
  })
  it('handles uncountable words', () => {
    assert.strictEqual(Str.singular('sheep'), 'sheep')
  })
  it('handles -ies → -y', () => {
    assert.strictEqual(Str.singular('categories'), 'category')
  })
  it('does not corrupt words ending in -ves from verbs', () => {
    assert.strictEqual(Str.singular('drives'), 'drive')
    assert.strictEqual(Str.singular('gives'), 'give')
    assert.strictEqual(Str.singular('archives'), 'archive')
  })
  it('singularises consonant -ves words', () => {
    assert.strictEqual(Str.singular('dwarves'), 'dwarf')
    assert.strictEqual(Str.singular('scarves'), 'scarf')
    assert.strictEqual(Str.singular('calves'), 'calf')
  })
})

describe('Str.plural()', () => {
  it('does not produce -oes for loanwords', () => {
    assert.strictEqual(Str.plural('piano'), 'pianos')
    assert.strictEqual(Str.plural('photo'), 'photos')
    assert.strictEqual(Str.plural('solo'), 'solos')
    assert.strictEqual(Str.plural('radio'), 'radios')
  })
  it('uses irregulars for -oes words', () => {
    assert.strictEqual(Str.plural('potato'), 'potatoes')
    assert.strictEqual(Str.plural('tomato'), 'tomatoes')
    assert.strictEqual(Str.plural('echo'), 'echoes')
    assert.strictEqual(Str.plural('hero'), 'heroes')
  })
})

// ─── Num ───────────────────────────────────────────────────

describe('Num.format()', () => {
  it('formats a number with commas', () => {
    assert.strictEqual(Num.format(1234567), '1,234,567')
  })
  it('formats with specified decimal places', () => {
    assert.strictEqual(Num.format(1234567.89, 2), '1,234,567.89')
  })
  it('formats zero decimals explicitly', () => {
    assert.strictEqual(Num.format(1000, 0), '1,000')
  })
})

describe('Num.currency()', () => {
  it('formats USD by default', () => {
    assert.strictEqual(Num.currency(9.99), '$9.99')
  })
  it('formats EUR with German locale', () => {
    const result = Num.currency(9.99, 'EUR', 'de-DE')
    assert.ok(result.includes('9') && result.includes('€'), `Unexpected: ${result}`)
  })
})

describe('Num.percentage()', () => {
  it('formats as a percentage', () => {
    assert.strictEqual(Num.percentage(50), '50%')
  })
  it('respects decimal places', () => {
    assert.strictEqual(Num.percentage(73.5, 1), '73.5%')
  })
})

describe('Num.fileSize()', () => {
  it('formats bytes', () => {
    assert.strictEqual(Num.fileSize(0), '0 B')
    assert.strictEqual(Num.fileSize(512), '512 B')
  })
  it('formats kilobytes', () => {
    assert.strictEqual(Num.fileSize(1536), '1.50 KB')
  })
  it('formats megabytes', () => {
    assert.ok(Num.fileSize(1_048_576).includes('MB'))
  })
  it('formats gigabytes', () => {
    assert.ok(Num.fileSize(1_073_741_824).includes('GB'))
  })
})

describe('Num.abbreviate()', () => {
  it('abbreviates thousands', () => {
    assert.strictEqual(Num.abbreviate(1500), '1.5K')
  })
  it('abbreviates millions', () => {
    assert.strictEqual(Num.abbreviate(1_500_000), '1.5M')
  })
  it('abbreviates billions', () => {
    assert.strictEqual(Num.abbreviate(2_000_000_000), '2.0B')
  })
  it('abbreviates trillions', () => {
    assert.strictEqual(Num.abbreviate(3_000_000_000_000), '3.0T')
  })
  it('handles negative values', () => {
    assert.strictEqual(Num.abbreviate(-1500), '-1.5K')
  })
  it('returns string for small numbers', () => {
    assert.strictEqual(Num.abbreviate(42), '42')
  })
})

describe('Num.ordinal()', () => {
  it('handles 1st, 2nd, 3rd', () => {
    assert.strictEqual(Num.ordinal(1), '1st')
    assert.strictEqual(Num.ordinal(2), '2nd')
    assert.strictEqual(Num.ordinal(3), '3rd')
  })
  it('handles 4th through 20th', () => {
    assert.strictEqual(Num.ordinal(4), '4th')
    assert.strictEqual(Num.ordinal(11), '11th')
    assert.strictEqual(Num.ordinal(12), '12th')
    assert.strictEqual(Num.ordinal(13), '13th')
  })
  it('handles 21st, 22nd, 23rd', () => {
    assert.strictEqual(Num.ordinal(21), '21st')
    assert.strictEqual(Num.ordinal(22), '22nd')
    assert.strictEqual(Num.ordinal(23), '23rd')
  })
})

describe('Num.clamp()', () => {
  it('returns value when within range', () => {
    assert.strictEqual(Num.clamp(50, 0, 100), 50)
  })
  it('clamps to min', () => {
    assert.strictEqual(Num.clamp(-10, 0, 100), 0)
  })
  it('clamps to max', () => {
    assert.strictEqual(Num.clamp(150, 0, 100), 100)
  })
})

describe('Num.trim()', () => {
  it('removes trailing zeros', () => {
    assert.strictEqual(Num.trim(1.5), '1.5')
    assert.strictEqual(Num.trim(1.0), '1')
  })
  it('respects decimal places when specified', () => {
    assert.strictEqual(Num.trim(1.5, 3), '1.5')
    assert.strictEqual(Num.trim(1.0, 2), '1')
  })
})

describe('Num.spell()', () => {
  it('spells zero', () => {
    assert.strictEqual(Num.spell(0), 'zero')
  })
  it('spells single-digit numbers', () => {
    assert.strictEqual(Num.spell(1), 'one')
    assert.strictEqual(Num.spell(9), 'nine')
  })
  it('spells teens', () => {
    assert.strictEqual(Num.spell(11), 'eleven')
    assert.strictEqual(Num.spell(19), 'nineteen')
  })
  it('spells tens', () => {
    assert.strictEqual(Num.spell(20), 'twenty')
    assert.strictEqual(Num.spell(42), 'forty-two')
  })
  it('spells hundreds', () => {
    assert.strictEqual(Num.spell(100), 'one hundred')
    assert.strictEqual(Num.spell(999), 'nine hundred ninety-nine')
  })
  it('spells thousands', () => {
    assert.strictEqual(Num.spell(1000), 'one thousand')
    assert.strictEqual(Num.spell(1001), 'one thousand one')
  })
  it('spells millions', () => {
    assert.strictEqual(Num.spell(1_000_000), 'one million')
    assert.strictEqual(Num.spell(2_500_000), 'two million five hundred thousand')
  })
  it('spells billions', () => {
    assert.strictEqual(Num.spell(1_000_000_000), 'one billion')
  })
  it('spells trillions', () => {
    assert.strictEqual(Num.spell(1_000_000_000_000), 'one trillion')
    assert.strictEqual(Num.spell(999_000_000_000_000), 'nine hundred ninety-nine trillion')
  })
  it('spells negative numbers', () => {
    assert.strictEqual(Num.spell(-42), 'negative forty-two')
  })
  it('truncates fractional part', () => {
    assert.strictEqual(Num.spell(3.9), 'three')
  })
})

// ─── t() ──────────────────────────────────────────────────

describe('t()', () => {
  it('substitutes :key placeholders', () => {
    assert.strictEqual(t('Hello :name!', { name: 'Alice' }), 'Hello Alice!')
  })
  it('substitutes numeric values', () => {
    assert.strictEqual(t('You have :count items', { count: 5 }), 'You have 5 items')
  })
  it('leaves unknown placeholders intact', () => {
    assert.strictEqual(t('Hello :name :other', { name: 'Bob' }), 'Hello Bob :other')
  })
  it('returns template unchanged when no vars match', () => {
    assert.strictEqual(t('no placeholders', {}), 'no placeholders')
  })
})

// ─── validateSerializable() ───────────────────────────────

describe('validateSerializable()', () => {
  const origEnv = process.env['NODE_ENV']
  beforeEach(() => { process.env['NODE_ENV'] = 'development' })
  afterEach(() => { process.env['NODE_ENV'] = origEnv })

  it('does not throw for a plain object', () => {
    assert.doesNotThrow(() => validateSerializable({ a: 1, b: 'x', c: true }, 'test'))
  })
  it('does not throw for arrays and nested objects', () => {
    assert.doesNotThrow(() => validateSerializable([{ id: 1 }, { id: 2 }], 'test'))
  })
  it('reports functions via console.error', () => {
    const logs: string[] = []
    const orig = console.error
    console.error = (msg: string) => logs.push(msg)
    validateSerializable({ fn: () => {} }, 'test')
    console.error = orig
    assert.ok(logs.some(l => l.includes('function')))
  })
  it('reports class instances via console.error', () => {
    class Foo {}
    const logs: string[] = []
    const orig = console.error
    console.error = (msg: string) => logs.push(msg)
    validateSerializable({ x: new Foo() }, 'test')
    console.error = orig
    assert.ok(logs.some(l => l.includes('class instance')))
  })
})

// ─── Collection.sortBy() / .unique() ─────────────────────

describe('Collection.sortBy()', () => {
  it('sorts by object key', () => {
    const c = new Collection([{ n: 3 }, { n: 1 }, { n: 2 }]).sortBy('n')
    assert.deepStrictEqual(c.pluck('n').toArray(), [1, 2, 3])
  })
  it('sorts by resolver function', () => {
    const c = new Collection(['banana', 'apple', 'cherry']).sortBy(s => s)
    assert.deepStrictEqual(c.toArray(), ['apple', 'banana', 'cherry'])
  })
  it('does not mutate original', () => {
    const orig = [3, 1, 2]
    const c = new Collection(orig).sortBy(n => n)
    assert.deepStrictEqual(orig, [3, 1, 2])
    assert.deepStrictEqual(c.toArray(), [1, 2, 3])
  })
})

describe('Collection.unique()', () => {
  it('removes duplicate primitives', () => {
    const c = new Collection([1, 2, 1, 3, 2]).unique()
    assert.deepStrictEqual(c.toArray(), [1, 2, 3])
  })
  it('deduplicates by object key', () => {
    const c = new Collection([{ id: 1 }, { id: 2 }, { id: 1 }]).unique('id')
    assert.deepStrictEqual(c.pluck('id').toArray(), [1, 2])
  })
  it('deduplicates by resolver', () => {
    const c = new Collection([{ tag: 'A' }, { tag: 'B' }, { tag: 'A' }]).unique(x => x.tag)
    assert.deepStrictEqual(c.pluck('tag').toArray(), ['A', 'B'])
  })
})

describe('Collection.splitIn() guard', () => {
  it('throws when n < 1', () => {
    assert.throws(() => new Collection([1, 2, 3]).splitIn(0), /n must be >= 1/)
  })
})

