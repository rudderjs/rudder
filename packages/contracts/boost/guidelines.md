# @rudderjs/contracts

## Overview

Shared type language for all `@rudderjs/*` packages. Defines `AppRequest`, `AppResponse`, `RouteHandler`, `MiddlewareHandler`, `QueryBuilder`, `OrmAdapter`, `ServerAdapter`, and their supporting types. **All types are re-exported from `@rudderjs/core`** — application code almost never imports from `@rudderjs/contracts` directly. Import from here only when you're writing a package that cannot depend on core (e.g. another framework package earlier in the dependency chain).

## Key Patterns

### `AppRequest` fields

| Field | Type | Notes |
|---|---|---|
| `method` | `string` | Uppercase (`'GET'`, `'POST'`, etc.) |
| `url` | `string` | Full URL including query string |
| `path` | `string` | Pathname only |
| `params` | `Record<string, string>` | Route path params |
| `query` | `Record<string, string>` | Query string params |
| `headers` | `Record<string, string>` | Lowercased headers |
| `body` | `unknown` | Parsed JSON / form body |
| `ip?` | `string` | Client IP — set when `trustProxy: true`, `undefined` otherwise |
| `user?` | `AuthUser` | Added by `@rudderjs/auth` via module augmentation |
| `session?` | `SessionInstance` | Added by `@rudderjs/session` via module augmentation |
| `token?` | _(package-specific)_ | Added by `@rudderjs/passport` / `@rudderjs/sanctum` via module augmentation |
| `bound?` | `Record<string, unknown>` | Resolved route model bindings from `router.bind()` |
| `raw` | `unknown` | Underlying adapter request — cast as needed |

### Typed input accessors

```ts
req.string('name')              // '' if missing
req.integer('page', 1)          // throws InputTypeError if not parseable
req.float('price', 0.0)
req.boolean('active', false)    // truthy: 'true'/'1'/'yes'/'on'
req.date('created_at')          // throws if not a valid date
req.array('ids', [])            // also parses CSV and JSON arrays
req.input('key')                // raw unknown — use for unknown shapes
req.has('name')                 // true if present in any source
req.missing('name')             // true if absent
req.filled('name')              // true if present AND non-empty
```

Merge priority: `params` > `body` > `query`.

### `AppResponse` methods

```ts
res.status(201).json({ id: 1 })    // chained status + JSON
res.status(204).send('')           // empty body
res.header('X-Custom', 'value').json({ ok: true })
res.redirect('/login', 302)
```

### `RouteHandler` / `MiddlewareHandler`

```ts
import type { RouteHandler, MiddlewareHandler } from '@rudderjs/core'

const handler: RouteHandler = async (req, res) => {
  return res.json({ user: req.user })
}

const auth: MiddlewareHandler = async (req, res, next) => {
  if (!req.headers['authorization']) return res.status(401).json({ message: 'Unauthorized' })
  await next()
}
```

### `attachInputAccessors` — for adapter authors

```ts
import { attachInputAccessors } from '@rudderjs/contracts'

// Called once per request in the adapter's request normalizer.
// Attaches string/integer/boolean/etc. methods to the plain req object.
attachInputAccessors(req)
```

Only needed when writing a custom server adapter. `@rudderjs/server-hono` calls this automatically.

### `InputTypeError`

```ts
import { InputTypeError } from '@rudderjs/contracts'

try {
  const age = req.integer('age')
} catch (err) {
  if (err instanceof InputTypeError) {
    // err.message: 'Input "age" expected integer, got string.'
  }
}
```

## Common Pitfalls

- **Importing from `@rudderjs/contracts` in app code.** Import from `@rudderjs/core` instead — all types are re-exported, same result with fewer package deps.
- **Accessing `req.user` without auth middleware.** `user` is `undefined` when `AuthMiddleware` hasn't run (api routes, unprotected web routes). Cast after a null check or use the typed accessor from `@rudderjs/auth`. (`user` is typed as `AuthUser` by `@rudderjs/auth`'s module augmentation — it is not declared in the base contracts interface.)
- **Accessing `req.session` on api routes.** Sessions are web-only by default. `req.session` is `undefined` on api routes. Use per-route `SessionMiddleware()` if you need session on a specific api endpoint.
- **Reading `req.ip` when `trustProxy` is false.** Returns `undefined`. Set `trustProxy: true` in your server config when behind a load balancer or reverse proxy.
- **`attachInputAccessors` called twice.** Calling it again on the same object re-defines the methods (idempotent but wasteful). Server adapters call it once in their request normalizer.

## Key Imports

```ts
// Prefer importing from core in app code
import type { AppRequest, AppResponse, RouteHandler, MiddlewareHandler } from '@rudderjs/core'
import { InputTypeError } from '@rudderjs/core'

// Direct import — only in packages that can't depend on core
import type { AppRequest, AppResponse, QueryBuilder, OrmAdapter } from '@rudderjs/contracts'
import { attachInputAccessors, InputTypeError } from '@rudderjs/contracts'
```
