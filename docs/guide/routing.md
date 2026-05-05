# Routing

Routes are declared as side effects in `routes/web.ts`, `routes/api.ts`, and `routes/console.ts`. The framework loads them lazily on the first matching request. The same global `router` (also exported as `Route`) backs every entry point.

## Basic routes

```ts
// routes/api.ts
import { router } from '@rudderjs/router'

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

router.post('/api/users', async (req, res) => {
  const user = await User.create(req.body as any)
  return res.status(201).json({ data: user })
})

router.put   ('/api/users/:id', updateHandler)
router.patch ('/api/users/:id', patchHandler)
router.delete('/api/users/:id', deleteHandler)
```

| Method | Description |
|---|---|
| `router.get(path, handler, mw?)` | GET |
| `router.post(path, handler, mw?)` | POST |
| `router.put(path, handler, mw?)` | PUT |
| `router.patch(path, handler, mw?)` | PATCH |
| `router.delete(path, handler, mw?)` | DELETE |
| `router.all(path, handler, mw?)` | Any method |
| `router.add(method, path, handler, mw?)` | Explicit method string |

Routes match in registration order. Put catch-alls last:

```ts
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Not found' }))
```

## Route parameters

Path segments prefixed with `:` are captured into `req.params`:

```ts
router.get('/api/posts/:slug', async (req, res) => {
  const post = await Post.where('slug', req.params.slug).first()
  return res.json({ post })
})
```

Optional segments end with `?` (`/posts/:category?/:slug`).

## Named routes

Chain `.name()` to assign a name. Pair with `route()` for URL generation:

```ts
import { router, route } from '@rudderjs/router'

router.get('/users/:id', handler).name('users.show')

route('users.show', { id: 42 })            // → '/users/42'
route('search', { q: 'hello', page: 2 })   // → '/search?q=hello&page=2'
```

`route()` substitutes named params from the object and appends unused keys as a query string. Missing required params throw.

## Per-route middleware

Pass middleware as the third argument:

```ts
import { RequireAuth } from '@rudderjs/auth'
import { RateLimit } from '@rudderjs/middleware'

router.post('/api/posts', handler, [RequireAuth()])

router.post('/api/auth/sign-in', handler, [
  RateLimit.perMinute(5).message('Too many login attempts.'),
])
```

For middleware that should apply to every web or api route, register it on the group instead — see [Middleware](/guide/middleware).

## Route groups

`router.group(opts, fn)` applies a `prefix`, `domain`, or shared `middleware` stack to every route registered inside the callback:

```ts
import { router } from '@rudderjs/router'

router.group({ prefix: '/admin', middleware: [adminAuth] }, () => {
  router.get('/users', listUsers)            // GET /admin/users (with adminAuth)
  router.get('/posts', listPosts)            // GET /admin/posts (with adminAuth)
})

// Nested
router.group({ prefix: '/api' }, () => {
  router.group({ prefix: '/v1', middleware: [throttle] }, () => {
    router.get('/users', listUsers)          // GET /api/v1/users (with throttle)
  })
})
```

Nested groups concatenate prefixes and middleware; the innermost defined `domain` wins (hosts can't compose). Routes outside any `group()` callback are unaffected.

> `router.group()` is the user-facing scoping primitive. The framework's web/api middleware-group label (the one that runs `m.web(...)` / `m.api(...)` middleware) is wired automatically by `withRouting()` and is unrelated to user-facing `group()`.

## Subdomain routing

Restrict a route to a specific host. The template matches the request's `Host` header (port stripped, case-insensitive); `:param` segments capture into `req.params` alongside path params.

```ts
router.get('/users', listUsers).domain('api.example.com')

router.get('/me', me).domain(':tenant.example.com')
// req.params.tenant === 'acme' for Host: acme.example.com

router.group({ domain: 'admin.example.com', middleware: [adminAuth] }, () => {
  router.get('/dashboard', dash)             // GET admin.example.com/dashboard
})
```

Mismatched hosts return 404. When a subdomain `:param` and path `:param` share a name, the path value wins.

## Signed URLs

Signed URLs append an HMAC-SHA256 `signature` query parameter. Use them for password reset links, file downloads, email-confirmation tokens, anything where access should be gated by URL knowledge alone. The key comes from `process.env.APP_KEY`.

```ts
import { Url } from '@rudderjs/router'

// Permanent
Url.signedRoute('invoice.download', { id: 42 })

// Expires in 1 hour
Url.temporarySignedRoute('invoice.download', 3600, { id: 42 })

// Sign an arbitrary path
Url.sign('/any/path', new Date(Date.now() + 60_000))
```

Validate signed requests with the `ValidateSignature()` middleware:

```ts
import { ValidateSignature } from '@rudderjs/router'

router.get('/invoice/:id/download', handler, [ValidateSignature()])
  .name('invoice.download')
```

The middleware rejects missing, invalid, or expired signatures with HTTP 403. Comparison is timing-safe.

| `Url` method | Description |
|---|---|
| `Url.signedRoute(name, params?, expiresAt?)` | Signed URL for a named route |
| `Url.temporarySignedRoute(name, seconds, params?)` | Expiring signed URL |
| `Url.sign(path, expiresAt?)` | Sign an arbitrary path |
| `Url.isValidSignature(req)` | Validate a request's signature |
| `Url.current(req)` | Full current URL |
| `Url.previous(req, fallback?)` | Referer header or fallback |
| `Url.setKey(key)` | Override the signing key (for tests) |

## Route model binding

Bind a `:param` segment to a Model class so the router resolves it into an instance before your handler runs:

```ts
import { router } from '@rudderjs/router'
import { User } from '../app/Models/User.js'

router.bind('user', User)
router.get('/users/:user', (req) => {
  const user = req.bound!['user'] as User
  return user.toJSON()
})
```

The default resolver runs `User.findForRoute(value)` (which delegates to `Model.where(routeKey, value).first()`); override `static routeKey` on your model to resolve by slug or another unique column. Pass `{ optional: true }` to set `req.bound!.name = null` instead of throwing when no record matches.

A non-resolving required binding throws `RouteModelNotFoundError`; the framework's HTTP layer renders that as a 404. See the [route binding section in Models](/guide/database/models#route-model-binding) for resolver overrides.

Override the response per route with `.missing()`:

```ts
router.get('/users/:user', show)
  .missing((_req, err) => Response.json({ error: err.message }, { status: 404 }))

router.get('/posts/:post', show)
  .missing((_req, err) => ({ message: `Post ${err.value} not found` }))
```

The callback receives the request and the binding error; return a `Response`, plain object → JSON, string → body, or `undefined` (callback wrote to `res` directly). Optional bindings do NOT trigger `.missing()`.

## Decorator controllers

For routes that share a prefix or middleware, group them into a controller class. See [Controllers](/guide/controllers).

## Inspecting routes

```bash
pnpm rudder route:list      # all registered routes, with name + middleware
```

The router also exposes a programmatic API: `router.list()` returns every `RouteDefinition`; `router.listNamed()` returns the name → path map.

## Pitfalls

- **Catch-all order.** `router.all('/api/*', ...)` must be the last route declared, or it'll swallow more specific ones.
- **Decorator controllers without `reflect-metadata`.** Add `import 'reflect-metadata'` once at `bootstrap/app.ts`.
- **`APP_KEY` not set.** `Url.signedRoute()` and `ValidateSignature()` both throw when no key is configured.
- **Double slashes.** Path composition normalizes them automatically — `/api` + `/users` is `/api/users`, not `/api//users`.
