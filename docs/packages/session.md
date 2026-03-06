# @boostkit/session

HTTP session support for BoostKit — signed cookie sessions (default) and Redis-backed sessions, with a static `Session` facade and per-request `req.session`.

## Installation

```bash
pnpm add @boostkit/session
```

For Redis sessions, also install:

```bash
pnpm add ioredis
```

## Setup

### 1. Config

```ts
// config/session.ts
import { Env } from '@boostkit/support'
import type { SessionConfig } from '@boostkit/session'

export default {
  driver:   Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  lifetime: 120,  // minutes
  secret:   Env.get('SESSION_SECRET', 'change-me-in-production'),
  cookie: {
    name:     'boostkit_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
```

Export it from `config/index.ts`:

```ts
import session from './session.js'
export default { ..., session }
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { session } from '@boostkit/session'
import configs from '../config/index.js'

export default [
  // ...
  session(configs.session),
  // ...
]
```

### 3. Add session middleware to routes

Session middleware should be applied to web routes only — not API routes (those use stateless auth tokens).

```ts
// routes/web.ts
import { Route } from '@boostkit/router'
import { SessionMiddleware } from '@boostkit/session'
import { CsrfMiddleware } from '@boostkit/middleware'

const webMw = [SessionMiddleware(), CsrfMiddleware()]

Route.get('/dashboard', handler, webMw)
Route.post('/contact',  handler, webMw)
```

---

## Usage

### `req.session`

The `SessionInstance` is available on every request that passes through `SessionMiddleware()`:

```ts
Route.get('/profile', (req, res) => {
  // Read a value
  const name = req.session.get<string>('name')

  // Write a value
  req.session.put('visits', (req.session.get<number>('visits') ?? 0) + 1)

  // Delete a value
  req.session.forget('temp')

  // Clear all data
  req.session.flush()

  res.json({ visits: req.session.get('visits') })
}, webMw)
```

### `Session` Facade

Use the static `Session` facade anywhere within a request context (requires `SessionMiddleware()` to be active):

```ts
import { Session } from '@boostkit/session'

Session.put('theme', 'dark')
const theme = Session.get<string>('theme')
Session.forget('theme')
```

### Flash Data

Flash data is only available on the **next** request — useful for success/error messages after redirects:

```ts
// Set flash data (available on next request)
Session.flash('success', 'Post created successfully!')
req.session.flash('error', 'Something went wrong.')

// Read flash from previous request
const msg = Session.getFlash<string>('success')
```

### Session ID

```ts
const id = req.session.id()         // current session ID (UUID)
await req.session.regenerate()      // new ID, same data (after login to prevent fixation)
```

### Reading All Data

```ts
const all = req.session.all()  // { key: value, ... }
const has = req.session.has('cart')
```

---

## API Reference

### `SessionInstance`

| Method | Description |
|---|---|
| `get<T>(key, fallback?)` | Read a session value. Returns `fallback` if the key does not exist. |
| `put(key, value)` | Write a session value. |
| `forget(key)` | Delete a session value. |
| `flush()` | Clear all session data. |
| `flash(key, value)` | Store a value that will be readable on the *next* request via `getFlash()`. |
| `getFlash<T>(key, fallback?)` | Read a flash value set by the *previous* request. |
| `has(key)` | Check whether a key exists in the session. |
| `all()` | Return a shallow copy of all session data. |
| `id()` | Return the current session ID. |
| `regenerate()` | Assign a new session ID (destroy old in Redis, keep data). |
| `save(res)` | Persist session and write `Set-Cookie` header — called automatically by middleware. |

### `Session` Facade

Mirrors `SessionInstance` as static methods. Backed by `AsyncLocalStorage` — safe to use in any async code within a request.

```ts
import { Session } from '@boostkit/session'

Session.get<T>(key, fallback?)
Session.put(key, value)
Session.forget(key)
Session.flush()
Session.flash(key, value)
Session.getFlash<T>(key, fallback?)
Session.has(key)
Session.all()
Session.regenerate()
```

Throws `[BoostKit Session] No session in context` if called outside a request wrapped by `SessionMiddleware()`.

### `SessionMiddleware()`

Zero-config factory that reads session config from the DI container. Requires `session(config)` provider to be registered.

```ts
import { SessionMiddleware } from '@boostkit/session'

Route.get('/settings', handler, [SessionMiddleware()])
```

### `sessionMiddleware(config)`

Lower-level version that takes config directly — use when you don't have a service provider registered.

```ts
import { sessionMiddleware } from '@boostkit/session'

const mw = sessionMiddleware(myConfig)
```

### `session(config)`

Provider factory for `bootstrap/providers.ts`. Binds `session.config` to the DI container so `SessionMiddleware()` can find it.

---

## Drivers

### Cookie Driver (default)

- No external dependencies.
- Session data is serialised as JSON, base64url-encoded, and signed with HMAC-SHA256 using `config.secret`.
- Tampered or missing cookies start a fresh empty session — no error thrown.
- The entire session payload is stored client-side (cookie size limits apply, ~4 KB).

### Redis Driver

- Requires `ioredis` (`pnpm add ioredis`).
- Session ID is stored in the cookie; data lives in Redis under `{prefix}{id}`.
- TTL is set per `config.lifetime` (minutes → seconds).

```ts
{
  driver: 'redis',
  redis: {
    url:      'redis://localhost:6379',
    prefix:   'session:',
    // or: host, port, password
  },
}
```

---

## `SessionConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'cookie' \| 'redis'` | `'cookie'` | Session storage driver |
| `lifetime` | `number` | `120` | Session lifetime in **minutes** |
| `secret` | `string` | — | HMAC signing secret (cookie driver) |
| `cookie.name` | `string` | `'boostkit_session'` | Cookie name |
| `cookie.secure` | `boolean` | `false` | Send cookie over HTTPS only |
| `cookie.httpOnly` | `boolean` | `true` | Prevent JS access to cookie |
| `cookie.sameSite` | `'lax' \| 'strict' \| 'none'` | `'lax'` | SameSite policy |
| `cookie.path` | `string` | `'/'` | Cookie path |
| `redis.url` | `string?` | — | Redis connection URL |
| `redis.host` | `string?` | `'127.0.0.1'` | Redis host (if not using URL) |
| `redis.port` | `number?` | `6379` | Redis port |
| `redis.password` | `string?` | — | Redis password |
| `redis.prefix` | `string?` | `'session:'` | Redis key prefix |

---

## Notes

- Apply `SessionMiddleware()` to **web routes only** — API routes should use stateless auth (tokens/cookies managed by `@boostkit/auth`).
- `SessionMiddleware()` and `CsrfMiddleware()` are typically combined for web routes since CSRF validation depends on an established session.
- The cookie driver stores all data in the cookie — keep values small. Use the Redis driver for larger payloads.
- Session data is saved automatically after the route handler returns. Manual `save()` calls are not needed.
