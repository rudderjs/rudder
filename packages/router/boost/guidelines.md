# @rudderjs/router

## Overview

Decorator-based and fluent HTTP router for RudderJS. Provides a global `router` singleton (alias: `Route`), named routes, URL generation via `route()`, HMAC-signed URLs via `Url`, route-level middleware, and decorator-based controllers (`@Controller`, `@Get`, `@Post`, etc.). The router is a peer of `@rudderjs/core` — core loads it at runtime via `resolveOptionalPeer` to avoid a dependency cycle.

## Key Patterns

### Fluent routes

```ts
import { router, Route } from '@rudderjs/router'

Route.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
Route.post('/api/users', async (req, res) => res.status(201).json(req.body))
Route.delete('/api/users/:id', handler)
Route.all('/api/*', (_req, res) => res.status(404).json({ message: 'Not found' })) // any method
```

`router` and `Route` are the same global singleton.

### Named routes + URL generation

```ts
import { Route, route } from '@rudderjs/router'

Route.get('/users/:id', handler).name('users.show')
Route.post('/users', handler).name('users.store')

route('users.show', { id: 42 })           // '/users/42'
route('search', { q: 'hi', page: 2 })     // '/search?q=hi&page=2' (unused params → query string)
route('posts.show', { slug: 'hello' })    // optional ':id?' segment omitted
```

Throws if a required parameter is missing or the name is not registered.

### Route-level middleware

```ts
Route.get('/protected', handler, [authMiddleware])
Route.post('/admin', handler, [authMiddleware, adminMiddleware])
```

### Decorator controllers

```ts
import { Controller, Get, Post, Delete, Middleware, router } from '@rudderjs/router'

@Controller('/api/users')
@Middleware([authMiddleware])                 // applies to all methods
class UserController {
  @Get('/')
  index(_req, res) { return res.json({ data: [] }) }

  @Post('/')
  async create(req, res) { return res.status(201).json({ data: req.body }) }

  @Delete('/:id')
  @Middleware([adminMiddleware])              // additional middleware on this method only
  async destroy(req, res) { return res.status(204).send('') }
}

router.registerController(UserController)
```

### Signed URLs

```ts
import { Url } from '@rudderjs/router'

Url.signedRoute('invoice.download', { id: 42 })
// '/invoice/42?signature=abc123...'

Url.temporarySignedRoute('invoice.download', 3600, { id: 42 })
// '/invoice/42?expires=...&signature=...'

Url.sign('/some/path?foo=bar')           // sign arbitrary path
Url.isValidSignature(req)                 // validate on the receiving end
Url.current(req)                          // full URL of this request
Url.previous(req, '/')                    // Referer header or fallback
Url.setKey('override-key')                // override APP_KEY (e.g. in tests)
```

The signing key defaults to `APP_KEY`. HMAC-SHA256 with timing-safe comparison.

### `ValidateSignature()` middleware

```ts
import { ValidateSignature } from '@rudderjs/router'

Route.get('/invoice/:id/download', handler, [ValidateSignature()])
  .name('invoice.download')
```

Rejects requests with a missing / invalid / expired signature with a `403`.

## Common Pitfalls

- **Circular dep if you add core to router**: `@rudderjs/core` is a **peer** dependency of router. Never add `@rudderjs/core` to router's `dependencies` or `devDependencies` — core resolves router at runtime via `resolveOptionalPeer('@rudderjs/router')`.
- **Missing `reflect-metadata`**: decorator controllers require `import 'reflect-metadata'` at the app entry point plus `experimentalDecorators: true` + `emitDecoratorMetadata: true` in tsconfig.
- **Controller URL must match the view**: if a controller returns `view('dashboard')` but the URL is `/admin/dashboard`, SPA nav falls back to full reloads. Add `export const route = '/admin/dashboard'` in the view file — see `@rudderjs/view`.
- **`APP_KEY` unset**: `Url.sign*()` throws unless `APP_KEY` is set or `Url.setKey()` is called first.
- **Named route not found**: `route('foo.bar')` throws if the name wasn't registered. Use `Route.get(...).name('foo.bar')` before the first call.
- **Double slashes**: composed paths (prefix + route) are normalised automatically — you don't need to strip leading slashes yourself.

## Key Imports

```ts
import {
  router,           // global singleton
  Route,            // alias for router
  route,            // URL generator for named routes
  Url,              // signed URLs (signedRoute, temporarySignedRoute, isValidSignature, current, previous)
  ValidateSignature,// middleware
  Controller,       // decorator: class-level prefix
  Middleware,       // decorator: class or method-level middleware
  Get, Post, Put, Patch, Delete, Options, // method decorators
} from '@rudderjs/router'

import type { RouteDefinition, RouteBuilder } from '@rudderjs/router'
```
