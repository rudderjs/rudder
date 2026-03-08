# @boostkit/session

HTTP session support for BoostKit — signed cookie sessions (default) and Redis-backed sessions.

```bash
pnpm add @boostkit/session
```

For Redis sessions, also install `ioredis`:

```bash
pnpm add ioredis
```

---

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
} satisfies SessionConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { session } from '@boostkit/session'
import configs from '../config/index.js'

export default [
  session(configs.session),
]
```

### 3. Add middleware to routes

```ts
// routes/web.ts
import { Route } from '@boostkit/router'
import { SessionMiddleware } from '@boostkit/session'

const webMw = [SessionMiddleware()]

Route.get('/dashboard', handler, webMw)
Route.post('/contact',  handler, webMw)
```

---

## Usage

### `req.session`

```ts
Route.get('/profile', (req, res) => {
  const visits = (req.session.get<number>('visits') ?? 0) + 1
  req.session.put('visits', visits)
  res.json({ visits })
}, webMw)
```

### `Session` facade

```ts
import { Session } from '@boostkit/session'

Session.put('theme', 'dark')
const theme = Session.get<string>('theme')
Session.forget('theme')
```

### Flash data

```ts
// Set on this request — available on the next request only
Session.flash('success', 'Post created!')
req.session.flash('error', 'Something went wrong.')

// Read on the next request
const msg = Session.getFlash<string>('success')
```

### Session ID

```ts
const id = req.session.id()       // current session ID
await req.session.regenerate()    // new ID, same data (use after login)
```

---

## API

### `SessionInstance`

| Method | Description |
|---|---|
| `get<T>(key, fallback?)` | Read a value. Returns `fallback` if missing. |
| `put(key, value)` | Write a value. |
| `forget(key)` | Delete a value. |
| `flush()` | Clear all session data. |
| `flash(key, value)` | Store a value readable on the *next* request via `getFlash()`. |
| `getFlash<T>(key, fallback?)` | Read a flash value set by the *previous* request. |
| `has(key)` | Check whether a key exists. |
| `all()` | Return a shallow copy of all session data. |
| `id()` | Return the current session ID. |
| `regenerate()` | Assign a new session ID (destroys old in Redis, keeps data). |

### `Session` facade

Mirrors `SessionInstance` as static methods, backed by `AsyncLocalStorage`. Throws if called outside a request wrapped by `SessionMiddleware()`.

`get` · `put` · `forget` · `flash` · `getFlash` · `has` · `all` · `regenerate`

---

## Drivers

### `cookie` (default)

Session data is JSON-serialised, base64url-encoded, and signed with HMAC-SHA256. No external dependencies. The entire payload is stored in the cookie (~4 KB limit).

### `redis`

Session ID is stored in the cookie; data lives in Redis under `{prefix}{id}`. Requires `ioredis`.

```ts
{
  driver: 'redis',
  redis: {
    url:    'redis://localhost:6379',
    prefix: 'session:',
  },
}
```

---

## Notes

- Apply `SessionMiddleware()` to web routes only — API routes should use stateless auth.
- Session is saved automatically after the route handler returns; no manual `save()` needed.
- The cookie driver stores all data client-side — keep values small. Use Redis for larger payloads.
- `SessionMiddleware()` reads config from the DI container. Use `sessionMiddleware(config)` for manual wiring without a provider.
