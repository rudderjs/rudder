# @rudderjs/session

## Overview

HTTP session support — signed cookie sessions (default) and Redis-backed sessions. Provides `SessionInstance` on `req.session`, the `Session` facade (AsyncLocalStorage-backed), flash data, and session ID regeneration. Auto-installs on the `web` route group via `appendToGroup('web', sessionMiddleware(cfg))` — apps do NOT need to wire it manually.

## Key Patterns

### Setup

```ts
// config/session.ts
export default {
  driver:   'cookie',                 // or 'redis'
  lifetime: 120,                       // minutes
  secret:   process.env.SESSION_SECRET,
  cookie: {
    name:     'rudderjs_session',
    secure:   true,
    httpOnly: true,
    sameSite: 'lax',
  },
} satisfies SessionConfig

// bootstrap/providers.ts
import { session } from '@rudderjs/session'
export default [session(configs.session)]
```

No per-route wiring needed on web routes — the provider auto-installs on the `web` group during `boot()`.

### Reading and writing

```ts
// req.session is typed on every web request
Route.get('/profile', (req, res) => {
  const visits = (req.session.get<number>('visits') ?? 0) + 1
  req.session.put('visits', visits)
  res.json({ visits })
})

// Session facade — works anywhere inside a middleware-wrapped request
import { Session } from '@rudderjs/session'

Session.put('theme', 'dark')
const theme = Session.get<string>('theme')
Session.forget('theme')
```

### Flash data

Available on the **next** request only — typically used for post-redirect messages:

```ts
Session.flash('success', 'Post created!')   // set on this request
// ...redirect...
Session.getFlash<string>('success')         // readable on the next request; cleared after read
```

### Session ID and regeneration

Always regenerate after login to prevent session fixation:

```ts
const id = req.session.id()
await req.session.regenerate()   // new ID, same data
```

### API routes are stateless

API routes don't get session by default. If a specific api route needs session, mount `SessionMiddleware()` per-route:

```ts
// routes/api.ts
Route.post('/api/preferences', handler, [SessionMiddleware()])
```

## Common Pitfalls

- **`m.use(sessionMiddleware(cfg))` globally.** Don't. Doubles up with the auto-install on the `web` group, reads from two different `SessionInstance`s, and api routes get session they shouldn't have. Symptom: data set in the handler doesn't persist across requests.
- **`Session.current()` throws outside middleware.** It reads from AsyncLocalStorage; calling it outside a middleware-wrapped request has no ALS context. Use `Session.active()` for a non-throwing check, or guard with try/catch if you might be in a stateless context (`SessionGuard.user()` does this).
- **Cookie driver size limit.** The cookie driver stores all session data client-side — keep values small (~4 KB cookie limit). For larger payloads use the Redis driver.
- **Forgetting `session.regenerate()` after login.** Without it you're vulnerable to session fixation. `@rudderjs/auth`'s `Auth.login()` calls `regenerate()` automatically — if you log a user in manually, remember to regenerate.
- **Redis driver without `ioredis`.** The Redis driver lazy-loads `ioredis`. Install it as a peer: `pnpm add ioredis`.

## Key Imports

```ts
// Provider + middleware
import { session, sessionMiddleware, SessionMiddleware } from '@rudderjs/session'

// Facade
import { Session } from '@rudderjs/session'

// Types
import type { SessionConfig, SessionInstance } from '@rudderjs/session'
```
