# @boostkit/support

Shared utility primitives for BoostKit: collections, environment access, config lookup, debug helpers, and general-purpose functions.

## Installation

```bash
pnpm add @boostkit/support
```

---

## `config()`

Read values from the application's `ConfigRepository` using dot-notation keys.

```ts
import { config } from '@boostkit/core' // re-exported for convenience

config('app.name')           // → 'BoostKit'
config('app.env')            // → 'development'
config('cache.ttl', 60)      // → number (with fallback)
config('database.default')   // → 'sqlite'
```

The config store is populated from your `config/index.ts` at bootstrap time via `Application.configure({ config: configs })`. Keys follow the `file.key` pattern — `app.name` reads `configs.app.name`.

---

## `dd()` / `dump()`

Debug helpers inspired by Laravel.

```ts
import { dd, dump } from '@boostkit/core'

// dump() — pretty-prints to the terminal and continues
dump({ user, session })

// dd() — pretty-prints then terminates the process (server restart required)
dd(req.body)
```

`dd` stands for *dump and die*. Both accept multiple arguments and format them with `JSON.stringify` + 2-space indent.

> In the playground, visit `GET /api/debug/dump` and `GET /api/debug/dd` to see these in action.

---

## `env()`

Simple helper for reading a string env variable — consistent with `config()` and `dd()`.

```ts
import { env } from '@boostkit/support'

env('APP_NAME', 'BoostKit')   // → 'BoostKit'
env('APP_ENV')                // throws if missing and no fallback
```

For typed access use `Env`:

## `Env`

Type-safe access to `process.env`.

```ts
import { Env } from '@boostkit/support'

Env.get('APP_NAME', 'BoostKit')       // string  (throws if missing and no fallback)
Env.getNumber('PORT', 3000)           // number
Env.getBool('APP_DEBUG', false)       // boolean
Env.has('REDIS_URL')                  // boolean
```

---

## `defineEnv()`

Validate environment variables at startup using a Zod schema. Throws with a clear error listing all missing/invalid keys.

```ts
import { defineEnv } from '@boostkit/support'
import { z } from 'zod'

const env = defineEnv(z.object({
  DATABASE_URL: z.string().url(),
  PORT:         z.coerce.number().default(3000),
  APP_DEBUG:    z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
}))

env.PORT      // number
env.APP_DEBUG // boolean
```

---

## `Collection<T>`

Fluent wrapper around arrays.

```ts
import { Collection } from '@boostkit/support'

const users = Collection.of([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])

users.count()                    // 2
users.first()                    // { id: 1, name: 'Alice' }
users.pluck('name').toArray()    // ['Alice', 'Bob']
users.filter(u => u.id > 1).all() // [{ id: 2, name: 'Bob' }]
users.groupBy('name')            // { Alice: [...], Bob: [...] }
```

---

## General helpers

```ts
import { sleep, ucfirst, pick, omit, tap, deepClone, isObject, toSnakeCase, toCamelCase } from '@boostkit/support'

await sleep(500)                                  // delay ms
ucfirst('hello world')                            // 'Hello world'
pick({ id: 1, name: 'A', secret: 'x' }, ['id', 'name'])  // { id: 1, name: 'A' }
omit({ id: 1, secret: 'x' }, ['secret'])          // { id: 1 }
tap(new Map(), m => m.set('key', 1))              // returns the Map after calling fn
toSnakeCase('fooBarBaz')                          // 'foo_bar_baz'
toCamelCase('foo_bar_baz')                        // 'fooBarBaz'
```

---

## Notes

- All helpers are also re-exported from `@boostkit/core` — you rarely need to import `@boostkit/support` directly.
- `resolveOptionalPeer()` resolves optional package integrations from the app root (used internally by adapters).
