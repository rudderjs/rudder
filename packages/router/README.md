# @rudderjs/router

Decorator-based and fluent HTTP router for RudderJS. Supports route-level middleware, controller registration, and mounting onto any server adapter.

## Installation

```bash
pnpm add @rudderjs/router
```

## Usage

### Fluent routing

```ts
import { router } from '@rudderjs/router'

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
router.post('/api/users', async (req, res) => { /* ... */ })
router.delete('/api/users/:id', async (req, res) => { /* ... */ })

// Catch-all (matches any HTTP method)
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Not found' }))
```

`router` is the global singleton. `Route` is an alias for it.

### Decorator-based routing

```ts
import { Controller, Get, Post, Delete, Middleware, router } from '@rudderjs/router'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

@Controller('/api/users')
@Middleware([authMiddleware])       // applies to all routes in this controller
class UserController {
  @Get('/')
  index(_req: AppRequest, res: AppResponse) {
    return res.json({ data: [] })
  }

  @Post('/')
  async create(req: AppRequest, res: AppResponse) {
    return res.status(201).json({ data: req.body })
  }

  @Delete('/:id')
  @Middleware([adminMiddleware])    // additional middleware for this route only
  async destroy(req: AppRequest, res: AppResponse) {
    return res.status(204).send('')
  }
}

router.registerController(UserController)
```

### Route-level middleware (fluent)

```ts
router.get('/protected', handler, [authMiddleware])
router.post('/admin', handler, [authMiddleware, adminMiddleware])
```

### Mounting onto a server adapter

```ts
// bootstrap/app.ts — called automatically by Application.configure()
router.mount(serverAdapter)
```

## API Reference

### `Router`

| Method | Description |
|--------|-------------|
| `get(path, handler, mw?)` | Register GET route |
| `post(path, handler, mw?)` | Register POST route |
| `put(path, handler, mw?)` | Register PUT route |
| `patch(path, handler, mw?)` | Register PATCH route |
| `delete(path, handler, mw?)` | Register DELETE route |
| `all(path, handler, mw?)` | Register route matching any method |
| `add(method, path, handler, mw?)` | Register route with explicit method string |
| `use(middleware)` | Register global middleware (runs on every route) |
| `registerController(Class)` | Register all routes from a decorator-based controller |
| `mount(serverAdapter)` | Apply global middleware + routes to a server adapter |
| `list()` | Return a copy of all registered `RouteDefinition[]` |
| `reset()` | Clear all routes and global middleware |

All mutating methods return `this` for chaining.

### Decorators

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@Controller(prefix?)` | class | Marks a class as a controller with a route prefix |
| `@Middleware([...handlers])` | class or method | Applies middleware handlers |
| `@Get(path)` | method | GET route |
| `@Post(path)` | method | POST route |
| `@Put(path)` | method | PUT route |
| `@Patch(path)` | method | PATCH route |
| `@Delete(path)` | method | DELETE route |
| `@Options(path)` | method | OPTIONS route |

### Middleware ordering

- Class-level `@Middleware` runs before method-level `@Middleware`
- Route registration order is preserved

## Notes

- `router` and `Route` are the same global singleton
- Decorator controllers require `reflect-metadata` at the app entry point
- Double slashes in composed paths (`/api` + `/users`) are normalised to `/api/users`
