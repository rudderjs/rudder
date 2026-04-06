# @rudderjs/support

Shared utility primitives — collections, environment access, config lookup, debug helpers, and general-purpose functions.

All exports are also available from `@rudderjs/core` for convenience.

```bash
pnpm add @rudderjs/support
```

---

## `config()`

Read values from the application's `ConfigRepository` using dot-notation keys. The config store is populated from your `config/` files at bootstrap time via `Application.configure({ config: configs })`.

```ts
import { config } from '@rudderjs/core'

config('app.name')              // → 'RudderJS'
config('app.env')               // → 'development'
config('app.debug')             // → false
config('server.port', 3000)     // → number (with fallback)
config('database.default')      // → 'sqlite'
```

Keys follow the `file.key` pattern — `app.name` reads `configs.app.name` from your `config/index.ts`.

### Demo

```ts
// routes/api.ts
import { config } from '@rudderjs/core'

router.get('/api/config', (_req, res) => res.json({
  name:  config('app.name'),
  env:   config('app.env'),
  debug: config('app.debug'),
  url:   config('app.url'),
}))
```

### `ConfigRepository` API

| Function | Signature | Description |
|---|---|---|
| `config` | `<T>(key: string, fallback?: T) => T` | Reads a value by dot-notation key from the global config store. |
| `setConfigRepository` | `(repo: ConfigRepository) => void` | Sets the global config instance. Called internally by `Application.configure()`. |

---

## `dd()` / `dump()`

Debug helpers inspired by Laravel. Both are importable from `@rudderjs/core`.

```ts
import { dd, dump } from '@rudderjs/core'

// dump() — pretty-prints to the terminal, server keeps running
dump({ user, session })
dump(req.body, req.headers)   // accepts multiple arguments

// dd() — pretty-prints then terminates the process (restart required)
dd(req.body)
```

`dd` stands for *dump and die*. Both accept any number of arguments and format them with `JSON.stringify` at 2-space indent.

::: warning
`dd()` calls `process.exit(1)`. Use it only during local development — the server must be restarted after it fires.
:::

---

## `env()`

Simple helper for reading a string environment variable — consistent with `config()` and `dd()`.

```ts
import { env } from '@rudderjs/core'

env('APP_NAME', 'RudderJS')   // → 'RudderJS'
env('APP_ENV')                // throws if missing and no fallback
```

For typed access (numbers, booleans, existence checks) use the `Env` object:

```ts
import { Env } from '@rudderjs/support'

Env.getNumber('PORT', 3000)        // number
Env.getBool('APP_DEBUG', false)    // boolean  ('true' | '1' → true)
Env.has('REDIS_URL')               // boolean
```

### `Env` Methods

| Method | Return | Description |
|---|---|---|
| `get(key, fallback?)` | `string` | Returns the env value or the fallback. Throws if both are absent. |
| `getNumber(key, fallback?)` | `number` | Coerces to number, or returns fallback. Throws if both absent or NaN. |
| `getBool(key, fallback?)` | `boolean` | Case-insensitive `'true'` / `'1'` → `true`; anything else → `false`. |
| `has(key)` | `boolean` | Returns `true` if the variable is set. |

---

## `defineEnv()`

Validate environment variables at startup using a Zod schema. Throws a clear error listing all missing or invalid keys before the application boots.

```ts
import { defineEnv } from '@rudderjs/support'
import { z } from 'zod'

export const env = defineEnv(z.object({
  APP_NAME:     z.string().min(1),
  APP_ENV:      z.enum(['development', 'production', 'test']).default('development'),
  PORT:         z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
}))

// env.APP_NAME  → string
// env.PORT      → number
```

---

## `Collection<T>`

A typed, chainable wrapper around arrays — inspired by Laravel Collections.

```ts
import { Collection } from '@rudderjs/support'

const users = Collection.of([
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob',   role: 'user' },
  { id: 3, name: 'Carol', role: 'admin' },
])

users.filter(u => u.role === 'admin').pluck('name').toArray()   // ['Alice', 'Carol']
users.groupBy('role')                                            // { admin: [...], user: [...] }
users.chunk(2).toArray()                                         // [[...], [...]]
users.partition(u => u.role === 'admin')                         // [Collection, Collection]
users.keyBy('id')                                               // { '1': {...}, '2': {...}, '3': {...} }

// Conditional + pipe
users
  .when(users.count() > 2, c => c.filter(u => u.role === 'admin'))
  .tap(c => console.log(c.count()))
  .pipe(c => c.toArray())
```

### Core

| Method | Description |
|---|---|
| `all()` | Underlying array. |
| `count()` | Number of items. |
| `first(fn?)` | First item, or first matching if `fn` given. |
| `last(fn?)` | Last item, or last matching if `fn` given. |
| `isEmpty()` | `true` when empty. |
| `isNotEmpty()` | `true` when not empty. |
| `each(fn)` | Iterate; returns `this`. |
| `toArray()` | Shallow copy. |
| `toJSON()` | Returns `T[]` — `JSON.stringify` works correctly. |

### Transform

| Method | Description |
|---|---|
| `map<U>(fn)` | Transform each item; returns `Collection<U>`. |
| `flatMap<U>(fn)` | Map then flatten one level. |
| `filter(fn)` | Keep matching items. |
| `reject(fn)` | Remove matching items (inverse of `filter`). |
| `pluck(key)` | Extract a single field from each item. |
| `mapSpread<U>(fn)` | Spread each item as args to `fn` — useful for tuples. |

### Search

| Method | Description |
|---|---|
| `find(fn)` | First matching item or `undefined`. |
| `contains(fn\|value)` | `true` if predicate matches or value is present. |
| `sole(fn?)` | Single matching item — throws if 0 or >1 found. |

### Grouping

| Method | Description |
|---|---|
| `groupBy(key\|fn)` | Groups into `Record<string, T[]>`. |
| `keyBy(key\|fn)` | Index by key — `Record<string, T>`. Last write wins. |
| `mapWithKeys(fn)` | Transform to `Record<string, V>` — `fn` returns `[key, value]`. |

### Splitting

| Method | Description |
|---|---|
| `chunk(size)` | Split into chunks of fixed size. |
| `splitIn(n)` | Split into exactly `n` roughly-equal groups. |
| `partition(fn)` | Split into `[passing, failing]` tuple of collections. |
| `sliding(size, step?)` | Overlapping windows of `size`. |

### Combination

| Method | Description |
|---|---|
| `zip(other)` | Pair items with another array/collection (shortest wins). |
| `crossJoin(other)` | Cartesian product with another array/collection. |
| `combine(values)` | This collection as keys, `values` as values → `Record<string, V>`. |

### Conditional / Pipe

| Method | Description |
|---|---|
| `when(cond, fn, otherwise?)` | Apply `fn` if condition is truthy. |
| `unless(cond, fn, otherwise?)` | Apply `fn` if condition is falsy. |
| `pipe(fn)` | Pass collection through `fn`, return its result. |
| `tap(fn)` | Side-effect — calls `fn(this)` and returns `this`. |

---

---

## `Str`

30+ static string helpers — importable from `@rudderjs/support` or `@rudderjs/core`.

```ts
import { Str } from '@rudderjs/core'

// Case conversion
Str.camel('hello_world')      // 'helloWorld'
Str.snake('helloWorld')       // 'hello_world'
Str.kebab('helloWorld')       // 'hello-world'
Str.studly('hello_world')     // 'HelloWorld'
Str.headline('user_profile')  // 'User Profile'
Str.slug('Hello World!')      // 'hello-world'

// Truncation
Str.limit('The quick brown fox', 10)          // 'The quick...'
Str.words('one two three four', 2)            // 'one two...'
Str.excerpt('The quick brown fox', 'quick', { radius: 5 })  // 'The quick brown'

// Search
Str.contains('foobar', 'foo')               // true
Str.startsWith('foobar', ['foo', 'baz'])    // true
Str.endsWith('foobar', 'bar')              // true

// Extraction
Str.before('user@example.com', '@')   // 'user'
Str.after('user@example.com', '@')    // 'example.com'
Str.between('<b>text</b>', '<b>', '</b>')  // 'text'

// Replacement
Str.replaceFirst('foo bar foo', 'foo', 'baz')  // 'baz bar foo'
Str.replaceLast('foo bar foo', 'foo', 'baz')   // 'foo bar baz'

// Padding
Str.padLeft('5', 3, '0')   // '005'
Str.padRight('hi', 5, '.')  // 'hi...'
Str.padBoth('hi', 6)        // '  hi  '

// Masking & normalisation
Str.mask('4111111111111111', '*', 0, 12)  // '************1111'
Str.ascii('Héllo')                         // 'Hello'
Str.squish('  foo   bar  ')               // 'foo bar'

// IDs & generation
Str.uuid()           // 'f47ac10b-...'
Str.isUuid(value)    // boolean
Str.isUlid(value)    // boolean
Str.random(16)       // cryptographically random alphanumeric string
Str.password(32)     // cryptographically random password

// Pluralisation
Str.plural('post')        // 'posts'
Str.plural('post', 1)     // 'post'
Str.singular('categories')  // 'category'
```

---

## `Num`

Static numeric helpers.

```ts
import { Num } from '@rudderjs/core'

Num.format(1234567.89, 2)           // '1,234,567.89'
Num.currency(9.99)                  // '$9.99'
Num.currency(9.99, 'EUR', 'de-DE')  // '9,99 €'
Num.percentage(73.5, 1)             // '73.5%'
Num.fileSize(1536)                  // '1.50 KB'
Num.fileSize(1_073_741_824)         // '1.00 GB'
Num.abbreviate(1_500_000)           // '1.5M'
Num.ordinal(1)                      // '1st'
Num.ordinal(22)                     // '22nd'
Num.clamp(150, 0, 100)              // 100
Num.trim(1.5000)                    // '1.5'
Num.spell(42)                       // 'forty-two'
Num.spell(1_000_001)                // 'one million one'
```

| Method | Description |
|---|---|
| `format(n, decimals?, locale?)` | Locale-aware separators. |
| `currency(n, currency?, locale?)` | Currency string. |
| `percentage(n, decimals?, locale?)` | `n` as a percentage (`50` → `'50%'`). |
| `fileSize(bytes, precision?)` | Human-readable size. |
| `abbreviate(n, precision?)` | Short form (`1.5M`, `3.2B`). |
| `ordinal(n)` | Ordinal suffix. |
| `clamp(n, min, max)` | Clamp to range. |
| `trim(n, decimals?)` | Remove trailing zeros. |
| `spell(n)` | Integer to English words. |

---

## Helper Functions

```ts
import { sleep, ucfirst, pick, omit, tap, deepClone, isObject, toSnakeCase, toCamelCase } from '@rudderjs/support'

await sleep(500)

ucfirst('hello world')                                  // 'Hello world'
toSnakeCase('fooBarBaz')                                // 'foo_bar_baz'
toCamelCase('foo_bar_baz')                              // 'fooBarBaz'

pick({ id: 1, name: 'A', secret: 'x' }, ['id', 'name'])  // { id: 1, name: 'A' }
omit({ id: 1, secret: 'x' }, ['secret'])                  // { id: 1 }

tap(new Map(), m => m.set('key', 1))  // returns the Map

deepClone({ nested: { value: 1 } })   // deep copy via JSON parse/stringify
isObject([])                           // false
isObject({})                           // true
```

| Function | Description |
|---|---|
| `sleep(ms)` | Resolves after `ms` milliseconds. |
| `ucfirst(str)` | Capitalises the first character. |
| `toSnakeCase(str)` | `camelCase` / `PascalCase` → `snake_case`. |
| `toCamelCase(str)` | `snake_case` → `camelCase`. |
| `pick(obj, keys)` | Returns a new object with only the specified keys. |
| `omit(obj, keys)` | Returns a new object with the specified keys removed. |
| `tap(value, fn)` | Calls `fn(value)` then returns `value`. |
| `deepClone(value)` | Returns a deep clone via JSON round-trip. |
| `isObject(value)` | Returns `true` for plain objects only — `false` for arrays, `null`, `Date`, `Map`, `Set`, `RegExp`. |

---

## `resolveOptionalPeer`

Dynamically resolves an optional peer dependency at runtime without bundler errors when the package is absent. Used internally by adapters.

```ts
import { resolveOptionalPeer } from '@rudderjs/support'

const mod = await resolveOptionalPeer('@rudderjs/router')
```

---

## Notes

- All exports are re-exported from `@rudderjs/core` — you rarely need to import `@rudderjs/support` directly.
- `defineEnv` validates eagerly at module evaluation time. Failures surface at boot, not at runtime.
- `dd()` calls `process.exit(1)` — development use only.
