# @boostkit/support

Shared utility primitives — collections, environment access, config lookup, debug helpers, and general-purpose functions.

All exports are also available from `@boostkit/core` for convenience.

```bash
pnpm add @boostkit/support
```

---

## `config()`

Read values from the application's `ConfigRepository` using dot-notation keys. The config store is populated from your `config/` files at bootstrap time via `Application.configure({ config: configs })`.

```ts
import { config } from '@boostkit/core'

config('app.name')              // → 'BoostKit'
config('app.env')               // → 'development'
config('app.debug')             // → false
config('server.port', 3000)     // → number (with fallback)
config('database.default')      // → 'sqlite'
```

Keys follow the `file.key` pattern — `app.name` reads `configs.app.name` from your `config/index.ts`.

### Demo

```ts
// routes/api.ts
import { config } from '@boostkit/core'

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

Debug helpers inspired by Laravel. Both are importable from `@boostkit/core`.

```ts
import { dd, dump } from '@boostkit/core'

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
import { env } from '@boostkit/core'

env('APP_NAME', 'BoostKit')   // → 'BoostKit'
env('APP_ENV')                // throws if missing and no fallback
```

For typed access (numbers, booleans, existence checks) use the `Env` object:

```ts
import { Env } from '@boostkit/support'

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
import { defineEnv } from '@boostkit/support'
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
import { Collection } from '@boostkit/support'

const users = Collection.of([
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob',   role: 'user' },
  { id: 3, name: 'Carol', role: 'admin' },
])

users.filter(u => u.role === 'admin').pluck('name').toArray()
// → ['Alice', 'Carol']

users.groupBy('role')
// → { admin: [...], user: [...] }

users.first()   // { id: 1, name: 'Alice', role: 'admin' }
users.count()   // 3
```

### `Collection` Methods

| Method | Description |
|---|---|
| `map<U>(fn)` | Transforms each item, returns a new `Collection<U>`. |
| `filter(fn)` | Keeps items matching the predicate. |
| `find(fn)` | Returns the first matching item, or `undefined`. |
| `first()` | Returns the first item, or `undefined`. |
| `last()` | Returns the last item, or `undefined`. |
| `pluck(key)` | Extracts a single field from each item. |
| `groupBy(key)` | Groups items into a `Record<string, T[]>` by field. |
| `each(fn)` | Iterates over items; returns `this` for chaining. |
| `contains(fn)` | Returns `true` if any item matches the predicate. |
| `isEmpty()` | Returns `true` if the collection has no items. |
| `count()` | Returns the number of items. |
| `all()` | Returns the underlying array. |
| `toArray()` | Returns a shallow copy of the underlying array. |
| `toJSON()` | Returns the underlying `T[]` — allows `JSON.stringify(collection)` to serialize correctly. |

---

## Helper Functions

```ts
import { sleep, ucfirst, pick, omit, tap, deepClone, isObject, toSnakeCase, toCamelCase } from '@boostkit/support'

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
import { resolveOptionalPeer } from '@boostkit/support'

const mod = await resolveOptionalPeer('@boostkit/router')
```

---

## Notes

- All exports are re-exported from `@boostkit/core` — you rarely need to import `@boostkit/support` directly.
- `defineEnv` validates eagerly at module evaluation time. Failures surface at boot, not at runtime.
- `dd()` calls `process.exit(1)` — development use only.
