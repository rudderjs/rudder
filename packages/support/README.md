# @rudderjs/support

Shared utility primitives for RudderJS: collections, environment access, config lookup, debug helpers, and general-purpose functions.

All exports are also available from `@rudderjs/core` — you rarely need to install this package directly.

## Installation

```bash
pnpm add @rudderjs/support
```

---

## `config()`

Read values from the application's `ConfigRepository` using dot-notation keys. The store is populated from your `config/` files at bootstrap time.

```ts
import { config } from '@rudderjs/core'

config('app.name')           // → 'RudderJS'
config('app.debug')          // → false
config('cache.ttl', 60)      // → number (with fallback)
```

Keys follow the `file.key` pattern — `app.name` reads `configs.app.name` from `config/index.ts`.

### `ConfigRepository` class

```ts
import { ConfigRepository } from '@rudderjs/support'

const repo = new ConfigRepository({ db: { host: 'localhost', port: 5432 } })

repo.get('db.host')            // 'localhost'
repo.get('db.port', 3306)      // 5432   (falsy-safe — 0, false, '' are returned as-is)
repo.get('db.missing', 'n/a')  // 'n/a'
repo.has('db.host')            // true
repo.set('db.name', 'myapp')   // creates nested key
repo.all()                     // entire data object
```

`set()` silently ignores keys containing `__proto__`, `constructor`, or `prototype`.

---

## `dd()` / `dump()`

Debug helpers inspired by Laravel.

```ts
import { dd, dump } from '@rudderjs/core'

// dump() — pretty-prints and continues
dump({ user, session })
dump(req.body, req.headers)   // multiple args supported

// dd() — pretty-prints then terminates the process
dd(req.body)
```

Both format arguments with `JSON.stringify` at 2-space indent. `dd()` calls `process.exit(1)` — development use only.

---

## `env()`

Read a string environment variable.

```ts
import { env } from '@rudderjs/support'

env('APP_NAME', 'RudderJS')   // → 'RudderJS'
env('APP_ENV')                // throws if missing and no fallback
```

---

## `Env`

Type-safe access to `process.env`.

```ts
import { Env } from '@rudderjs/support'

Env.get('APP_NAME', 'RudderJS')       // string  (throws if missing and no fallback)
Env.getNumber('PORT', 3000)           // number
Env.getBool('APP_DEBUG', false)       // boolean — case-insensitive 'true' | '1' → true
Env.has('REDIS_URL')                  // boolean
```

| Method | Return | Description |
|---|---|---|
| `get(key, fallback?)` | `string` | Returns the value or fallback. Throws if both are absent. |
| `getNumber(key, fallback?)` | `number` | Coerces to number. Throws if absent or NaN. |
| `getBool(key, fallback?)` | `boolean` | Case-insensitive `'true'` / `'1'` → `true`; everything else → `false`. |
| `has(key)` | `boolean` | `true` if the variable is set in `process.env`. |

---

## `defineEnv()`

Validate environment variables at startup using a Zod schema. Throws with a clear error listing all missing/invalid keys before the application boots.

```ts
import { defineEnv } from '@rudderjs/support'
import { z } from 'zod'

export const env = defineEnv(z.object({
  DATABASE_URL: z.string().url(),
  PORT:         z.coerce.number().default(3000),
  APP_DEBUG:    z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
}))

env.PORT      // number
env.APP_DEBUG // boolean
```

---

## `Collection<T>`

Fluent, typed wrapper around arrays — inspired by Laravel Collections.

```ts
import { Collection } from '@rudderjs/support'

const users = Collection.of([
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob',   role: 'user' },
  { id: 3, name: 'Carol', role: 'admin' },
])

users.filter(u => u.role === 'admin').pluck('name').toArray()  // ['Alice', 'Carol']
users.groupBy('role')   // { admin: [...], user: [...] }
users.chunk(2).toArray()  // [[...], [...]]
users.partition(u => u.role === 'admin')  // [Collection<admin>, Collection<user>]
```

**Core**

| Method | Description |
|---|---|
| `all()` | Underlying array. |
| `count()` | Number of items. |
| `first(fn?)` | First item (or first matching if `fn` given). |
| `last(fn?)` | Last item (or last matching if `fn` given). |
| `isEmpty()` | `true` when empty. |
| `isNotEmpty()` | `true` when not empty. |
| `each(fn)` | Iterate; returns `this`. |
| `toArray()` | Shallow copy. |
| `toJSON()` | Returns `T[]` — `JSON.stringify` works correctly. |

**Transform**

| Method | Description |
|---|---|
| `map<U>(fn)` | Transform each item; returns `Collection<U>`. |
| `flatMap<U>(fn)` | Map then flatten one level. |
| `filter(fn)` | Keep matching items. |
| `reject(fn)` | Remove matching items (inverse of `filter`). |
| `pluck(key)` | Extract a single field from each item. |
| `mapSpread<U>(fn)` | Spread each item as args to `fn` (useful for tuples). |

**Search**

| Method | Description |
|---|---|
| `find(fn)` | First matching item or `undefined`. |
| `contains(fn\|value)` | `true` if predicate matches or value is present. |
| `sole(fn?)` | Single matching item — throws if 0 or >1 found. |

**Grouping**

| Method | Description |
|---|---|
| `groupBy(key\|fn)` | Groups into `Record<string, T[]>`. |
| `keyBy(key\|fn)` | Index by key — returns `Record<string, T>`. Last write wins. |
| `mapWithKeys(fn)` | Transform to `Record<string, V>` via `fn` returning `[key, value]`. |

**Splitting**

| Method | Description |
|---|---|
| `chunk(size)` | Split into `Collection<T[]>` of fixed size. |
| `splitIn(n)` | Split into exactly `n` roughly-equal groups. |
| `partition(fn)` | Split into `[passing, failing]` tuple of collections. |
| `sliding(size, step?)` | Overlapping windows of `size`. |

**Combination**

| Method | Description |
|---|---|
| `zip(other)` | Pair items with another array/collection (shortest wins). |
| `crossJoin(other)` | Cartesian product with another array/collection. |
| `combine(values)` | Use this collection as keys, `values` as values → `Record<string, V>`. |

**Conditional / Pipe**

| Method | Description |
|---|---|
| `when(cond, fn, otherwise?)` | Apply `fn` if condition is truthy. |
| `unless(cond, fn, otherwise?)` | Apply `fn` if condition is falsy. |
| `pipe(fn)` | Pass collection through `fn`, return result (break the chain). |
| `tap(fn)` | Side-effect — calls `fn(this)` then returns `this`. |

---

---

## `Str`

30+ static string helpers — case conversion, truncation, search, extraction, masking, pluralisation, and generation.

```ts
import { Str } from '@rudderjs/support'

Str.camel('hello_world')       // 'helloWorld'
Str.snake('helloWorld')        // 'hello_world'
Str.kebab('helloWorld')        // 'hello-world'
Str.studly('hello_world')      // 'HelloWorld'
Str.headline('user_profile')   // 'User Profile'
Str.slug('Hello World!')       // 'hello-world'

Str.limit('The quick brown fox', 10)          // 'The quick...'
Str.excerpt('The quick brown fox', 'quick')   // 'The quick brown fox'
Str.mask('4111111111111111', '*', 0, 12)      // '************1111'

Str.before('user@example.com', '@')    // 'user'
Str.after('user@example.com', '@')     // 'example.com'
Str.between('<tag>content</tag>', '<tag>', '</tag>')  // 'content'

Str.plural('post')       // 'posts'
Str.plural('post', 1)    // 'post'
Str.singular('posts')    // 'post'

Str.uuid()               // 'f47ac10b-...'
Str.random(16)           // 'aB3xK9mZ...'
Str.password(32)         // cryptographically random password
```

| Category | Methods |
|---|---|
| Case | `camel`, `snake`, `kebab`, `studly`, `title`, `headline` |
| Truncation | `limit`, `words`, `excerpt` |
| Search | `contains`, `containsAll`, `startsWith`, `endsWith` |
| Extraction | `before`, `beforeLast`, `after`, `afterLast`, `between` |
| Replacement | `replaceFirst`, `replaceLast` |
| Padding | `padLeft`, `padRight`, `padBoth` |
| Whitespace | `squish`, `trim` |
| Masking | `mask` |
| Normalisation | `ascii`, `slug` |
| Identification | `uuid`, `isUuid`, `isUlid` |
| Generation | `random`, `password` |
| Pluralisation | `plural`, `singular` |

---

## `Num`

Static numeric helpers — formatting, abbreviation, ordinals, and more.

```ts
import { Num } from '@rudderjs/support'

Num.format(1234567.89, 2)          // '1,234,567.89'
Num.currency(9.99)                 // '$9.99'
Num.currency(9.99, 'EUR', 'de-DE') // '9,99 €'
Num.percentage(73.5, 1)            // '73.5%'
Num.fileSize(1536)                 // '1.50 KB'
Num.abbreviate(1_500_000)          // '1.5M'
Num.ordinal(22)                    // '22nd'
Num.clamp(150, 0, 100)             // 100
Num.trim(1.5000)                   // '1.5'
Num.spell(42)                      // 'forty-two'
Num.spell(1_001)                   // 'one thousand one'
```

| Method | Description |
|---|---|
| `format(n, decimals?, locale?)` | Locale-aware number with separators. |
| `currency(n, currency?, locale?)` | Currency string via `Intl.NumberFormat`. |
| `percentage(n, decimals?, locale?)` | `n` as a percentage (`50` → `'50%'`). |
| `fileSize(bytes, precision?)` | Human-readable file size (`1536` → `'1.50 KB'`). |
| `abbreviate(n, precision?)` | Short form (`1_500_000` → `'1.5M'`). |
| `ordinal(n)` | Ordinal suffix (`1` → `'1st'`, `22` → `'22nd'`). |
| `clamp(n, min, max)` | Clamp to range. |
| `trim(n, decimals?)` | Remove trailing zeros (`1.500` → `'1.5'`). |
| `spell(n)` | Integer to English words (`42` → `'forty-two'`). |

---

## Helper Functions

```ts
import { sleep, ucfirst, pick, omit, tap, deepClone, isObject, toSnakeCase, toCamelCase } from '@rudderjs/support'

await sleep(500)

ucfirst('hello world')                                    // 'Hello world'
toSnakeCase('fooBarBaz')                                  // 'foo_bar_baz'
toCamelCase('foo_bar_baz')                                // 'fooBarBaz'

pick({ id: 1, name: 'A', secret: 'x' }, ['id', 'name'])  // { id: 1, name: 'A' }
omit({ id: 1, secret: 'x' }, ['secret'])                  // { id: 1 }

tap(new Map(), m => m.set('key', 1))                      // returns the Map
deepClone({ nested: { value: 1 } })                       // deep copy via JSON round-trip

isObject({})          // true
isObject(new Date())  // false — only plain objects pass
isObject([])          // false
isObject(null)        // false
```

| Function | Description |
|---|---|
| `sleep(ms)` | Resolves after `ms` milliseconds. |
| `ucfirst(str)` | Capitalises the first character. |
| `toSnakeCase(str)` | `camelCase` / `PascalCase` → `snake_case`. |
| `toCamelCase(str)` | `snake_case` → `camelCase`. |
| `pick(obj, keys)` | New object with only the specified keys. |
| `omit(obj, keys)` | New object with the specified keys removed. |
| `tap(value, fn)` | Calls `fn(value)` and returns `value`. |
| `deepClone(value)` | Deep clone via JSON round-trip. |
| `isObject(value)` | `true` for plain objects only — `false` for `Date`, `Map`, arrays, `null`. |

---

## Notes

- All exports are re-exported from `@rudderjs/core` — you rarely need to import `@rudderjs/support` directly.
- `defineEnv()` validates eagerly at module evaluation time — failures surface at boot.
- `dd()` calls `process.exit(1)` — development use only.
- `resolveOptionalPeer()` resolves optional peer packages from the app root — used internally by adapters.
