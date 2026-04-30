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
