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
])

users.filter(u => u.role === 'admin').pluck('name').toArray()
// → ['Alice']

users.groupBy('role')   // → { admin: [...], user: [...] }
users.first()           // { id: 1, name: 'Alice', role: 'admin' }
users.count()           // 2

JSON.stringify(users)   // '[{"id":1,...},{"id":2,...}]'  — no double-encoding
```

| Method | Description |
|---|---|
| `map<U>(fn)` | Transforms each item; returns a new `Collection<U>`. |
| `filter(fn)` | Keeps items matching the predicate. |
| `find(fn)` | First matching item, or `undefined`. |
| `first()` | First item, or `undefined`. |
| `last()` | Last item, or `undefined`. |
| `pluck(key)` | Extracts a single field from each item. |
| `groupBy(key)` | Groups into `Record<string, T[]>`. |
| `each(fn)` | Iterates; returns `this` for chaining. |
| `contains(fn)` | `true` if any item matches the predicate. |
| `isEmpty()` | `true` when the collection has no items. |
| `count()` | Number of items. |
| `all()` | The underlying array. |
| `toArray()` | Shallow copy of the underlying array. |
| `toJSON()` | Returns `T[]` — makes `JSON.stringify(collection)` produce correct output. |

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
