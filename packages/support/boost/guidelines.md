# @rudderjs/support

## Overview

Shared utility primitives — `Env`, `config()`, `Collection`, `dump`/`dd` debug helpers, `resolveOptionalPeer()` for peer-dep discovery, and general-purpose functions. **All exports are re-exported from `@rudderjs/core`** — you rarely need to import from `@rudderjs/support` directly. The only reason to depend on it specifically is packages that can't depend on core (contracts, rudder).

## Key Patterns

### `Env` — typed env var access

```ts
import { Env } from '@rudderjs/core'

Env.get('APP_NAME', 'RudderJS')        // throws if missing AND no fallback
Env.getNumber('PORT', 3000)            // parses to number, throws on NaN
Env.getBool('DEBUG', false)            // accepts 'true'/'false'/'1'/'0'
```

Missing-required-env throws with a clear `"Missing environment variable: X"` message. Always provide a fallback or catch at the config layer.

### `config(key, fallback?)`

Dot-notation config lookup, populated from `config/*.ts` at bootstrap:

```ts
import { config } from '@rudderjs/core'

config('app.name')           // reads configs.app.name
config('app.debug')          // boolean
config('cache.ttl', 60)      // with typed fallback
```

**Falsy-safe**: `config('x.value', 'fallback')` returns `0`, `false`, or `''` as-is if they're actually set — the fallback only kicks in on `undefined`.

### `Collection` — typed array wrapper

Lodash-lite. Useful where a chainable, typed, immutable collection reads better than successive array methods.

```ts
import { Collection } from '@rudderjs/core'

const c = new Collection([{ id: 1, active: true }, { id: 2, active: false }])

c.filter(x => x.active)              // Collection<T> of active items
c.reject(x => x.active)              // inverse of filter
c.pluck('id')                        // Collection<number>
c.groupBy('category')                // Record<string, T[]>  ← plain arrays, NOT Collection
c.keyBy('id')                        // Record<string, T>    ← single item per key
c.partition(x => x.active)           // [Collection<T>, Collection<T>]
c.first(x => x.active)               // first match or undefined
c.chunk(100).each(batch => { /* ... */ })
```

Every chainable operation returns a new `Collection`; originals aren't mutated. Use `.filter(x => x.key === value)` instead of `.where()`. `.sortBy(key)` and `.unique(key?)` are available for ordering and deduplication.

### `dump(...)` / `dd(...)`

Debug helpers inspired by Laravel — `dump` keeps the server running, `dd` terminates.

```ts
import { dump, dd } from '@rudderjs/core'

dump({ user, session })               // pretty-print + continue
dd(req.body)                           // pretty-print + process.exit(1)
```

Both format with `JSON.stringify` at 2-space indent. **`dd()` calls `process.exit(1)`** — development only. Never leave in production code paths.

**Telescope records `dump()` / `dd()` calls** — includes arguments and caller file+line. See the `dump` entry type.

### `resolveOptionalPeer(pkg)`

Runtime import of an optional peer dependency with graceful failure:

```ts
import { resolveOptionalPeer } from '@rudderjs/core'

try {
  const redis = await resolveOptionalPeer<typeof import('ioredis')>('ioredis')
  return new redis.default(config)
} catch {
  // Peer not installed — fall back to memory driver
}
```

Used throughout the framework for optional drivers (Redis for cache/session/queue, S3 for storage, argon2 for hash, etc.). **Walks `node_modules` and reads the package's `exports['.']['import']` as a fallback** when `createRequire().resolve()` fails on ESM-only packages — more robust than a bare dynamic import.

### `ConfigRepository` (class)

Lower-level API behind the `config()` helper. You rarely need it directly — it's injected into the DI container as `'config'` by the framework:

```ts
import { app } from '@rudderjs/core'

const repo = app().make<ConfigRepository>('config')
repo.get('app.name')
repo.set('runtime.featureFlag', true)     // mutates — use sparingly
```

`set()` silently ignores keys containing `__proto__`, `constructor`, or `prototype` (prototype-pollution guard).

### `Str` — string utilities

```ts
import { Str } from '@rudderjs/core'

Str.camel('user_name')                // 'userName'
Str.snake('UserName')                 // 'user_name'
Str.kebab('UserName')                 // 'user-name'
Str.studly('user_name')               // 'UserName'
Str.title('hello world')              // 'Hello World'
Str.headline('user_profile')          // 'User Profile'

Str.slug('Hello World!')              // 'hello-world'
Str.limit('long text...', 10)         // 'long text.'
Str.words('one two three', 2)         // 'one two...'
Str.plural('post')                    // 'posts'
Str.plural('post', 1)                 // 'post'
Str.singular('categories')            // 'category'

Str.before('foo/bar', '/')            // 'foo'
Str.after('foo/bar', '/')             // 'bar'
Str.contains('hello world', 'hello')  // true
Str.startsWith('foobar', 'foo')       // true
Str.mask('4111 1111 1111 1111', '*', 0, 12) // '************ 1111'

Str.uuid()        // crypto.randomUUID()
Str.random(16)    // random alphanumeric string
Str.password(32)  // random password with symbols
```

### `Num` — number utilities

```ts
import { Num } from '@rudderjs/core'

Num.format(1234567.89, 2)    // '1,234,567.89'
Num.currency(9.99)           // '$9.99'
Num.currency(9.99, 'EUR', 'de-DE')
Num.percentage(73.5, 1)      // '73.5%'
Num.fileSize(1_048_576)      // '1.00 MB'
Num.abbreviate(1_500_000)    // '1.5M'
Num.ordinal(1)               // '1st'
Num.spell(42)                // 'forty-two'
Num.clamp(5, 1, 10)          // 5
```

### `t()` — simple template interpolation

```ts
import { t } from '@rudderjs/core'

t('Hello :name, you have :count items', { name: 'Alice', count: 3 })
// 'Hello Alice, you have 3 items'
```

Unknown placeholders are left as-is (`:key` untouched).

## Common Pitfalls

- **Importing from `@rudderjs/support` when `@rudderjs/core` works.** Just import from core — everything is re-exported. Fewer package dependencies, same result.
- **`Env.get('X')` without a fallback in a required code path.** Throws at first call. If the var is truly required, let it throw at boot; if it's optional, pass a fallback.
- **`dd()` in production.** Calls `process.exit(1)` — crashes the server. Grep for `dd(` before deploying and remove or swap to `dump(`.
- **`config('app.name')` before providers booted.** The config repo is populated at boot; calls before that return `undefined` or the fallback. Not usually an issue in handlers (which always run post-boot) but can bite in top-level module code.
- **`Collection` and mutation.** Chainable operations are immutable — `c.filter(...)` / `c.map(...)` / `c.pluck(...)` return new collections, `c` is unchanged. The terminal methods `each()` and `tap()` return `this` for fluent chaining but still don't mutate the underlying items.
- **`resolveOptionalPeer()` and ESM-only packages.** The fallback that walks `node_modules` handles most cases, but if the package's `exports` doesn't include a `default` or `import` condition, it still fails. Add `"default": "./dist/index.js"` to the peer's exports if you hit this in your own code.

## Key Imports

```ts
// Prefer importing from core — all of these are re-exported
import { Env, config, ConfigRepository, Collection, dump, dd, env, resolveOptionalPeer } from '@rudderjs/core'

// Types
import type { Env as EnvType } from '@rudderjs/core'
```
