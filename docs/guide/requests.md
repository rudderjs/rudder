# Requests

Every route handler and middleware receives an `AppRequest` — a normalized request object with typed accessors over the body, query string, route params, and headers. The object is the same shape regardless of which server adapter handles the request.

```ts
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

router.post('/api/users', async (req: AppRequest, res: AppResponse) => {
  const name  = req.string('name')
  const email = req.string('email')
  const role  = req.string('role', 'user')

  const user = await User.create({ name, email, role })
  return res.status(201).json({ data: user })
})
```

## Standard fields

| Field | Type | Description |
|---|---|---|
| `req.method` | `string` | HTTP method (`'GET'`, `'POST'`, …) |
| `req.url` | `string` | Full URL including query string |
| `req.path` | `string` | URL path only |
| `req.query` | `Record<string, string>` | Parsed query string |
| `req.params` | `Record<string, string>` | Route parameters captured by `:slug` segments |
| `req.headers` | `Record<string, string>` | Request headers (lowercased keys) |
| `req.body` | `unknown` | Parsed body (JSON, form-encoded, or raw) |
| `req.ip` | `string \| undefined` | Client IP, normalized — see below |
| `req.raw` | `unknown` | Adapter-specific raw request (escape hatch) |

## Typed input accessors

The same data lives in `params`, `query`, and `body` — fetching by source means three different lookups. Use the input accessors instead. They merge all three sources (priority: **`params` > `body` > `query`**), parse the value to a known type, and throw a clear `InputTypeError` if the input doesn't fit.

```ts
const id    = req.integer('id')
const page  = req.integer('page', 1)
const since = req.date('since', new Date(0))
const flag  = req.boolean('active', false)
const tags  = req.array('tags')              // accepts arrays, "a,b,c", or '["a","b"]'
```

| Method | Returns | Notes |
|---|---|---|
| `req.input<T>(key, fallback?)` | `T` | Raw merged value |
| `req.string(key, fallback?)` | `string` | Throws on object/array values |
| `req.integer(key, fallback?)` | `number` | Throws on non-parseable |
| `req.float(key, fallback?)` | `number` | Throws on non-parseable |
| `req.boolean(key, fallback?)` | `boolean` | Truthy: `true`, `'1'`, `'yes'`, `'on'` |
| `req.date(key, fallback?)` | `Date` | Throws on non-parseable |
| `req.array(key, fallback?)` | `unknown[]` | Accepts arrays, CSV strings, JSON arrays |
| `req.has(key)` | `boolean` | Key present in any source |
| `req.missing(key)` | `boolean` | Key absent from all sources |
| `req.filled(key)` | `boolean` | Key present and value is non-empty |

These are the right tool for a quick endpoint or controller. For complex validation across multiple fields, see [Validation](/guide/validation) — `validate()` and `FormRequest` give you Zod schemas with structured 422 responses.

## Client IP

`req.ip` is set by the server adapter. With `TRUST_PROXY=true`, proxy headers win — the **rightmost** `x-forwarded-for` entry (the address the trusted proxy appended; set `TRUST_PROXY` to a number N to trust N chained proxies and read the Nth-from-right entry), then `x-real-ip`; with it off, client-sent proxy headers are ignored. The rightmost (never the leftmost) entry is the one a client can't forge, since a proxy appends its observed peer to whatever the client sent. In every case the direct socket address is the fallback wherever the runtime exposes one (the production vike server and `adapter.listen()` both do; in dev the `rudderjs:ip` Vite plugin injects a stand-in header). It normalizes IPv6 loopback (`::1` → `127.0.0.1`). The type is `string | undefined` — undefined only on edge runtimes with no socket and no trusted header.

```ts
const limiter = RateLimit.perMinute(60).by((req) => req.user?.id ?? req.ip)
```

Always read `req.ip` instead of pulling raw headers — the server normalizes for you, and a custom `.by()` function reading raw headers will get inconsistent results across dev and production.

## Authenticated user

When a route runs through the `web` middleware group, `AuthMiddleware` populates `req.user`:

```ts
Route.get('/dashboard', (req, res) => {
  if (!req.user) return res.redirect('/login')
  return res.json({ user: req.user })
})
```

API routes are stateless by default — `req.user` is undefined unless you opt into bearer auth per-route with `RequireBearer()` from `@rudderjs/passport`. See [Middleware](/guide/middleware).

## Session

When `@rudderjs/session` is installed, the session middleware (auto-installed on the `web` group) attaches a request-scoped store. Read it via the `Session` facade — never directly off `req`:

```ts
import { Session } from '@rudderjs/session'

const flash = Session.getFlash('flash.success')
Session.put('lastViewedAt', Date.now())
```

The facade reads from AsyncLocalStorage, so it works inside controllers, services, and helpers without threading `req` through every call.

## Headers

Headers are lowercased on the way in to make lookups case-insensitive:

```ts
const ua    = req.headers['user-agent']
const auth  = req.headers['authorization']
const trace = req.headers['x-request-id'] ?? crypto.randomUUID()
```

## File uploads

Multipart uploads parse into `req.body` as a structure with named files. Use `@rudderjs/storage` to persist them:

```ts
import { Storage } from '@rudderjs/storage'

router.post('/api/avatars', async (req, res) => {
  const file = (req.body as { avatar: File }).avatar
  const path = await Storage.disk('s3').put(`avatars/${file.name}`, file)
  return res.status(201).json({ path })
})
```

## Pitfalls

- **`req.params` is `Record<string, string>` only.** Numeric `:id` arrives as a string. Use `req.integer('id')` if you need a number.
- **Object/array bodies in `req.string(key)`.** `req.string()` throws if the input is an object or array — use `req.input(key)` for the raw value or pass through `validate()` for nested shapes.
- **Headers as arrays.** Some adapters surface multi-value headers; the normalized `req.headers` flattens them to a single string. For multi-value headers reach into `req.raw`.
- **Reading raw IP headers in `RateLimit.by()`.** Use `req.ip` — the dev-mode Vite plugin injects `x-real-ip` from the Node socket, but only `req.ip` reads it correctly across environments.
