# @boostkit/support

Shared utility primitives — collections, env access, config lookup, and helper functions.

```bash
pnpm add @boostkit/support
```

---

## Env

`Env` provides typed access to environment variables. It reads from `process.env` and supports optional fallback values.

```ts
import { Env } from '@boostkit/support'

const port    = Env.getNumber('PORT', 3000)
const debug   = Env.getBool('APP_DEBUG', false)
const secret  = Env.require('AUTH_SECRET')      // throws if missing
const appName = Env.get('APP_NAME', 'MyApp')
```

### Env Methods

| Method | Signature | Description |
|---|---|---|
| `get` | `(key: string, fallback?: string) => string \| undefined` | Returns the env value or the fallback. Returns `undefined` if both are absent. |
| `getNumber` | `(key: string, fallback?: number) => number` | Returns the env value coerced to a number, or the fallback. |
| `getBool` | `(key: string, fallback?: boolean) => boolean` | Returns `true` for `'true'`, `'1'`, `'yes'`; `false` otherwise. Falls back to `fallback` if the variable is unset. |
| `require` | `(key: string) => string` | Returns the env value or throws a descriptive error if the variable is missing. |

---

## defineEnv

`defineEnv` validates your environment variables at startup using a Zod schema. It throws an aggregated error listing all invalid or missing variables before the application boots.

```ts
import { defineEnv } from '@boostkit/support'
import { z } from 'zod'

export const env = defineEnv({
  APP_NAME:     z.string().min(1),
  APP_ENV:      z.enum(['development', 'production', 'test']).default('development'),
  PORT:         z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET:  z.string().min(32),
})

// env.APP_NAME, env.PORT, etc. are fully typed
```

---

## Collection

`Collection<T>` is a typed wrapper around an array with a rich chainable API, inspired by Laravel Collections.

```ts
import { Collection } from '@boostkit/support'

const users = new Collection([
  { id: 1, name: 'Alice', role: 'admin' },
  { id: 2, name: 'Bob',   role: 'user' },
  { id: 3, name: 'Carol', role: 'admin' },
])

const adminNames = users
  .filter(u => u.role === 'admin')
  .pluck('name')
  .toArray()
// ['Alice', 'Carol']

const byRole = users.groupBy('role')
// { admin: [...], user: [...] }

const chunks = users.chunk(2)
// [[{...}, {...}], [{...}]]
```

### Collection Methods

| Method | Description |
|---|---|
| `map<U>(fn)` | Transforms each item and returns a new `Collection<U>`. |
| `filter(fn)` | Keeps items matching the predicate. Returns a new `Collection<T>`. |
| `find(fn)` | Returns the first item matching the predicate, or `undefined`. |
| `first()` | Returns the first item, or `undefined`. |
| `last()` | Returns the last item, or `undefined`. |
| `chunk(size)` | Splits the collection into an array of `Collection<T>` chunks of the given size. |
| `pluck(key)` | Extracts a single field from each item. Returns a new `Collection`. |
| `unique(key?)` | Removes duplicate items. Optionally de-duplicates by a field key. |
| `groupBy(key)` | Groups items into a `Record<string, T[]>` by the given field. |
| `toArray()` | Returns the underlying array. |
| `count()` | Returns the number of items. |
| `isEmpty()` | Returns `true` if the collection contains no items. |

---

## ConfigRepository

`ConfigRepository` holds typed runtime configuration loaded from your `config/` files. It is set up automatically by `Application.configure()` and available via the `config()` helper.

```ts
import { config } from '@boostkit/support'

const port    = config<number>('server.port', 3000)
const appName = config<string>('app.name', 'Forge')
```

### ConfigRepository API

| Function | Signature | Description |
|---|---|---|
| `config` | `<T>(key: string, defaultValue?: T) => T` | Retrieves a value from the config repository using dot notation. |
| `setConfigRepository` | `(repo: ConfigRepository) => void` | Sets the global config repository instance. Called internally by `Application.configure()`. |

---

## resolveOptionalPeer

`resolveOptionalPeer` resolves an optional peer dependency at runtime without causing bundler errors when the package is absent.

```ts
import { resolveOptionalPeer } from '@boostkit/support'

const router = await resolveOptionalPeer('@boostkit/router')
if (router) {
  // use router
}
```

This is used internally by `@boostkit/core` to load `@boostkit/router` at runtime without creating a static dependency that Turbo would see as a cycle.

---

## Helper Functions

General-purpose utility functions exported from `@boostkit/support`.

| Function | Signature | Description |
|---|---|---|
| `sleep` | `(ms: number) => Promise<void>` | Resolves after `ms` milliseconds. |
| `ucfirst` | `(str: string) => string` | Capitalises the first character of a string. |
| `toSnakeCase` | `(str: string) => string` | Converts a camelCase or PascalCase string to `snake_case`. |
| `toCamelCase` | `(str: string) => string` | Converts a snake_case string to `camelCase`. |
| `isObject` | `(value: unknown) => boolean` | Returns `true` if the value is a plain object (not an array or null). |
| `deepClone` | `<T>(value: T) => T` | Returns a deep clone using `structuredClone`. |
| `pick` | `<T, K extends keyof T>(obj: T, keys: K[]) => Pick<T, K>` | Returns a new object with only the specified keys. |
| `omit` | `<T, K extends keyof T>(obj: T, keys: K[]) => Omit<T, K>` | Returns a new object with the specified keys removed. |
| `tap` | `<T>(value: T, fn: (v: T) => void) => T` | Calls `fn` with `value` then returns `value`. Useful for side effects in a chain. |

---

## Notes

- `sideEffects: false` — this package is fully tree-shakable. Bundlers can eliminate any import that is not used.
- `defineEnv` validates `process.env` eagerly at module evaluation time. If validation fails, it throws a `ZodError` (or a formatted aggregate error) before your application starts. This surfaces misconfigured environments at boot rather than at runtime.
- `resolveOptionalPeer` uses a dynamic `await import('node:module')` internally. Do not hoist `createRequire` to the top of a module that is part of a browser bundle — the dynamic import keeps it tree-shakable.
